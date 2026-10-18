const assert = require('node:assert/strict'), fs=require('node:fs'), ts=require('typescript');
const transpile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const moduleExports={};
new Function('exports',transpile(fs.readFileSync('lib/cloud-timed-wake.ts','utf8')))(moduleExports);
const parse=moduleExports.parseCloudTimedWakeRequest;
const now=Date.parse('2026-10-18T06:35:00Z');
for(const [text,time] of [
 ['那你40分再给我发一个','2026-10-18T06:40:00.000Z'],
 ['五分钟后给我发一条主动消息','2026-10-18T06:40:00.000Z'],
 ['14:40提醒我','2026-10-18T06:40:00.000Z'],
 ['晚上八点半联系我','2026-10-18T12:30:00.000Z'],
 ['明天上午八点给我发消息','2026-10-19T00:00:00.000Z'],
])assert.equal(parse(text,now)?.executeAt,time,text);
for(const text of ['我五分钟后上课','不用五分钟后给我发','90分找我','两百小时后提醒我','你会定时给我发消息吗'])assert.equal(parse(text,now),undefined,text);
const src=fs.readFileSync('supabase/functions/push-generate/index.ts','utf8');
const ast=ts.createSourceFile('worker.ts',src,ts.ScriptTarget.Latest,true);
const code=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['appendCloudJobInstruction','registerCloudTimedWake'].includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
const make=new Function('encryptPayload',transpile(code)+';return {registerCloudTimedWake,appendCloudJobInstruction}');
const {registerCloudTimedWake:register,appendCloudJobInstruction:append}=make(async plain=>({encrypted:plain}));
const base={request:{url:'https://provider.invalid',headers:{},providerKind:'openai-compatible',body:{messages:[{role:'user',content:'五分钟后找我'}]}},merge:{sessionId:'s',replyAfterLocalMessageId:'m'},timedWake:{executeAt:'2026-10-18T06:40:00Z',intent:'五分钟后找我',weixinBotId:'bot'}};
(async()=>{
 for(const providerKind of ['openai-compatible','gemini','anthropic']) {
  const request={providerKind,body:providerKind==='gemini'?{contents:[]}: {messages:[]}};
  append(request,'execution confirmed');assert.ok(JSON.stringify(request.body).includes('execution confirmed'));
 }
 const jobs=new Map();let posts=0,reads=0;
 const rest=async(path,init={})=>{
  if(init.method==='POST'){
   posts++;assert.match(path,/on_conflict=user_id,trigger_key/);
   const row=JSON.parse(init.body)[0];if(!jobs.has(row.trigger_key))jobs.set(row.trigger_key,row);
   return Response.json([]);
  }
  reads++;return Response.json([...jobs.values()]);
 };
 const job={id:'source',user_id:'owner',kind:'reply_once'};
 const confirmations=await Promise.all(Array.from({length:20},()=>register(job,base,rest,'key',now)));
 assert.equal(jobs.size,1);assert.ok(confirmations.every(s=>s.includes('实际确认')));
 const future=JSON.parse([...jobs.values()][0].payload.encrypted);
 assert.equal(future.timedWake,undefined);assert.equal(future.merge.replyAfterLocalMessageId,undefined);
 assert.deepEqual(future.weixin,{botId:'bot',force:true});assert.equal(future.merge.cloudTimedWake,true);
 assert.equal(base.request.body.messages.length,1,'do not mutate the original request');
 const noWrite=()=>{throw Error('must not write');};
 assert.match(await register(job,{...base,timedWake:{...base.timedWake,blocked:true}},noWrite,'key',now),/未创建/);
 assert.match(await register({...job,kind:'timed_task'},base,noWrite,'key',now),/没有确认/);
 let lostPosts=0;
 const lost=async(path,init={})=>{if(init.method==='POST'){lostPosts++;throw Error('lost ack');}return Response.json([...jobs.values()]);};
 assert.match(await register(job,base,lost,'key',now),/实际确认/);assert.equal(lostPosts,1);
 const failed=async()=>new Response('unavailable',{status:503});
 assert.match(await register(job,base,failed,'key',now),/未确认/);
 console.log('PASS: explicit Chinese time parsing; no incidental/negative requests; all provider formats; one confirmed future job per input; no recursive wakes; lost ACK checked without resubmission; failed registration never claims success.');
})().catch(e=>{console.error(e);process.exit(1)});
