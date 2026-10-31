'use strict';
// Real Chromium smoke test, run only on GitHub-hosted runner against local static preview.
// Never sends requests to the production API. Requires 'playwright' in this folder.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || 'review/site');
function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.xml')) return 'application/xml';
  if (file.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}
async function main(){
  assert.ok(fs.existsSync(path.join(root, 'index.html')),'Preview RU entrypoint is missing');
  assert.ok(fs.existsSync(path.join(root,'ky','index.html')),'Preview KY entrypoint is missing');
  const server=http.createServer((request,response)=>{
    try{
      const u=new URL(request.url,'http://127.0.0.1');
      const file=u.pathname==='/'?'index.html':u.pathname==='/ky/'?'ky/index.html':u.pathname.slice(1);
      const full=path.resolve(root,file);
      if(!full.startsWith(root+path.sep)){response.writeHead(403);response.end();return}
      const contents=fs.readFileSync(full);
      response.writeHead(200,{'Content-Type':contentType(full),'Cache-Control':'no-store'});
      response.end(contents);
    }catch(e){response.writeHead(404);response.end('Not found')}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const errors=[],externalRequests=[],overflows=[];
  let browser;
  try{
    browser=await chromium.launch({headless:true});
    for(const [name,viewport] of Object.entries({desktop:{width:1280,height:800},mobile:{width:390,height:844}})){
      const page=await browser.newPage({viewport,serviceWorkers:'block'});
      page.on('pageerror',error=>errors.push(name+': '+String(error)));
      await page.route('**/*',route=>{
        const url=route.request().url();
        if(!url.startsWith(base+'/')){
          externalRequests.push(url);
          return route.abort();
        }
        return route.continue();
      });
      await page.goto(base+'/',{waitUntil:'domcontentloaded'});
      assert.equal(await page.locator('html').getAttribute('lang'),'ru',name+' Russian locale');
      assert.ok((await page.title()).includes('Практикум'),name+' Russian title');
      let pics=await page.locator('img').evaluateAll(async images=>{await Promise.all(images.map(async image=>{image.loading='eager';try{await image.decode()}catch{}}));return images.map(x=>({ok:x.complete&&x.naturalWidth>0,src:x.getAttribute('src')?.slice(0,20)}))});
      assert.equal(pics.length,7,name+' expected seven site images');
      assert.ok(pics.every(x=>x.ok),name+' all images render in RU: '+JSON.stringify(pics));
      assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'),'noindex,nofollow,noarchive');
      await page.locator('button[data-lang="ky"]').first().click();
      await page.waitForURL(base+'/ky/',{timeout:10000});
      assert.equal(await page.locator('html').getAttribute('lang'),'ky',name+' Kyrgyz locale after click');
      assert.ok((await page.title()).includes('Бишкектеги'),name+' Kyrgyz title');
      pics=await page.locator('img').evaluateAll(async images=>{await Promise.all(images.map(async image=>{image.loading='eager';try{await image.decode()}catch{}}));return images.map(x=>x.complete&&x.naturalWidth>0)});
      assert.equal(pics.length,7,name+' KY seven images');
      assert.ok(pics.every(Boolean),name+' KY images loaded: '+JSON.stringify(pics));
      await page.locator('button[data-lang="ru"]').first().click();
      await page.waitForURL(base+'/',{timeout:10000});
      assert.equal(await page.locator('html').getAttribute('lang'),'ru',name+' Russian after returning');
      const burger=page.locator('#burgerBtn');
      if(await burger.isVisible()){
        await burger.click();
        assert.equal(await burger.getAttribute('aria-expanded'),'true',name+' nav opens');
        assert.equal(await page.locator('#mainMenu').isVisible(),true,name+' menu visible when open');
        await page.keyboard.press('Escape');
        assert.equal(await burger.getAttribute('aria-expanded'),'false',name+' nav closes with Escape');
        assert.equal(await page.locator('#mainMenu').isVisible(),false,name+' menu hidden when closed');
      }
      const geometry=await page.evaluate(()=>{
        const rightLimit=window.innerWidth+2;
        return {
          innerWidth:window.innerWidth,
          scrollWidth:document.documentElement.scrollWidth,
          elements:[...document.querySelectorAll('body *')].filter(el=>{
            const r=el.getBoundingClientRect();
            return r.width>1 && r.right>rightLimit;
          }).slice(0,15).map(el=>{
            const rect=el.getBoundingClientRect();
            return {tag:el.tagName,id:el.id,className:String(el.className).slice(0,90),left:Math.round(rect.left),right:Math.round(rect.right),width:Math.round(rect.width)};
          })
        };
      });
      if(geometry.scrollWidth>geometry.innerWidth+2){
        overflows.push({name,...geometry});
        console.error('OVERFLOW_DIAGNOSTIC '+JSON.stringify({name,...geometry}));
      }
      await page.close();
      console.log('PASS '+name+': RU -> KY -> RU clicks, language, titles, images and viewport');
    }
    assert.deepEqual(overflows,[],'Viewport horizontal overflow diagnostic');
    assert.deepEqual(errors,[],'No client-side JavaScript exceptions');
    assert.equal(externalRequests.some(url=>url.includes('onrender.com')),false,'Preview must never call production API');
    console.log('PASS browser: no JS errors and no production API requests (other external resources blocked: '+externalRequests.length+')');
  }finally{
    if(browser)await browser.close();
    await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});
