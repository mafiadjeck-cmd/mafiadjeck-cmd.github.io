'use strict';
// ONLY disposable localhost Redis under GitHub Actions; never connect to production.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createClient}=require('redis');
const {decryptBackup}=require('../backup/backup-export.cjs');
assert.equal(process.env.GITHUB_ACTIONS,'true','Refusing to run outside isolated GitHub Actions');
assert.equal(process.env.INTEGRATION_REDIS_BASE,'redis://127.0.0.1:6379','Refusing external Redis');
const redisBase='redis://127.0.0.1:6379',url='http://127.0.0.1:19194';
const admin='SYNTHETIC_ADMIN_CREDENTIAL_DO_NOT_USE_IN_PRODUCTION';
const backupKey='SYNTHETIC_BACKUP_2ND_FACTOR_ONLY_73_c9a3e3cbf9';
const passphrase='Synthetic encryption test phrase is sufficiently long 1009!';
const fakeHtml='<!doctype html><html lang="ru"><head><title>EXAMPLE</title></head><body>'
 +'<script id="site-data" type="application/json">{"synthetic":true}</script>'
 +'<main>'+'Synthetic published training only! '.repeat(70)+'</main></body></html>';
const report={checks:[],scope:'isolated-localhost-only',realClientData:false,originWrites:false};
let app=null,clientA=null,clientB=null;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function check(name,cond){assert.ok(cond,'FAILED '+name);report.checks.push(name);console.log('PASS '+name)}
async function startApp(enabled){
  assert.equal(app,null);
  app=spawn(process.execPath,['server.js'],{
    cwd:require('node:path').resolve(__dirname,'..'),
    env:{
      PATH:process.env.PATH,HOME:process.env.HOME,PORT:'19194',
      REDIS_URL:redisBase+'/14',
      ADMIN_KEY:admin,
      ENABLE_BACKUP_EXPORT:enabled?'true':'false',
      BACKUP_EXPORT_KEY:enabled?backupKey:'',
      NODE_ENV:'test'
    },
    stdio:['ignore','pipe','pipe']
  });
  app.stdout.on('data',d=>process.stdout.write('[isolated CMS] '+d));
  app.stderr.on('data',d=>process.stderr.write('[isolated CMS error] '+d));
  for(let n=0;n<100;n++){
    if(app.exitCode!==null)throw Error('Test CMS terminated '+app.exitCode);
    try{const r=await request('/health');if(r.status===200)return;}catch{}
    await sleep(80);
  }
  throw Error('Isolated test CMS failed to start');
}
async function stopApp(){
  if(!app)return;
  const old=app;app=null;
  const ended=new Promise(resolve=>old.once('exit',resolve));
  old.kill('SIGTERM');
  await Promise.race([ended,sleep(4000).then(()=>{throw Error('App termination timeout')})]);
}
async function request(route,{method='GET',adminCredential,backupCredential,body,origin}={}){
  const headers={};
  if(adminCredential!==undefined)headers['X-Admin-Key']=adminCredential;
  if(backupCredential!==undefined)headers['X-Backup-Key']=backupCredential;
  if(origin)headers.Origin=origin;
  if(body!==undefined)headers['Content-Type']='application/json';
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),15000);
  try{
    const r=await fetch(url+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:ctl.signal});
    let parsed=null;
    const raw=await r.text();
    try{parsed=JSON.parse(raw)}catch{}
    return {status:r.status,json:parsed,raw,headers:r.headers};
  }finally{clearTimeout(timer)}
}
async function run(){
  clientA=createClient({url:redisBase+'/14'});
  clientB=createClient({url:redisBase+'/15'});
  for(const c of [clientA,clientB]){c.on('error',e=>console.error('Local redis error',e));await c.connect()}
  await clientA.flushDb();await clientB.flushDb(); // Only on disposable runner, DB14/DB15
  await startApp(false);
  let response=await request('/backup/export',{method:'POST',adminCredential:admin,backupCredential:backupKey,body:{passphrase}});
  check('backup endpoint is invisible by default (404)',response.status===404);
  await stopApp();

  await startApp(true);
  response=await request('/backup/export',{method:'POST',backupCredential:backupKey,body:{passphrase}});
  check('missing administrative credential denied',response.status===401);
  response=await request('/backup/export',{method:'POST',adminCredential:admin,backupCredential:'not-correct',body:{passphrase}});
  check('second backup credential is mandatory',response.status===401);
  response=await request('/backup/export',{method:'POST',adminCredential:admin,backupCredential:backupKey,body:{passphrase:'short'}});
  check('weak backup passphrase rejected',response.status===400);
  response=await request('/backup/export',{method:'POST',adminCredential:admin,backupCredential:backupKey,origin:'https://attacker.example',body:{passphrase}});
  check('unknown Origin blocked',response.status===403);

  const p=await request('/publish',{method:'POST',adminCredential:admin,body:{html:fakeHtml}});
  check('synthetic published HTML stored',p.status===200&&p.json?.ok===true);
  const event=await request('/event',{method:'POST',body:{event:'page_view',vid:'synthetic_visitor',source:'fixture',device:'mobile',lang:'RU'}});
  check('synthetic visit stored',event.status===204);
  await clientA.set('praktikum:backup:expires','temporary',{PX:120000});
  // Exercise multi-page SCAN and thousands of Redis DUMP calls, not only a tiny fixture.
  const batch=clientA.multi();
  for(let i=0;i<1200;i++)batch.set('praktikum:backup:bulk:'+String(i).padStart(4,'0'),'synthetic-'+i);
  await batch.exec();
  await clientA.set('not-praktikum:secret','NEVER_INCLUDED_IN_EXPORT');
  const beforeSite=(await request('/site')).raw;
  const beforeStats=(await request('/stats?days=7',{adminCredential:admin})).json;
  response=await request('/backup/export',{method:'POST',adminCredential:admin,backupCredential:backupKey,body:{passphrase}});
  check('authorized encrypted export succeeded',response.status===200&&response.json?.format==='praktikum-redis-encrypted-v1');
  const encrypted=response.json;
  check('ciphertext does not contain plaintext HTML, Redis key names or other-app value',
    !response.raw.includes('SYNTHETIC_DATA') && !response.raw.includes('praktikum:published:html') && !response.raw.includes('NEVER_INCLUDED_IN_EXPORT'));
  check('response disables caching',response.headers.get('cache-control')?.includes('no-store'));
  const snapshot=decryptBackup(encrypted,passphrase);
  check('read-only snapshot covers 1200 extra synthetic keys across SCAN pages',snapshot.keys>=1206&&snapshot.records.some(r=>r.key==='praktikum:published:html')&&snapshot.records.some(r=>r.type==='hash'));
  check('namespace filter excludes unrelated keys',snapshot.records.every(r=>r.key.startsWith('praktikum:'))&&!snapshot.records.some(r=>r.key==='not-praktikum:secret'));
  check('snapshot is explicitly labeled non-atomic',snapshot.atomic===false);
  check('encrypted archive rejects wrong password',(()=>{try{decryptBackup(encrypted,'completely wrong but sufficiently long password');return false}catch{return true}})());
  const changed={...encrypted,ciphertext:encrypted.ciphertext.slice(0,-4)+'AAAA'};
  check('encrypted archive detects tampering',(()=>{try{decryptBackup(changed,passphrase);return false}catch{return true}})());
  let restored=0;
  for(const key of snapshot.records){
    const elapsed=Date.now()-key.capturedAt;
    const ttl=key.pttl===-1?0:Math.max(0,key.pttl-elapsed);
    if(key.pttl!==-1 && ttl===0)continue;
    await clientB.restore(key.key,ttl,Buffer.from(key.encodedDump,'base64'));
    assert.equal(await clientB.type(key.key),key.type);
    if(key.pttl>0)assert.ok(await clientB.pTTL(key.key)>0);
    restored++;
  }
  check('every captured entry restored into isolated DB15',restored===snapshot.records.length);
  check('published page matches across isolated Redis instances',
    (await clientA.get('praktikum:published:html'))===(await clientB.get('praktikum:published:html')));
  const keysA=await clientA.hGetAll('praktikum:analytics:totals'),keysB=await clientB.hGetAll('praktikum:analytics:totals');
  check('analytics totals match in restored DB',JSON.stringify(keysA)===JSON.stringify(keysB));
  const vA=await clientA.pfCount('praktikum:analytics:visitors'),vB=await clientB.pfCount('praktikum:analytics:visitors');
  check('visitor HLL matches',vA===1&&vB===1);
  const afterSite=(await request('/site')).raw;
  const afterStats=(await request('/stats?days=7',{adminCredential:admin})).json;
  check('readonly export did not alter production-like test CMS content or statistics',
    beforeSite===afterSite&&JSON.stringify(beforeStats.totals)===JSON.stringify(afterStats.totals));
  response=await request('/backup/export',{method:'POST',adminCredential:admin,backupCredential:backupKey,body:{passphrase}});
  check('export cooldown prevents rapid repeated downloads',response.status===429);
  report.exportedKeys=snapshot.keys;report.restoredKeys=restored;
  console.log('BACKUP_EXPORT_TEST_RESULT '+JSON.stringify(report));
}
run().catch(err=>{console.error('BACKUP_EXPORT_INTEGRATION_FAILED',err);process.exitCode=1}).finally(async()=>{
  try{await stopApp()}catch{}
  for(const c of [clientA,clientB])if(c?.isOpen)try{await c.quit()}catch{}
});
