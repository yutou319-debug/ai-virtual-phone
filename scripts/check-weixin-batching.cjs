const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync('tools/weixin-local-assistant/assistant-core.mjs','utf8');
const ast=ts.createSourceFile('core.mjs',source,ts.ScriptTarget.Latest,true);
const names=['weixinBatchWaitRemaining','autoReplyPendingMessages'];
const selected=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text));
let now=100000,rows=[],flag=null,locked=false,generated=[],sent=0,releases=0;
class ClockDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
const context={exports:{},Date:ClockDate,console,
 loadPendingFlag:async()=>flag,reconcileScanDue:()=>false,
 acquireAutoReplyLock:async()=>{if(locked)return null;locked=true;return {id:'lock'};},
 releaseAutoReplyLock:async()=>{locked=false;releases++;},loadCloudMessagesForBot:async()=>rows,
 savePendingFlag:async(_env,_bot,value)=>{flag=value;},messageTime:message=>message.receivedAt||'',
 startIlinkTyping:async()=>async()=>{},
 generateReply:async(_env,_runtime,_history,pending)=>{generated.push(pending.map(message=>message.externalId));return {text:'合并后的回复',shortcutActions:[]};},
 extractWeixinShortcutRequest:text=>({text}),buildLocalReplyOutbox:async()=>[{type:'text',text:'合并后的回复'}],
 sendLocalReplyItem:async()=>{sent++;return {ok:true};},
 putObject:async(_env,path,text)=>{const row=rows.find(row=>row.path===path);row.message=JSON.parse(text);},
 storeOutgoingMessage:async()=>{},clearPendingFlagIfCovered:async()=>{flag={pending:false};},
 errorMessage:error=>String(error),sleep:async()=>{},
};
vm.runInNewContext(ts.transpileModule(selected.map(node=>node.getText(ast)).join('\n')+'\nexports.wait=weixinBatchWaitRemaining;exports.reply=autoReplyPendingMessages;',
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const iso=ms=>new Date(ms).toISOString();
function receive(id){rows.push({path:id,message:{externalId:id,direction:'inbound',needsReply:true,receivedAt:iso(now),raw:{context_token:'mock'}}});flag={pending:true,pendingMarkedAt:iso(now)};}
(async()=>{
 assert.equal(context.exports.wait([],iso(now),now),8000);
 assert.equal(context.exports.wait([],iso(now),now+7999),1);
 assert.equal(context.exports.wait([],iso(now),now+8000),0);
 assert.equal(context.exports.wait([{receivedAt:iso(now+3000)}],iso(now),now+8000),3000,'later inbound resets quiet period');
 assert.equal(context.exports.wait([{createdAt:iso(now+100000000)}],undefined,now),0,'user clock cannot extend waiting');
 assert.equal(context.exports.wait([{}],undefined,now),0,'legacy messages without receipt metadata remain usable');
 const runtime={bot:{id:'bot',botToken:'mock'}};
 receive('one');assert.equal((await context.exports.reply({},runtime)).status,'collecting');assert.equal(generated.length,0);assert.equal(locked,false);
 now+=4000;receive('two');now+=4000;receive('three');
 now+=7999;assert.equal((await context.exports.reply({},runtime,{force:true})).status,'collecting','debug does not bypass batching');assert.equal(generated.length,0);
 now++;await Promise.all(Array.from({length:20},()=>context.exports.reply({},runtime)));
 assert.equal(generated.length,1);assert.equal(generated[0].join(','),'one,two,three');assert.equal(sent,1);assert.equal(locked,false);
 await context.exports.reply({},runtime);assert.equal(generated.length,1,'replied batch is not regenerated');
 now+=1000;receive('four');flag=null;assert.equal((await context.exports.reply({},runtime)).status,'collecting','under-lock check protects a missing pending flag');assert.equal(locked,false);
 now+=8000;await context.exports.reply({},runtime);assert.equal(generated.length,2);assert.equal(generated[1].join(','),'four');assert.equal(sent,2);
 console.log('PASS: 8-second quiet period resets on each receipt; 3 messages -> one generation; 20 concurrent polls -> one reply; no reply while collecting; debug/flag loss protected; replied batches not replayed; future user timestamps do not block replies. No real model calls or WeChat sends.');
})();
