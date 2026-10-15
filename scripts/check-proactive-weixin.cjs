const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function codeFor(file, names) {
 const source=fs.readFileSync(file,'utf8'), ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const nodes=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text));
 assert.equal(nodes.length,names.length);
 return nodes.map(node=>node.getText(ast)).join('\n')+'\n'+names.map(name=>`exports.${name}=${name};`).join('\n');
}
function load(file,mocks={},globals={},source=fs.readFileSync(file,'utf8')) {
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {module,exports:module.exports,require:name=>mocks[name]||require(name),console,Date,crypto:global.crypto,Set,...globals});return module.exports;
}
(async()=>{
 const file='lib/push-bailout-client.ts', posted=[];
 const session={id:'s',contactId:'c',updatedAt:new Date().toISOString()}, fireAt=Date.now()+60000;
 let bot='paired', quiet=false;
 const globals={
  buildQuietWindowMeta:()=>null,bailoutEnabled:()=>true,hasAccountPushSubscription:async()=>true,isWithinPushQuietHours:()=>quiet,
  loadChatSessions:()=>[session],loadChatMessages:()=>[{role:'user',createdAt:new Date(Date.now()-7200000).toISOString()}],
  buildChatPromptMessages:async()=>({llmMessages:[],character:{name:'角色'},config:{},preset:null,regexes:[],userIdentity:{name:'用户'}}),
  buildFollowUpSilenceMessages:()=>[],loadFollowUpSchedule:()=>({count:0,fireAt}),FOLLOWUP_BAILOUT_GRACE_MS:15000,
  offlineWeixinBotIdFor:()=>bot,maybeAppendShortcutCapability:()=>{},maybeAppendCallInvite:()=>{},buildOfflineShortcutContinuation:()=>null,
  toLlmRequestMessages:m=>m,buildProviderRequest:()=>({url:'https://model.invalid',headers:{},body:{messages:[]},providerKind:'openai-compatible'}),
  pushJobsFetch:async init=>{posted.push(JSON.parse(init.body));return Response.json({ok:true});},
  isCallActiveForSession:()=>false,cancelBailoutPrefix:async()=>{},IDLE_RECONNECT_MAX_CONSECUTIVE:3,
  window:{setTimeout:()=>{}},resolveTimedWakeElapsedMinutes:()=>10,
  loadMenstrualConfig:()=>({periodCareEnabled:true,periodCareCharacterIds:['c']}),loadMenstrualRecords:()=>[],
  getMenstrualPeriodCareEvent:()=>({cycleKey:'cycle',context:'关怀'}),hasMenstrualPeriodCareTriggered:()=>false,loadCharacters:()=>[{id:'c',name:'角色'}],
 };
 const arms=load(file,{},globals,codeFor(file,['postBailoutJob','armFollowUpBailout','armIdleReconnectBailout','armTimedWakeBailout','armPeriodCareBailouts']));
 for(const kind of ['followup','idle','timed','period']){
  posted.length=0;
  if(kind==='followup')await arms.armFollowUpBailout('s',0,60,fireAt);
  if(kind==='idle')await arms.armIdleReconnectBailout({id:'idle',sessionId:'s',characterId:'c',intervalMinutes:60,consecutiveCount:0});
  if(kind==='timed')await arms.armTimedWakeBailout({id:'wake',sessionId:'s',characterId:'c',fireAt,source:'user'});
  if(kind==='period')await arms.armPeriodCareBailouts();
  const job=posted.find(item=>item.payload);assert.ok(job,kind);
  assert.equal(job.payload.weixin.botId,'paired',kind);assert.equal(job.payload.weixin.force,true,kind);
 }
 bot='';posted.length=0;await arms.armFollowUpBailout('s',0,60,fireAt);assert.equal(posted[0].payload.weixin,undefined);
 quiet=true;posted.length=0;await arms.armFollowUpBailout('s',0,60,fireAt);assert.equal(posted.length,0);
 let forwarded=[], fail=false;
 const mirror=load('lib/proactive-weixin-delivery.ts',{
  './offline-shortcut-capability':{offlineWeixinBotIdFor:()=> 'paired'},
  './weixin-cloud-sync':{forwardExistingProactiveTextToWeixin:async(...args)=>{forwarded.push(args);if(fail)throw Error('network');}},
 });
 const msg=(id,extra={})=>({id,sessionId:'s',role:'assistant',content:'正文'+id,...extra});
 await mirror.mirrorLocalProactiveMessages(session,[msg('a'),msg('meta',{content:''}),msg('tool',{mediaType:'tool_notice'}),msg('user',{role:'user'})]);
 assert.equal(forwarded.length,1);assert.equal(forwarded[0][1],'正文a');
 await mirror.mirrorLocalProactiveMessages(session,[msg('a')]);assert.equal(forwarded.length,1);
 await mirror.mirrorLocalProactiveMessages({...session,isGroup:true},[msg('b')]);assert.equal(forwarded.length,1);
 fail=true;await assert.rejects(mirror.mirrorLocalProactiveMessages(session,[msg('c')]));
 await mirror.mirrorLocalProactiveMessages(session,[msg('c')]);assert.equal(forwarded.length,2,'ambiguous failure is not retried');
 // Only the batch just saved may be forwarded, even if another reply appears concurrently.
 let saved=[],mirrored=[],batch=0;
 const saver=load('lib/follow-up-service.ts',{}, {
  loadChatMessages:()=>saved,loadChatSessions:()=>[session],createResponseBatchId:()=>`batch-${++batch}`,
  parseAndSaveResponse:async(text,sid,_count,_index,_context,options)=>{
   saved.push(msg('local-'+text,{responseBatchId:options.responseBatchId}));
   saved.push(msg('concurrent-normal',{responseBatchId:'other-batch'}));
   return {hasVisible:true,newCount:0,stateValues:[]};
  },mirrorLocalProactiveMessages:async(_session,messages)=>mirrored.push(messages),
 },codeFor('lib/follow-up-service.ts',['saveBackgroundCompletionRounds']));
 await saver.saveBackgroundCompletionRounds([{text:'proactive'}],'s',0,undefined,[],{syncProactiveToWeixin:true});
 assert.equal(mirrored.length,1);assert.equal(mirrored[0].length,1);assert.equal(mirrored[0][0].content,'正文local-proactive');
 await saver.saveBackgroundCompletionRounds([{text:'ordinary'}],'s',0,undefined,[]);
 assert.equal(mirrored.length,1,'ordinary saved messages are not forwarded');
 // Local mirrored delivery must not create a second cloud history entry.
 let stored=0,sent=0;
 const core=load('tools/weixin-local-assistant/assistant-core.mjs',{}, {
  loadRuntimeIndex:async()=>({packages:[{botId:'paired'}]}),loadRuntimePackage:async()=>({bot:{botToken:'mock'}}),
  loadCloudMessagesForBot:async()=>[{message:{direction:'inbound',raw:{context_token:'mock',from_user_id:'self'}}}],
  sendIlinkTextMessage:async()=>{sent++;return {error_code:0};},storeOutgoingMessage:async()=>stored++,
 },codeFor('tools/weixin-local-assistant/assistant-core.mjs',['sendProactiveText']));
 assert.equal((await core.sendProactiveText({},'paired','已存正文',undefined,{mirrorOnly:true})).mirrorOnly,true);
 assert.equal(sent,1);assert.equal(stored,0);
 await core.sendProactiveText({},'paired','云端生成正文');assert.equal(stored,1,'cloud-only generation still stores history for Float');
 // Ensure normal background replies are not opted into this transport and all four proactive paths are.
 const service=fs.readFileSync('lib/follow-up-service.ts','utf8');
 for(const name of ['fireFollowUp','fireIdleReconnect','fireTimedWake','fireMenstrualPeriodCare'])assert.ok(codeFor('lib/follow-up-service.ts',[name]).includes('syncProactiveToWeixin: true'),name);
 assert.ok(!codeFor('lib/follow-up-service.ts',['requestBackgroundChatReply']).includes('syncProactiveToWeixin: true'));
 console.log('PASS: follow-up, idle, timed and care cloud snapshots force the paired bot; quiet/no-bot respected; foreground text forwards once without tool/metadata/private history copies or model calls; ambiguous delivery is not retried; ordinary background replies unchanged.');
})();
