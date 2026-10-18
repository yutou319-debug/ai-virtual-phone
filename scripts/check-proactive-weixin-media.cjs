const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync('tools/weixin-local-assistant/assistant-core.mjs','utf8');
const ast=ts.createSourceFile('core.mjs',source,ts.ScriptTarget.Latest,true);
const names=['cleanReplyText','cleanWeixinDisplayText','splitLocalReplyText','resolveRuntimeStickerImage','filterUnavailableStickerMarkers','buildProactiveWeixinItems','sendLocalReplyItem','sendProactiveText'];
const code=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
let sends=[],records=[],response={ret:0};
const runtime={bot:{id:'bot',botToken:'test'},promptContext:{customStickerMap:{'月薪喵突然窜出冒泡':'data:image/png;base64,existing-asset'},mediaReply:true}};
const context={exports:{},console,setTimeout:fn=>{fn();return 0;},
 loadRuntimeIndex:async()=>({packages:[{botId:'bot'}]}),loadRuntimePackage:async()=>runtime,
 loadCloudMessagesForBot:async()=>[{message:{direction:'inbound',raw:{context_token:'test-context',from_user_id:'test-user'}}}],
 sendIlinkTextMessage:async(_token,_raw,text)=>{sends.push({kind:'text',text});return response;},
 sendIlinkImageMessage:async(_token,_raw,image)=>{sends.push({kind:'image',image});return response;},
 storeOutgoingMessage:async(...args)=>records.push(args),
};
vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
const raw='[好感度:100][占有欲:90][焦虑值:10]\n[内心]五分钟一秒都没敢多耽误，得赶紧跟我的小长官报到。[/内心]\n报告长官，五分钟刚好到啦^^\n\n[表情包:月薪喵突然窜出冒泡]\n\n这次有没有准时敲到你的小窗🥺';
(async()=>{
 const result=await context.exports.sendProactiveText({},'bot',raw);
 assert.equal(result.sent,3);assert.deepEqual(sends.map(s=>s.kind),['text','image','text']);
 assert.equal(sends[0].text,'报告长官，五分钟刚好到啦^^');
 assert.equal(sends[1].image,runtime.promptContext.customStickerMap['月薪喵突然窜出冒泡']);
 assert.ok(sends.every(s=>!/(内心|好感度|占有欲|焦虑值|一秒都没敢|表情包:)/.test(s.text||'')));
 assert.equal(records.length,1);assert.equal(records[0][3],raw,'Float retains its private card, sticker markers and full history');
 sends=[];records=[];
 await context.exports.sendProactiveText({},'bot',raw,undefined,{mirrorOnly:true});
 assert.equal(records.length,0,'local proactive history must not be mirrored twice');
 sends=[];records=[];
 assert.equal((await context.exports.sendProactiveText({},'bot','[内心]仅有隐藏内容[/内心]')).sent,0);
 assert.equal((await context.exports.sendProactiveText({},'bot','[内心]没有结束标签的隐藏内容')).sent,0);
 assert.equal((await context.exports.sendProactiveText({},'bot','<think>unclosed private reasoning')).sent,0);
 assert.equal(sends.length,0);assert.equal(records.length,0);
 await context.exports.sendProactiveText({},'bot','你好\n\n[表情包:不存在]\n\n再见');
 assert.equal(sends.map(s=>s.text).join('\n'),'你好\n再见');assert.equal(records.length,1);
 sends=[];records=[];runtime.promptContext.mediaReply=false;
 await context.exports.sendProactiveText({},'bot',raw);
 assert.ok(sends.every(s=>s.kind==='text'&&!s.text.includes('[表情包')));
 runtime.promptContext.mediaReply=true;sends=[];records=[];response={ret:-2};
 await assert.rejects(()=>context.exports.sendProactiveText({},'bot','[表情包:月薪喵突然窜出冒泡]'),/ilink error_code/);
 assert.equal(sends.length,1);assert.equal(records.length,0,'rejected image has no fake outgoing history and is not retried');
 console.log('PASS: screenshot-style proactive reply sends clean text / configured sticker image / text in order; Float preserves one original private card; missing assets, disabled media, hidden-only and unclosed blocks never leak; rejected send is not retried. No network or model calls.');
})().catch(e=>{console.error(e);process.exit(1)});
