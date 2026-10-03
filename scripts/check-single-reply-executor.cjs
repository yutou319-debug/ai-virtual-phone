const fs=require('fs'),ts=require('typescript');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const transpile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const source=fs.readFileSync('supabase/functions/ai-phone-push/index.ts','utf8');
const start=source.indexOf('        if (kind === "reply_once") {');
const end=source.indexOf('        await readJson(await rest(\n          `push_jobs?user_id=eq.${OWNER_ID}&trigger_key=',start);
const gateway=new AsyncFunction('kind','rest','readJson','config','plainJson','OWNER_ID','triggerKey','encryptPayload','supabaseUrl','json','fetch',transpile(source.slice(start,end)));
const jobs=new Map(),byId=new Map();let paidCalls=0;
const rest=async(path,init={})=>{
 if(init.method==='POST'){
  if(!init.headers.Prefer.includes('ignore-duplicates'))throw Error('replace would duplicate');
  const row=JSON.parse(init.body)[0];if(!jobs.has(row.trigger_key)){jobs.set(row.trigger_key,row);byId.set(row.id,row)}return new Response('[]');
 }
 const key=decodeURIComponent(path.match(/trigger_key=eq.([^&]+)/)[1]);return new Response(JSON.stringify(jobs.has(key)?[jobs.get(key)]:[]));
};
const fetch=async(_,init)=>{const row=byId.get(JSON.parse(init.body).jobId);if(row.status==='pending'){row.status='running';paidCalls++;await Promise.resolve();row.status='done'}return new Response('accepted')};
const send=key=>gateway('reply_once',rest,async r=>{if(!r.ok)throw Error();return r.json()},{payload_key:'secret',cron_secret:'cron'},'{}','owner',key,async()=>({}), 'https://example.test',x=>x,fetch);
const clientSrc=fs.readFileSync('lib/push-bailout-client.ts','utf8');
let body=clientSrc.slice(clientSrc.indexOf('export async function queueCloudReplyOnce'),clientSrc.indexOf('async function deleteBailoutJob'));
body=body.replace('export async function','async function').replace('await import("./push-outbox-client")','{ consumeServerOutbox: consume }');
const clientFactory=new Function('bailoutEnabled','hasAccountPushSubscription','pushJobsFetch','consume','document','setTimeout','clearTimeout',transpile(body)+';return queueCloudReplyOnce;');
const params={sessionId:'s',characterName:'name',regexes:[],request:{url:'x',headers:{},body:{}},replyAfter:{localMessageId:'m',createdAt:'2026-10-03'}};
(async()=>{
 const replies=await Promise.all(Array.from({length:20},()=>send('reply-once:s:m')));
 if(new Set(replies.map(r=>r.jobId)).size!==1||paidCalls!==1)throw Error('concurrent duplicate');
 await send('reply-once:s:m');if(paidCalls!==1)throw Error('reopen duplicate');
 jobs.get('reply-once:s:m').status='failed';await send('reply-once:s:m');if(paidCalls!==1)throw Error('failed retried');
 await send('reply-once:s:m2');if(paidCalls!==2)throw Error('new input blocked');
 let posts=0,consumes=0;
 const client=clientFactory(()=>true,async()=>true,async init=>{if(init.method==='POST'){posts++;return new Response(JSON.stringify({jobId:'job',singleExecutor:true}))}return new Response(JSON.stringify({status:'done'}))},async()=>{consumes++},{hidden:false},setTimeout,clearTimeout);
 if(!(await client(params))||posts!==1||consumes!==1)throw Error('cloud completion');
 for(const mode of ['network','legacy','failed']){
  let requests=0;
  const c=clientFactory(()=>true,async()=>true,async init=>{requests++;if(mode==='network')throw Error('lost ack');return new Response(JSON.stringify(init.method==='POST'?{jobId:'job',singleExecutor:mode!=='legacy'}:{status:'failed',note:'api timeout'}))},async()=>{}, {hidden:false},setTimeout,clearTimeout);
  let threw=false;try{await c(params)}catch{threw=true}if(!threw||requests>(mode==='failed'?2:1))throw Error(mode+' fallback/retry');
 }
 const disabled=clientFactory(()=>false,async()=>true,async()=>{throw Error('unexpected request')},async()=>{}, {hidden:false},setTimeout,clearTimeout);
 if(await disabled(params))throw Error('offline cloud used when disabled');
 console.log('PASS: 20 concurrent submissions -> 1 paid execution; completed/failed input never regenerated; new input runs; client completion imports once; lost ACK, legacy cloud and API failure fail closed; inactive cloud remains local.');
})().catch(e=>{console.error(e);process.exit(1)});
// Exercise the actual entry gate before the first local provider dispatch.
const engine=fs.readFileSync('lib/chat-engine.ts','utf8');
const coreStart=engine.indexOf('async function generateChatCompletionCore(');
const coreEnd=engine.indexOf('    if (toolsEnabled && nativeToolProtocolForConfig',coreStart);
let core=engine.slice(coreStart,coreEnd)+'\n return "local";\n}';
core=core.replace('await import("./push-bailout-client")','cloudModule');
const makeCore=new Function('buildChatPromptMessages','mergeAppTags','maybeAppendShortcutCapability','cloudModule','buildProviderRequest','toLlmRequestMessages',transpile(core)+';return generateChatCompletionCore;');
(async()=>{
 for(const decision of ['cloud','uncertain','local']){
  const run=makeCore(async()=>({llmMessages:[],character:{name:'n'},config:{},preset:{},regexes:[],userIdentity:{},toolsEnabled:false}),()=>[],()=>{}, {queueCloudReplyOnce:async()=>{if(decision==='uncertain')throw Error('lost acknowledgement');return decision==='cloud'}},()=>({}),x=>x);
  let result,error;try{result=await run({id:'s',isGroup:false},[{id:'m',sessionId:'s',role:'user',createdAt:'date'}],{}, {}, {})}catch(e){error=e}
  if(decision==='local'&&result!=='local')throw Error('inactive cloud did not continue');
  if(decision!=='local'&&result==='local')throw Error('local provider reached after cloud submission');
  if(decision==='cloud'&&error?.name!=='AbortError')throw Error('cloud handoff not silent');
 }
 console.log('PASS: actual chat entry gate never reaches local provider after cloud acceptance or uncertain submission.');
})().catch(e=>{console.error(e);process.exit(1)});
