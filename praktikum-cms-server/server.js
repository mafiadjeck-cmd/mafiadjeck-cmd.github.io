const express = require('express');
const crypto = require('crypto');
const { createClient } = require('redis');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const port = process.env.PORT || 10000;
const redisUrl = process.env.REDIS_URL;
const adminKey = process.env.ADMIN_KEY;
const baseUrl = process.env.BASE_HTML_URL || 'https://raw.githubusercontent.com/mafiadjeck-cmd/mafiadjeck-cmd.github.io/main/praktikum-demo/base.html';
const allowedOrigins = new Set([
  'https://mafiadjeck-cmd.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]);

if (!redisUrl) throw new Error('REDIS_URL is required');
if (!adminKey) throw new Error('ADMIN_KEY is required');

const redis = createClient({ url: redisUrl });
redis.on('error', err => console.error('Redis error', err));
let redisReady = false;
async function ensureRedis(){
  if (!redisReady){
    if (!redis.isOpen) await redis.connect();
    await redis.ping();
    redisReady = true;
  }
}

const failures = new Map();
const publishes = new Map();
const eventsByIp = new Map();
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 30 * 60 * 1000;
const MAX_FAILURES = 5;
const PUBLISH_WINDOW_MS = 10 * 60 * 1000;
const MAX_PUBLISHES = 20;
const EVENT_WINDOW_MS = 60 * 1000;
const MAX_EVENTS_PER_MINUTE = 120;
const EVENT_NAMES = new Set(['page_view','whatsapp_click','phone_click','instagram_click','cta_click','lang_ru','lang_kg','trainer_action']);

function clientId(req){ return req.ip || req.socket.remoteAddress || 'unknown'; }
function safeEqual(a,b){
  const ah = crypto.createHash('sha256').update(String(a || '')).digest();
  const bh = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ah,bh);
}
function checkBlocked(id){
  const now = Date.now();
  const item = failures.get(id);
  if (!item) return 0;
  if (item.blockedUntil && item.blockedUntil > now) return item.blockedUntil - now;
  item.times = (item.times || []).filter(t => now - t < FAIL_WINDOW_MS);
  item.blockedUntil = 0;
  if (!item.times.length) failures.delete(id);
  return 0;
}
function registerFailure(id){
  const now = Date.now();
  const item = failures.get(id) || {times:[],blockedUntil:0};
  item.times = item.times.filter(t => now - t < FAIL_WINDOW_MS);
  item.times.push(now);
  if (item.times.length >= MAX_FAILURES) item.blockedUntil = now + BLOCK_MS;
  failures.set(id,item);
  return item.blockedUntil > now;
}
function allowPublish(id){
  const now = Date.now();
  const list = (publishes.get(id) || []).filter(t => now - t < PUBLISH_WINDOW_MS);
  if (list.length >= MAX_PUBLISHES) { publishes.set(id,list); return false; }
  list.push(now); publishes.set(id,list); return true;
}
function allowEvent(id){
  const now = Date.now();
  const list = (eventsByIp.get(id) || []).filter(t => now - t < EVENT_WINDOW_MS);
  if (list.length >= MAX_EVENTS_PER_MINUTE) { eventsByIp.set(id,list); return false; }
  list.push(now); eventsByIp.set(id,list); return true;
}
function cleanToken(v,max=80){
  return String(v || '').trim().replace(/[^\p{L}\p{N}._:@+\-/ ]/gu,'').slice(0,max) || 'direct';
}
function dayKey(date = new Date()){
  return date.toISOString().slice(0,10);
}
function statsAuth(req,res){
  const id = clientId(req);
  const wait = checkBlocked(id);
  if (wait > 0) {
    res.setHeader('Retry-After', String(Math.ceil(wait/1000)));
    res.status(429).json({ok:false,error:'too_many_attempts'});
    return false;
  }
  if (!safeEqual(req.get('X-Admin-Key'), adminKey)) {
    const blocked = registerFailure(id);
    if (blocked) res.setHeader('Retry-After', String(Math.ceil(BLOCK_MS/1000)));
    res.status(blocked ? 429 : 401).json({ok:false,error:blocked ? 'too_many_attempts' : 'unauthorized'});
    return false;
  }
  failures.delete(id);
  return true;
}
function analyticsScript(){
  return `<script id="praktikum-first-party-analytics">(function(){
var API='https://praktikum-cms-api.onrender.com';
function vid(){try{var k='praktikum-anon-visitor',v=localStorage.getItem(k);if(!v){v=(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));localStorage.setItem(k,v)}return v}catch(e){return 'session-'+Math.random().toString(36).slice(2)}}
function source(){try{var u=new URL(location.href),s=u.searchParams.get('utm_source');if(s)return s;var r=document.referrer;if(!r)return 'direct';return new URL(r).hostname.replace(/^www\\./,'')}catch(e){return 'direct'}}
function campaign(){try{return new URL(location.href).searchParams.get('utm_campaign')||''}catch(e){return ''}}
function device(){return innerWidth<768?'mobile':innerWidth<1100?'tablet':'desktop'}
function lang(){return document.documentElement.getAttribute('lang-mode')==='ky'?'KG':'RU'}
function send(event,extra){var body=JSON.stringify(Object.assign({event:event,vid:vid(),source:source(),campaign:campaign(),device:device(),lang:lang(),path:location.pathname},extra||{}));try{if(navigator.sendBeacon){var b=new Blob([body],{type:'application/json'});if(navigator.sendBeacon(API+'/event',b))return}}catch(e){}fetch(API+'/event',{method:'POST',headers:{'Content-Type':'application/json'},body:body,keepalive:true}).catch(function(){})}
window.__praktikumTrack=send;
send('page_view');
document.addEventListener('click',function(e){var a=e.target.closest('a,button');if(!a)return;var href=(a.getAttribute('href')||'').toLowerCase();var dl=a.getAttribute('data-lang');if(dl==='ru')send('lang_ru');else if(dl==='ky')send('lang_kg');if(href.indexOf('wa.me/')>=0||href.indexOf('api.whatsapp.com')>=0)send('whatsapp_click');else if(href.indexOf('tel:')===0)send('phone_click');else if(href.indexOf('instagram.com')>=0)send('instagram_click');else if(a.matches('.btn,.btn-primary,.btn-ghost,[class*=cta]'))send('cta_click',{label:(a.textContent||'').trim().slice(0,60)});if(a.closest('[id*=trainer],[class*=trainer],[id*=practice],[class*=practice]'))send('trainer_action')},true);
})();</script>`;
}
function normalizePublicHtml(html){
  let out = String(html).replace(/(<button\b[^>]*\bdata-lang=(['"])ky\2[^>]*>)\s*KY\s*(<\/button>)/gi,'$1KG$3');
  if (!/id=["']praktikum-first-party-analytics["']/i.test(out)) {
    const s = analyticsScript();
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, s + '</body>') : out + s;
  }
  return out;
}

app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Frame-Options','DENY');
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary','Origin');
  }
  if (req.method === 'POST' && origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ok:false,error:'origin_forbidden'});
  }
  res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Admin-Key');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    if (origin && !allowedOrigins.has(origin)) return res.sendStatus(403);
    return res.sendStatus(204);
  }
  next();
});
app.use(express.json({ limit: '15mb', type:['application/json','text/plain','application/*+json'] }));

app.get('/', (req,res)=>res.json({ok:true,service:'praktikum-cms'}));
app.get('/health', async (req,res)=>{
  try{ await ensureRedis(); res.json({ok:true}); }
  catch(e){ console.error('Health storage error',e); res.status(500).json({ok:false,error:'storage_unavailable'}); }
});

async function fallbackHtml(){
  const r = await fetch(baseUrl, { cache: 'no-store' });
  if (!r.ok) throw new Error('base_fetch_failed_'+r.status);
  return normalizePublicHtml(await r.text());
}

app.get('/site', async (req,res)=>{
  try{
    await ensureRedis();
    let html = await redis.get('praktikum:published:html');
    if (!html) html = await fallbackHtml();
    html = normalizePublicHtml(html);
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','no-store, max-age=0');
    res.send(html);
  }catch(e){
    console.error(e);
    res.status(500).type('text').send('Практикум временно недоступен');
  }
});

app.get('/meta', async (req,res)=>{
  try{
    await ensureRedis();
    const updatedAt = await redis.get('praktikum:published:updatedAt');
    res.setHeader('Cache-Control','no-store');
    res.json({ok:true,updatedAt:updatedAt || null});
  }catch(e){res.status(500).json({ok:false});}
});

app.post('/event', async (req,res)=>{
  try{
    const id = clientId(req);
    if (!allowEvent(id)) return res.status(429).json({ok:false,error:'rate_limited'});
    const b = req.body || {};
    const event = String(b.event || '');
    if (!EVENT_NAMES.has(event)) return res.status(400).json({ok:false,error:'invalid_event'});
    const visitor = cleanToken(b.vid,120);
    const source = cleanToken(b.source,80);
    const campaign = cleanToken(b.campaign,100);
    const device = ['mobile','tablet','desktop'].includes(b.device) ? b.device : 'other';
    const lang = b.lang === 'KG' ? 'KG' : 'RU';
    const day = dayKey();
    await ensureRedis();
    const multi = redis.multi()
      .hIncrBy('praktikum:analytics:totals', event, 1)
      .hIncrBy(`praktikum:analytics:day:${day}`, event, 1)
      .hIncrBy('praktikum:analytics:sources', source, 1)
      .hIncrBy('praktikum:analytics:devices', device, 1)
      .hIncrBy('praktikum:analytics:langs', lang, 1)
      .pfAdd('praktikum:analytics:visitors', visitor)
      .pfAdd(`praktikum:analytics:visitors:${day}`, visitor)
      .expire(`praktikum:analytics:day:${day}`, 400*24*3600)
      .expire(`praktikum:analytics:visitors:${day}`, 400*24*3600);
    if (campaign && campaign !== 'direct') multi.hIncrBy('praktikum:analytics:campaigns', campaign, 1);
    await multi.exec();
    res.status(204).end();
  }catch(e){
    console.error('Analytics event error',e);
    res.status(500).json({ok:false,error:'analytics_failed'});
  }
});

app.get('/stats', async (req,res)=>{
  try{
    if (!statsAuth(req,res)) return;
    await ensureRedis();
    const days = Math.min(Math.max(parseInt(req.query.days || '30',10) || 30,7),90);
    const dates=[];
    for(let i=days-1;i>=0;i--){ const d=new Date(); d.setUTCDate(d.getUTCDate()-i); dates.push(dayKey(d)); }
    const totals = await redis.hGetAll('praktikum:analytics:totals');
    const uniqueVisitors = await redis.pfCount('praktikum:analytics:visitors');
    const sourcesRaw = await redis.hGetAll('praktikum:analytics:sources');
    const campaignsRaw = await redis.hGetAll('praktikum:analytics:campaigns');
    const devicesRaw = await redis.hGetAll('praktikum:analytics:devices');
    const langsRaw = await redis.hGetAll('praktikum:analytics:langs');
    const daily=[];
    for(const date of dates){
      const [row,unique] = await Promise.all([
        redis.hGetAll(`praktikum:analytics:day:${date}`),
        redis.pfCount(`praktikum:analytics:visitors:${date}`)
      ]);
      daily.push({date,uniqueVisitors:Number(unique||0),...Object.fromEntries(Object.entries(row).map(([k,v])=>[k,Number(v)]))});
    }
    const top = o => Object.entries(o||{}).map(([name,value])=>({name,value:Number(value)})).sort((a,b)=>b.value-a.value).slice(0,12);
    res.setHeader('Cache-Control','no-store');
    res.json({
      ok:true,
      rangeDays:days,
      totals:Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,Number(v)])),
      uniqueVisitors:Number(uniqueVisitors||0),
      daily,
      sources:top(sourcesRaw),
      campaigns:top(campaignsRaw),
      devices:top(devicesRaw),
      langs:top(langsRaw)
    });
  }catch(e){
    console.error('Stats error',e);
    res.status(500).json({ok:false,error:'stats_failed'});
  }
});

app.post('/publish', async (req,res)=>{
  try{
    if (!statsAuth(req,res)) return;
    const id = clientId(req);
    if (!allowPublish(id)) return res.status(429).json({ok:false,error:'publish_rate_limited'});

    let html = req.body && req.body.html;
    if (typeof html !== 'string' || html.length < 1000 || !/<html[\s>]/i.test(html) || !/id=["']site-data["']/i.test(html)) {
      return res.status(400).json({ok:false,error:'invalid_html'});
    }
    if (Buffer.byteLength(html,'utf8') > 12*1024*1024) {
      return res.status(413).json({ok:false,error:'html_too_large'});
    }
    html = normalizePublicHtml(html);
    await ensureRedis();
    const now = new Date().toISOString();
    await redis.multi()
      .set('praktikum:published:html', html)
      .set('praktikum:published:updatedAt', now)
      .exec();
    res.json({ok:true,updatedAt:now});
  }catch(e){
    console.error(e);
    res.status(500).json({ok:false,error:'publish_failed'});
  }
});

(async()=>{
  try{
    await ensureRedis();
    console.log('Praktikum CMS storage connected');
  }catch(e){
    console.error('Praktikum CMS storage connection failed', e);
  }
  app.listen(port, '0.0.0.0', ()=>console.log(`Praktikum CMS API on ${port}`));
})();
