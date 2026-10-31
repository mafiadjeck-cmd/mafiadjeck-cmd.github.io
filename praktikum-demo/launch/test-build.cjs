'use strict';
// Run: node praktikum-demo/launch/test-build.cjs
// Offline tests only. No network, DNS changes, live emails or deployments.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const here=__dirname;
const builder=path.join(here,'build-static.mjs');
const source=path.join(here,'..','base.html');
const example=JSON.parse(fs.readFileSync(path.join(here,'seo-email.config.example.json'),'utf8'));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'praktikum-seo-test-'));
let checks=0;
function run(config,url,out){
  const cfg=path.join(temp,'config-'+(++checks)+'.json');
  fs.writeFileSync(cfg,JSON.stringify(config));
  const args=[builder,'--source',source,'--config',cfg,'--site-url',url,'--out',out];
  const result=cp.spawnSync(process.execPath,args,{encoding:'utf8',timeout:15000});
  if(result.error)throw result.error;
  return result;
}
try{
  assert.equal(example.editoriallyApproved,false,'Example config must not allow accidental public release');
  assert.equal(example.contactEmail,'','Mail must be absent until it exists');
  let r=run(example,'https://praktikum.example/',path.join(temp,'blocked'));
  assert.notEqual(r.status,0,'Owner approval must be required');
  assert.ok(!fs.existsSync(path.join(temp,'blocked','index.html')),'No partial release should be emitted without approval');
  const cfg={...example,editoriallyApproved:true};
  const out=path.join(temp,'approved');
  r=run(cfg,'https://praktikum.example/',out);
  assert.equal(r.status,0,r.stderr);
  const ru=fs.readFileSync(path.join(out,'index.html'),'utf8');
  const ky=fs.readFileSync(path.join(out,'ky','index.html'),'utf8');
  const sitemap=fs.readFileSync(path.join(out,'sitemap.xml'),'utf8');
  const robots=fs.readFileSync(path.join(out,'robots.txt'),'utf8');
  assert.ok(ru.includes('data-seo-locale="ru"'));
  assert.ok(ky.includes('data-seo-locale="ky"'));
  assert.ok(ru.includes('rel="canonical" href="https://praktikum.example/"'));
  assert.ok(ky.includes('rel="canonical" href="https://praktikum.example/ky/"'));
  assert.ok(sitemap.includes('hreflang="ru"')&&sitemap.includes('hreflang="ky"')&&sitemap.includes('hreflang="x-default"'));
  assert.ok(robots.includes('Sitemap: https://praktikum.example/sitemap.xml'));
  assert.ok(ru.includes('id="site-data"')&&ky.includes('id="site-data"'));
  assert.ok(ru.includes('location.assign(p)')&&ky.includes('location.assign(p)'));
  assert.ok(!ru.includes('mailto:'),'No unconfirmed email should be displayed');
  r=run({...cfg,contactEmail:'office@praktikum.example'},'https://praktikum.example/',path.join(temp,'with-email'));
  assert.equal(r.status,0,r.stderr);
  assert.ok(fs.readFileSync(path.join(temp,'with-email','index.html'),'utf8').includes('mailto:office@praktikum.example'));
  r=run({...cfg,contactEmail:'fake" onclick="alert(1)'},'https://praktikum.example/',path.join(temp,'invalid-email'));
  assert.notEqual(r.status,0,'Invalid mail must not build');
  r=run(cfg,'http://praktikum.example/',path.join(temp,'http'));
  assert.notEqual(r.status,0,'Plain HTTP release must be rejected');
  r=run(cfg,'https://praktikum.example/admin/',path.join(temp,'bad-path'));
  assert.notEqual(r.status,0,'Non-root URL must be rejected');
  console.log('PASS: SEO and optional future email staging tests. No network or production activity.');
}finally{
  fs.rmSync(temp,{recursive:true,force:true});
}
