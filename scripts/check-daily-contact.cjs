const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const storageContext = { exports: {}, window: {}, require: () => ({ registerKvMigration() {}, kvGet() { return '[]'; }, kvSet() {} }) };
vm.runInNewContext(transpile(fs.readFileSync('lib/daily-contact-storage.ts', 'utf8')), storageContext);
const slots = storageContext.exports.dailyContactMinutes;
assert.equal(slots(null).length, 900);
assert.equal(slots({ startMin: 1380, endMin: 480, tzOffsetMin: 480 }).length, 900);
assert.equal(slots({ startMin: 720, endMin: 780, tzOffsetMin: 480 }).length, 840);
assert.equal(slots({ startMin: 0, endMin: 600, tzOffsetMin: 0 }).length, 300); // UTC quiet 00–10 = Beijing 08–18, leaves 18–23 = 300
assert.equal(slots({ startMin: 480, endMin: 1380, tzOffsetMin: 480 }).length, 0);
(async () => {
 const gatewaySource=fs.readFileSync('supabase/functions/ai-phone-push/index.ts','utf8');
 const gatewayBlock=gatewaySource.slice(gatewaySource.indexOf('    if (action === "daily-rules") {'),gatewaySource.indexOf('    if (action === "jobs") {'));
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const dailyHandler=new AsyncFunction('request','action','rest','readJson','json','cleanText','OWNER_ID','MAX_PAYLOAD_BYTES','loadConfig','encryptPayload',transpile(gatewayBlock));
 let ruleRow=null, scheduled=0, jobState='pending';
 const gatewayRest=async (path,init={})=>{
   const record=init.body?JSON.parse(init.body):null;
   if(path.startsWith('push_daily_contact_rules')) {
     if(init.method==='POST') ruleRow=record[0];
     if(init.method==='PATCH') {
       if(path.includes('enabled=eq.true') && !ruleRow?.enabled) return Response.json([]);
       ruleRow={...ruleRow,...record};
     }
     return Response.json(ruleRow?[ruleRow]:[]);
   }
   if(path.startsWith('push_jobs')) {if(init.method==='PATCH' && record.status)jobState=record.status;return Response.json([]);}
   if(path.startsWith('rpc/')) {scheduled=1;return Response.json(null);}
   throw Error(`unexpected gateway request ${path}`);
 };
 const gatewayCall=(method,body)=>dailyHandler(new Request('https://test.invalid',{method,body:JSON.stringify(body)}),'daily-rules',gatewayRest,async res=>{if(!res.ok)throw Error('rest failed');return res.json();},(data,status=200)=>Response.json(data,{status}),value=>typeof value==='string'?value.trim():'','owner',900000,async()=>({payload_key:'key'}),async plain=>({encrypted:plain}));
 const draft={id:'daily_c',characterId:'c',sessionId:'s',minutes:[480,900],payload:{request:{url:'test',body:{}},merge:{},shortcutContinuation:{request:{}}}};
 assert.equal((await gatewayCall('POST',draft)).status,200);
 assert.equal((await gatewayCall('POST',draft)).status,200); assert.equal(scheduled,1);
 assert.ok(!JSON.parse(ruleRow.payload.encrypted).shortcutContinuation);
 assert.equal((await gatewayCall('DELETE',{id:'daily_c'})).status,200); assert.equal(ruleRow.enabled,false); assert.equal(jobState,'cancelled');
 assert.equal((await gatewayCall('PATCH',draft)).status,409); assert.equal(ruleRow.enabled,false);
 assert.equal((await gatewayCall('POST',{...draft,id:'daily_other'})).status,400);
 console.log('PASS: actual daily gateway confirms creation, strips tool continuation, cancels cloud jobs, rejects mismatched role keys, and cannot resurrect a disabled rule during stale refresh.');
 const source = fs.readFileSync('supabase/functions/push-generate/index.ts', 'utf8');
 const today = new Date(Date.now() + 480 * 60000).toISOString().slice(0,10);
 const minute = new Date(Date.now() + 480 * 60000).getUTCHours()*60 + new Date(Date.now() + 480 * 60000).getUTCMinutes();
 let handler, pending=[], paid=0, state='pending', enabled=true, windowOpen=true, date=today, encrypted;
 const context = { crypto: globalThis.crypto, TextEncoder, TextDecoder, Uint8Array, DataView, btoa, atob, URL, Request, Response, AbortController, setTimeout, clearTimeout, console,
  Deno: { env: { get: key => key==='SUPABASE_URL' ? 'https://test.invalid' : 'service' }, serve: callback => {handler=callback;} },
  EdgeRuntime: {waitUntil: promise => pending.push(promise)},
  fetch: async (url, init={}) => {
   if(url==='https://provider.invalid') { paid++; return new Response('API unavailable',{status:503}); }
   const path = new URL(url).pathname, query = new URL(url).search;
   const data = init.body ? JSON.parse(init.body) : null;
   if(path.endsWith('/push_server_config')) return Response.json([{cron_secret:'secret',payload_key:'key'}]);
   if(path.endsWith('/push_jobs')) {
    if(init.method==='PATCH' && query.includes('status=eq.pending')) {
     if(state!=='pending') return Response.json([]);
     state='running'; return Response.json([{id:'j',user_id:'owner',trigger_key:`daily:daily_s:${date}`,kind:'daily_random',payload:encrypted}]);
    }
    if(init.method==='PATCH') { if(data.status && state==='running') state=data.status; return Response.json([]); }
    return Response.json(state==='running' ? [{id:'j'}] : []);
   }
   if(path.endsWith('/push_daily_contact_rules')) return Response.json(enabled ? [{payload:encrypted,minute_slots:windowOpen?[minute]:[]}] : []);
   if(path.endsWith('/push_subscriptions')) return Response.json([{endpoint:'dummy'}]);
   if(path.endsWith('/push_outbox')) return Response.json([]);
   throw Error(`unexpected test fetch ${url}`);
  }
 };
 vm.runInNewContext(transpile(source)+';globalThis.encryptTest=encryptPayload;',context);
 encrypted = await context.encryptTest(JSON.stringify({request:{url:'https://provider.invalid',headers:{},body:{messages:[{role:'user',content:'hello'}]},providerKind:'openai-compatible'},merge:{sessionId:'s',dailyRuleId:'daily_s'}}),'key');
 const dispatch=()=>handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({jobId:'j',token:'secret'})}));
 await Promise.all(Array.from({length:20},dispatch)); await Promise.all(pending); pending=[];
 assert.equal(paid,1); assert.equal(state,'failed');
 await dispatch(); await Promise.all(pending); pending=[]; assert.equal(paid,1);
 for(const scenario of ['disabled','quiet','expired']) {
  state='pending'; enabled=scenario!=='disabled'; windowOpen=scenario!=='quiet'; date=scenario==='expired'?'2026-01-01':today;
  await dispatch(); await Promise.all(pending); pending=[]; assert.equal(paid,1,scenario); assert.equal(state,'done');
 }
 console.log('PASS: quiet hours across time zones; 20 concurrent daily dispatches -> one paid attempt; failed attempt is not retried; disabled, quiet and expired jobs make zero provider calls.');
 if (!process.env.PGLITE_MODULE) { console.log('SQL execution check: set PGLITE_MODULE to the installed @electric-sql/pglite module path.'); return; }
 const {PGlite}=require(process.env.PGLITE_MODULE); const db=new PGlite();
 const sql=fs.readFileSync('docs/personal-push-supabase.sql','utf8');
 const jobs=sql.slice(sql.indexOf('create table if not exists public.push_jobs ('),sql.indexOf('-- Durable recurring rules.'));
 let daily=sql.slice(sql.indexOf('create table if not exists public.push_daily_contact_rules ('),sql.indexOf('revoke all on function public.ai_phone_materialize_daily_contacts()'));
 daily=daily.replace(/now\(\)/g,'public.test_now()');
 await db.exec(`create table test_clock (ts timestamptz); insert into test_clock values ('2026-10-09T04:00:00Z'); create function test_now() returns timestamptz language sql as $$select ts from test_clock$$; set timezone='America/New_York';`+jobs+daily);
 await db.exec(`insert into push_daily_contact_rules values ('owner','daily_s','s','c',true,array[480,600,800,1000,1300],'{}',test_now()); select ai_phone_materialize_daily_contacts();`);
 let rows=(await db.query(`select trigger_key,execute_at from push_jobs order by trigger_key`)).rows;
 assert.equal(rows.length,2); const original=JSON.stringify(rows);
 for(let i=0;i<20;i++) await db.exec('select ai_phone_materialize_daily_contacts()');
 assert.equal(JSON.stringify((await db.query('select trigger_key,execute_at from push_jobs order by trigger_key')).rows),original);
 for(const row of rows) {const local=new Date(new Date(row.execute_at).getTime()+480*60000);assert.ok([480,600,800,1000,1300].includes(local.getUTCHours()*60+local.getUTCMinutes()));assert.ok(row.trigger_key.endsWith(local.toISOString().slice(0,10)));}
 await db.exec(`update push_jobs set status='failed' where trigger_key like '%2026-10-09'; select ai_phone_materialize_daily_contacts();`);
 assert.equal((await db.query('select count(*)::int as n from push_jobs')).rows[0].n,2);
 await db.exec(`update test_clock set ts='2026-10-10T04:00:00Z'; select ai_phone_materialize_daily_contacts();`);
 assert.equal((await db.query('select count(*)::int as n from push_jobs')).rows[0].n,3);
 await db.exec(`update push_daily_contact_rules set enabled=false; update test_clock set ts='2026-10-12T04:00:00Z'; select ai_phone_materialize_daily_contacts();`);
 assert.equal((await db.query('select count(*)::int as n from push_jobs')).rows[0].n,3);
 await db.exec(`update push_daily_contact_rules set enabled=true,minute_slots=array[]::integer[]; select ai_phone_materialize_daily_contacts();`);
 assert.equal((await db.query('select count(*)::int as n from push_jobs')).rows[0].n,3);
 assert.match(sql,/kind not in \('reply_once', 'daily_random'\)/);
 assert.match(sql,/kind in \('reply_once', 'daily_random'\)/);
 await db.close();
 console.log('PASS: actual PostgreSQL scheduler SQL; stable random timing and unique daily jobs; next day schedules without client; failures never recreate an attempt; disabled/fully quiet rules stop scheduling; works with a non-UTC database timezone.');
})().catch(error=>{console.error(error);process.exitCode=1;});
