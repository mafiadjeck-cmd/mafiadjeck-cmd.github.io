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
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 30 * 60 * 1000;
const MAX_FAILURES = 5;
const PUBLISH_WINDOW_MS = 10 * 60 * 1000;
const MAX_PUBLISHES = 20;

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
function normalizePublicHtml(html){
  return String(html).replace(/(<button\b[^>]*\bdata-lang=(['\"])ky\2[^>]*>)\s*KY\s*(<\/button>)/gi,'$1KG$3');
}

app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
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
app.use(express.json({ limit: '15mb' }));

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

app.post('/publish', async (req,res)=>{
  try{
    const id = clientId(req);
    const wait = checkBlocked(id);
    if (wait > 0) {
      res.setHeader('Retry-After', String(Math.ceil(wait/1000)));
      return res.status(429).json({ok:false,error:'too_many_attempts'});
    }
    if (!safeEqual(req.get('X-Admin-Key'), adminKey)) {
      const blocked = registerFailure(id);
      if (blocked) res.setHeader('Retry-After', String(Math.ceil(BLOCK_MS/1000)));
      return res.status(blocked ? 429 : 401).json({ok:false,error:blocked ? 'too_many_attempts' : 'unauthorized'});
    }
    failures.delete(id);
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
