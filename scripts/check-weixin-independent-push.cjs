const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const src=fs.readFileSync('supabase/functions/push-generate/index.ts','utf8');
const start=src.indexOf('    const WEIXIN_MARKER =');
const end=src.indexOf('    // 第一轮正文已经落库并完成推送后',start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const code=`
 let rawText='定时消息测试',deliverAsCall=false,executedShortcutMarker=null,shortcutStoragePath='';
 const supabaseUrl='https://cloud.invalid',serviceKey='test-only',siteOrigin='https://float.invalid';
 const job={id:'job',user_id:'owner',kind:'timed_task',trigger_key:'wake'};
 const subs=[{endpoint:'https://push.invalid',p256dh:'test',auth:'test'}];
 ${src.slice(start,end)}
 return {deliveredViaWeixin,weixinDeliveryNote,pushed};`;
const fn=new AsyncFunction('payload','fetch','rest','progress','finish','stillOwnsJob','sendWebPushRaw','splitResponseForPushPreview','sleep','crypto',ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText);
(async()=>{
 for(const scenario of ['accepted','rejected','missing-count']){
  let sends=0,pushes=0,outbox=0;
  const result=await fn({weixin:{botId:'bot',force:true},merge:{sessionId:'s'}},
   async url=>{if(url.includes('cron-secret'))return Response.json({token:'test'});sends++;return Response.json(scenario==='accepted'?{ok:true,sent:1}:scenario==='rejected'?{ok:false,error:'ilink error_code -2'}:{ok:true});},
   async(path,init)=>{if(path==='push_outbox'){outbox++;return Response.json([]);}if(path.startsWith('push_server_config'))return Response.json([{vapid_public_key:'test',vapid_private_key:'test'}]);throw Error(path);},
   async()=>{},async()=>{throw Error('must not finish before Web Push');},async()=>true,
   async()=>{pushes++;return 201;},()=>['定时消息测试'],async()=>{},global.crypto);
  assert.equal(sends,1);assert.equal(pushes,1);assert.equal(result.pushed,1);
  assert.equal(outbox,scenario==='accepted'?0:1,'keep one history copy');
  assert.equal(result.deliveredViaWeixin,scenario==='accepted');
  if(scenario==='rejected')assert.match(result.weixinDeliveryNote,/-2/);
 }
 console.log('PASS: actual worker attempts Web Push after WeChat acceptance, rejection or missing send count; one history copy, one WeChat attempt, no model calls.');
})().catch(e=>{console.error(e);process.exit(1)});
