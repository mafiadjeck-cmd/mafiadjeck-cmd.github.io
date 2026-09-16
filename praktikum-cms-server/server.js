const express = require('express');
const { createClient } = require('redis');

const app = express();
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

app.use((req,res,next)=>{
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary','Origin');
  }
  res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Admin-Key');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
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
  return await r.text();
}

app.get('/site', async (req,res)=>{
  try{
    await ensureRedis();
    let html = await redis.get('praktikum:published:html');
    if (!html) html = await fallbackHtml();
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
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
    res.json({ok:true,updatedAt:updatedAt || null});
  }catch(e){res.status(500).json({ok:false});}
});

app.post('/publish', async (req,res)=>{
  try{
    if (req.get('X-Admin-Key') !== adminKey) return res.status(401).json({ok:false,error:'unauthorized'});
    const html = req.body && req.body.html;
    if (typeof html !== 'string' || html.length < 1000 || !/<html[\s>]/i.test(html)) {
      return res.status(400).json({ok:false,error:'invalid_html'});
    }
    if (Buffer.byteLength(html,'utf8') > 12*1024*1024) {
      return res.status(413).json({ok:false,error:'html_too_large'});
    }
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
