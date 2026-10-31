'use strict';
// This module NEVER performs Redis writes. It only SCANs, TYPEs, PTTLs and DUMPs
// keys in the Praktikum namespace and returns an encrypted archive.
const crypto=require('node:crypto');
const PREFIX='praktikum:';
const ARCHIVE_FORMAT='praktikum-redis-encrypted-v1';
const AAD=Buffer.from(ARCHIVE_FORMAT);
const MAX_KEYS=7500;
const MAX_PAYLOAD_BYTES=24*1024*1024;
const MAX_SINGLE_KEY_MEMORY_BYTES=MAX_PAYLOAD_BYTES;
const MAX_SCAN_MS=90000;
const SCRYPT={N:16384,r:8,p:1,maxmem:64*1024*1024};

function validatePassphrase(v) {
  if(typeof v!=='string'||v.length<20||v.length>512) {
    const e=new Error('Passphrase must have 20-512 characters');e.status=400;throw e;
  }
}
function encryptionKey(passphrase,salt){
  return crypto.scryptSync(passphrase,salt,32,SCRYPT);
}
async function snapshotReadonly(client){
  const start=new Date().toISOString();
  const startedMs=Date.now();
  // Publication and its timestamp are committed together in the CMS MULTI.
  // Detect a concurrent publish rather than exporting a mixed publication.
  const publishedVersionBefore=await client.get('praktikum:published:updatedAt');
  const seen=new Set();
  const records=[];
  let bytes=0;
  let cursor=0;
  let expiredDuringScan=0;
  let pages=0;
  do{
    if(++pages>20000||Date.now()-startedMs>MAX_SCAN_MS)throw new Error('Backup scan limit exceeded; no file generated');
    const result=await client.scan(cursor,{MATCH:PREFIX+'*',COUNT:250});
    cursor=Number(result.cursor);
    if(!Number.isSafeInteger(cursor)||cursor<0)throw new Error('Invalid Redis SCAN cursor');
    for(const key of result.keys){
      if(typeof key!=='string'||!key.startsWith(PREFIX))throw new Error('Key outside approved namespace');
      if(seen.has(key))continue;
      seen.add(key);
      if(seen.size>MAX_KEYS)throw new Error('Backup key limit exceeded; no partial file generated');
      if(Date.now()-startedMs>MAX_SCAN_MS)throw new Error('Backup time budget exceeded; no file generated');
      // MEMORY USAGE is read-only. Reject obviously oversized keys BEFORE DUMP
      // allocates a potentially huge binary Buffer in the Node process.
      const footprint=await client.memoryUsage(key);
      if(footprint===null)continue; // expired between SCAN and inspection
      if(!Number.isSafeInteger(footprint)||footprint<0)throw new Error('Unexpected MEMORY USAGE result');
      if(footprint>MAX_SINGLE_KEY_MEMORY_BYTES)
        throw new Error('Key memory usage exceeds safe export limit; no file generated');
      const capturedAt=Date.now();
      const pttl=await client.pTTL(key);
      if(pttl===-2){expiredDuringScan++;continue;}
      if(!Number.isInteger(pttl)||pttl< -1)throw new Error('Unexpected PTTL for '+key);
      const data=await client.dump(client.commandOptions({returnBuffers:true}),key);
      if(data===null){expiredDuringScan++;continue;}
      if(!Buffer.isBuffer(data))throw new Error('Backup requires binary Redis DUMP');
      const type=await client.type(key);
      if(type==='none'){expiredDuringScan++;continue;}
      bytes+=data.length;
      if(bytes>MAX_PAYLOAD_BYTES)throw new Error('Backup data size limit exceeded; no partial file generated');
      records.push({key,type,pttl,capturedAt,encodedDump:data.toString('base64')});
    }
  }while(cursor!==0);
  const publishedVersionAfter=await client.get('praktikum:published:updatedAt');
  if(publishedVersionBefore!==publishedVersionAfter)
    throw new Error('Publication changed during backup; retry when no content is being published');
  records.sort((a,b)=>a.key.localeCompare(b.key));
  return {
    format:'praktikum-redis-dump-set-v1',scope:PREFIX+'*',
    startedAt:start,finishedAt:new Date().toISOString(),
    atomic:false, // SCAN cannot guarantee an instant, consistent snapshot during writes.
    publicationVersionUnchanged:true,
    hasPublishedHtml:records.some(r=>r.key==='praktikum:published:html'),
    hasPublishedMetadata:records.some(r=>r.key==='praktikum:published:updatedAt'),
    expiredDuringScan,keys:records.length,unencodedBytes:bytes,
    records
  };
}
function encryptBackup(data,passphrase){
  validatePassphrase(passphrase);
  const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12);
  const key=encryptionKey(passphrase,salt);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(AAD);
  const payload=Buffer.from(JSON.stringify(data),'utf8');
  const encrypted=Buffer.concat([cipher.update(payload),cipher.final()]);
  const tag=cipher.getAuthTag();
  key.fill(0);
  return {
    format:ARCHIVE_FORMAT,algorithm:'aes-256-gcm',
    kdf:'scrypt-n16384-r8-p1',
    salt:salt.toString('base64'),iv:iv.toString('base64'),
    tag:tag.toString('base64'),ciphertext:encrypted.toString('base64')
  };
}
function decryptBackup(archive,passphrase){
  validatePassphrase(passphrase);
  if(!archive||archive.format!==ARCHIVE_FORMAT||
     archive.algorithm!=='aes-256-gcm'||archive.kdf!=='scrypt-n16384-r8-p1')throw Error('Unsupported backup format');
  const salt=Buffer.from(archive.salt,'base64'),iv=Buffer.from(archive.iv,'base64');
  const tag=Buffer.from(archive.tag,'base64'),ciphertext=Buffer.from(archive.ciphertext,'base64');
  if(salt.length!==16||iv.length!==12||tag.length!==16||ciphertext.length>65*1024*1024)throw Error('Invalid archive envelope');
  const key=encryptionKey(passphrase,salt);
  try{
    const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
    decipher.setAAD(AAD);decipher.setAuthTag(tag);
    const plain=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
    const data=JSON.parse(plain.toString('utf8'));
    if(data.format!=='praktikum-redis-dump-set-v1'||!Array.isArray(data.records)||
       data.records.length!==data.keys||data.scope!==PREFIX+'*')throw Error('Invalid decrypted snapshot');
    return data;
  }finally{key.fill(0)}
}
async function exportEncryptedReadonly(client,passphrase){
  validatePassphrase(passphrase);
  return encryptBackup(await snapshotReadonly(client),passphrase);
}
module.exports={exportEncryptedReadonly,snapshotReadonly,decryptBackup,encryptBackup};
