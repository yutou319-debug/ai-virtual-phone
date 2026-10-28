const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync('tools/weixin-local-assistant/assistant-core.mjs','utf8');
const ast=ts.createSourceFile('core.mjs',source,ts.ScriptTarget.Latest,true);
const selected=names=>ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
const run=(code,ctx)=>{vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);return ctx.exports};
let downloads=0,replies=0,msgs=[],pending=false,due=false;
const env={exports:{},Date,console,replyDeadlineAt:0,BASE_INFO:{},
 loadRuntimeIndex:async()=>({packages:[{botId:'b',characterId:'c'}]}),getLatestRuntimeTargets:x=>x,
 loadPollingRuntime:async()=>({bot:{id:'b',botToken:'mock'}}),loadRuntimePackage:async()=>{downloads++;return {bot:{id:'b',botToken:'mock'},promptContext:{}}},
 loadBotState:async()=>({}),callIlinkJson:async()=>({msgs}),loadPendingFlag:async()=>({pending}),reconcileScanDue:()=>due,
 saveBotState:async()=>{},storeIncomingMessage:async()=>false,savePendingFlag:async()=>{},
 autoReplyPendingMessages:async()=>{replies++;return {status:'idle',sent:0}},errorMessage:String};
const api=run(selected(['pollOnce'])+'\nexports.poll=pollOnce;',env);
(async()=>{
 for(let i=0;i<20;i++)await api.poll({});
 assert.equal(downloads,0);assert.equal(replies,0,'idle poll never loads prompts/assets');
 msgs=[{id:'new'}];await api.poll({});assert.equal(downloads,1);assert.equal(replies,1);
 msgs=[];pending=true;await api.poll({});assert.equal(downloads,1,'pending inspection defers full context');
 pending=false;due=true;await api.poll({});assert.equal(downloads,1,'empty reconciliation does not download full context');
 let reads=0,writes=0,failure='object_not_found:poll';
 const ctx={exports:{},sanitizePathPart:x=>x,errorMessage:String,
 getObjectJson:async()=>{throw Error(failure)},loadRuntimePackage:async()=>{reads++;return {bot:{id:'b',botToken:'token'},secretPrompt:'large'}},
 putObject:async(_e,_p,body)=>{writes++;assert.equal(JSON.parse(body).secretPrompt,undefined)}};
 const helper=run(selected(['loadPollingRuntime'])+'\nexports.load=loadPollingRuntime;',ctx);
 await helper.load({}, {botId:'b'});assert.equal(reads,1);assert.equal(writes,1);
 failure='Supabase GET 402';await assert.rejects(helper.load({}, {botId:'b'}));assert.equal(reads,1,'quota rejection does not fetch large fallback');
 console.log('PASS: 20 idle polls download zero full runtimes; inbound loads context; empty pending/reconciliation defers full download; legacy upgrade writes tiny poll package; quota errors fail closed. No real network/model/WeChat calls.');
})().catch(e=>{console.error(e);process.exit(1)});
