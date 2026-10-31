'use strict';
// Non-network safety checks for the Praktikum staging branch.
// Run from repo root: node praktikum-cms-server/tests/staging-safety.cjs
// This file does not access production, Redis, or Render credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
function read(relative){ return fs.readFileSync(path.join(root, relative), 'utf8'); }
const server = read('praktikum-cms-server/server.js');
const admin = read('praktikum-demo/admin/index.html');
const home = read('praktikum-demo/index.html');
const base = read('praktikum-demo/base.html');
new Function('require','process','console','fetch', server);
for (const match of admin.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new Function(match[1]);
assert.match(server, /app\.post\('\/publish'/);
assert.match(server, /app\.get\('\/stats'/);
assert.match(server, /app\.get\('\/health'/);
assert.match(server, /X-Praktikum-Content-Source/);
assert.match(server, /publishedStored/);
assert.ok(!server.includes("'PFMERGE'"), 'Statistics should not create temporary HyperLogLog keys');
assert.ok(!server.includes('redis.del(tempVisitors)'), 'Statistics should not delete temporary keys');
assert.match(server, /'PFCOUNT', \.\.\.visitorKeys/);
assert.ok(!admin.includes('sessionStorage'), 'Admin credential must not use sessionStorage');
assert.match(admin, /activeAdminKey/);
assert.match(admin, /name="robots" content="noindex,nofollow,noarchive"/);
assert.match(admin, /name="referrer" content="no-referrer"/);
const jsonPayload = {text:'</script><img src=x onerror=alert(1)>'};
const encodedJson = JSON.stringify(jsonPayload).replace(/</g,'\\u003c');
assert.ok(!encodedJson.includes('</script>'), 'Stored JSON must not close its own script tag');
assert.deepEqual(JSON.parse(encodedJson), jsonPayload, 'Stored JSON must retain its original values');
assert.ok(admin.includes("sd.textContent=JSON.stringify(data).replace(/</g,'\\\\u003c')"),
  'Admin publishing must encode HTML tag openers inside inline JSON');
const helpersSource = admin.slice(admin.indexOf('function replaceAllSafe'),admin.indexOf('let activeAdminKey'));
assert.ok(helpersSource.startsWith('function replaceAllSafe'), 'Contact-validation helpers missing');
const htmlEscape = value => String(value).replace(/[&<>"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));
const helpers = new Function('esc','URL',helpersSource+';return {replaceAllSafe,validateContactSettings}')(htmlEscape, URL);
assert.equal(helpers.replaceAllSafe('<a href="old">','old','" onclick="alert(1)'),'<'+'a href="&quot; onclick=&quot;alert(1)">');
helpers.validateContactSettings({whatsapp:'996220622221',phone:'+996 220 622 221',instagram:'https://www.instagram.com/test',threads:'https://www.threads.net/@test'});
assert.throws(() => helpers.validateContactSettings({instagram:'javascript:alert(1)'}), /Проверьте ссылку|Недопустимая ссылка/);
assert.throws(() => helpers.validateContactSettings({threads:'https://www.threads.net.evil.test'}), /Недопустимая ссылка/);
assert.ok(admin.includes('siteDataMarker'), 'CMS inline JSON must be excluded from raw HTML contact substitution');
assert.match(home, /fetch\('https:\/\/praktikum-cms-api\.onrender\.com\/site/);
assert.match(base, /id="site-data"/);

const loaderMatch = home.match(/<script>([\s\S]*?)<\/script>/i);
assert.ok(loaderMatch, 'Public entrypoint must include loader script');
const loadPage = new Function('fetch','document','AbortController','setTimeout','clearTimeout','Date','console','return '+loaderMatch[1].trim());
async function checkLoader(mode){
  let usedFallback=false, aborted=false, cleared=false, waitMs=0, written='';
  const documentStub={open(){},write(s){written=s},close(){},body:{innerHTML:''}};
  class AbortStub {
    constructor(){this.signal={onabort:null,aborted:false}}
    abort(){aborted=true;this.signal.aborted=true;if(this.signal.onabort)this.signal.onabort()}
  }
  const schedule=(callback,ms)=>{
    waitMs=ms;
    if(mode==='timeout') Promise.resolve().then(callback);
    return 123;
  };
  const fetchStub=(url,opts)=>{
    if(url.includes('onrender.com')){
      if(mode==='error')return Promise.resolve({ok:false,status:503});
      if(mode==='timeout')return new Promise((resolve,reject)=>{opts.signal.onabort=()=>reject(new Error('aborted'))});
      return Promise.resolve({ok:true,text:async()=>'<html>CMS VERSION</html>'});
    }
    if(url.startsWith('base.html')){
      usedFallback=true;
      return Promise.resolve({ok:true,text:async()=>'<html>FALLBACK VERSION</html>'});
    }
    throw Error('Unexpected URL '+url);
  };
  await loadPage(fetchStub,documentStub,AbortStub,schedule,()=>{cleared=true},Date,{error(){}});
  assert.equal(waitMs,4000,'CMS wait must be bounded to four seconds');
  assert.ok(cleared,'Timer must be cleared');
  if(mode==='ok'){
    assert.ok(written.includes('CMS VERSION'),'Live CMS response should be displayed');
    assert.ok(!usedFallback,'Fallback should not be requested after CMS success');
  }else{
    assert.ok(written.includes('FALLBACK VERSION'),'Fallback HTML must be displayed');
    assert.ok(usedFallback,'Fallback file should be fetched');
    if(mode==='timeout')assert.ok(aborted,'CMS request should be cancelled on timeout');
  }
}
(async()=>{
  await checkLoader('ok');
  await checkLoader('error');
  await checkLoader('timeout');
  console.log('Praktikum staging safety checks: PASS (offline; 3 entrypoint scenarios; not live API).');
})().catch(e=>{console.error(e);process.exitCode=1});

