'use strict';
// ONLY GitHub disposable Redis. Real Express CMS, real Redis DUMP/RESTORE, synthetic content.
// Do not run against Render or production data.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {createClient}=require('redis');
const base='redis://127.0.0.1:6379';
assert.equal(process.env.GITHUB_ACTIONS,'true','Only disposable GitHub Actions runner allowed');
assert.equal(process.env.INTEGRATION_REDIS_BASE,base,'Never allow external Redis');
const admin='ISOLATED_SYNTHETIC_KEY_NOT_PRODUCTION';
const html='<!DOCTYPE html><html lang="ru"><head><title>ISOLATED</title></head><body>'+
  '<script id="site-data" type="application/json">{"test":"synthetic"}</script>'+
  '<main>'+'SYNTHETIC DATA '.repeat(100)+'</main></body></html>';
const report={checks:[],keysRestored:0,redisTypes:[],productionChanges:false};
let child=null,fixture=null;
const clients=[];
const url='http://127.0.0.1:19093';
function check(name,value){assert.ok(value,'FAILED '+name);report.checks.push(name);console.log('PASS '+name)}
async function redis(db){
  const client=createClient({url:base+'/'+db});
  client.on('error',e=>console.error('Local Redis:',e.message));
  await client.connect();clients.push(client);return client;
}
async function fixtureServer(){
  fixture=http.createServer((req,res)=>{
    res.writeHead(req.url==='/fallback'?200:404,{'Content-Type':'text/html; charset=utf-8'});
    res.end(req.url==='/fallback'?html:'Not found');
  });
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  return 'http://127.0.0.1:'+fixture.address().port+'/fallback';
}
async function request(path,{method='GET',auth=false,origin,body}={}){
  const headers={};
  if(auth)headers['X-Admin-Key']=admin;
  if(origin)headers.Origin=origin;
  if(body)headers['Content-Type']='application/json';
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
  try{
    const r=await fetch(url+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:controller.signal});
    const text=await r.text();let json={};
    try{json=JSON.parse(text)}catch{}
    return {status:r.status,text,json,source:r.headers.get('x-praktikum-content-source')};
  }finally{clearTimeout(timeout)}
}
async function startApp(db,fallback){
  if(child)throw Error('CMS already running');
  child=spawn(process.execPath,['server.js'],{
    cwd:require('node:path').resolve(__dirname,'..'),
    env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'test',
      PORT:'19093',REDIS_URL:base+'/'+db,ADMIN_KEY:admin,BASE_HTML_URL:fallback},
    stdio:['ignore','pipe','pipe']
  });
  child.stdout.on('data',d=>process.stdout.write('[CMS] '+d));
  child.stderr.on('data',d=>process.stderr.write('[CMS stderr] '+d));
  for(let i=0;i<80;i++){
    if(child.exitCode!==null)throw Error('CMS exited before ready '+child.exitCode);
    try{const r=await request('/health');if(r.status===200)return}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('CMS did not start');
}
async function stopApp(){
  if(!child)return;
  const old=child;child=null;
  const end=new Promise(resolve=>old.once('exit',resolve));
  old.kill('SIGTERM');
  await Promise.race([end,new Promise((_,reject)=>setTimeout(()=>reject(Error('Stop timeout')),3000))]);
}
async function snapshot(client){
  const values=[];let cursor=0;
  do{
    const scan=await client.scan(cursor,{MATCH:'praktikum:*',COUNT:100});
    cursor=Number(scan.cursor);
    for(const key of scan.keys){
      const ttl=await client.pTTL(key);
      if(ttl===-2)continue;
      // Node-redis v4: binary DUMP must be requested as Buffer, never decoded to UTF-8.
      const dump=await client.dump(client.commandOptions({returnBuffers:true}),key);
      assert.ok(Buffer.isBuffer(dump),'DUMP should return Buffer for '+key);
      values.push({key,type:await client.type(key),ttl,at:Date.now(),payload:dump.toString('base64')});
    }
  }while(cursor!==0);
  return values;
}
async function restore(client,entries){
  for(const e of entries){
    const elapsed=Date.now()-e.at;
    const ttl=e.ttl===-1?0:Math.max(0,e.ttl-elapsed);
    if(e.ttl!==-1&&!ttl)continue;
    await client.restore(e.key,ttl,Buffer.from(e.payload,'base64'));
  }
}
async function run(){
  const db14=await redis(14),db15=await redis(15);
  await db14.flushDb();await db15.flushDb(); // only on disposable Redis and non-default DBs
  const fallback=await fixtureServer();
  await startApp(14,fallback);
  let r=await request('/health');
  check('health reports no saved publication',r.status===200&&r.json.publishedStored===false);
  r=await request('/site');
  check('fallback reads isolated fixture',r.status===200&&r.source==='fallback'&&r.text.includes('SYNTHETIC DATA'));
  r=await request('/publish',{method:'POST',body:{html}});
  check('publish rejects missing key',r.status===401);
  r=await request('/publish',{method:'POST',auth:true,origin:'https://untrusted.invalid',body:{html}});
  check('publish rejects bad Origin',r.status===403);
  r=await request('/publish',{method:'POST',auth:true,body:{html:'invalid'}});
  check('publish rejects bad HTML',r.status===400);
  const published=await request('/publish',{method:'POST',auth:true,body:{html}});
  check('publish stores synthetic page',published.status===200&&published.json.ok===true);
  const original=await request('/site');
  check('GET /site reads Redis copy',original.source==='redis'&&original.text.includes('SYNTHETIC DATA'));
  r=await request('/meta');
  check('meta includes publication timestamp',r.json.updatedAt===published.json.updatedAt);
  r=await request('/stats?days=7');
  check('stats authentication enforced',r.status===401);
  for(const [event,vid] of [['page_view','visitor1'],['page_view','visitor2'],['whatsapp_click','visitor1']]){
    const response=await request('/event',{method:'POST',body:{event,vid,source:'integration',campaign:'synthetic',device:'mobile',lang:'RU'}});
    assert.equal(response.status,204,'Event '+event+' failed');
  }
  const stats=await request('/stats?days=7',{auth:true});
  check('hash and HyperLogLog analytics counts',stats.status===200&&stats.json.totals.page_view===2&&
    stats.json.totals.whatsapp_click===1&&stats.json.uniqueVisitors===2);
  await db14.set('praktikum:integration:ttl','short-lived',{EX:120});
  const data=await snapshot(db14);
  check('binary snapshot includes string, hash and HLL',data.length>=7&&data.some(e=>e.type==='hash')&&
    data.some(e=>e.key.endsWith('visitors')&&e.type==='string'));
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  await restore(db15,data);
  check('RESTORE recreated all keys',await db15.dbSize()===data.length);
  for(const row of data){
    assert.equal(await db15.type(row.key),row.type,'Key type mismatch: '+row.key);
    if(row.ttl>0)assert.ok(await db15.pTTL(row.key)>0,'TTL lost: '+row.key);
  }
  check('restored TTL, hashes and binary HLL',true);
  await stopApp();
  await startApp(15,fallback);
  const page2=await request('/site'),meta2=await request('/meta');
  const stats2=await request('/stats?days=7',{auth:true});
  check('restored CMS HTML identical',page2.status===200&&page2.source==='redis'&&page2.text===original.text);
  check('restored publication timestamp identical',meta2.json.updatedAt===published.json.updatedAt);
  check('restored analytics identical',stats2.status===200&&stats2.json.uniqueVisitors===stats.json.uniqueVisitors&&
    JSON.stringify(stats2.json.totals)===JSON.stringify(stats.json.totals));
  await stopApp();await startApp(15,fallback);
  const page3=await request('/site');
  check('CMS process restart retains restored data',page3.text===original.text);
  check('health confirms restored publication',(await request('/health')).json.publishedStored===true);
  report.keysRestored=data.length;
  report.redisTypes=[...new Set(data.map(e=>e.type))].sort();
  report.syntheticSnapshotHash=fingerprint;
  console.log('ISOLATED_INTEGRATION_RESULT '+JSON.stringify(report));
}
run().catch(err=>{console.error('ISOLATED_INTEGRATION_FAILED',err);process.exitCode=1})
.finally(async()=>{try{await stopApp()}catch{};if(fixture)await new Promise(resolve=>fixture.close(resolve));for(const x of clients)try{await x.quit()}catch{}});
