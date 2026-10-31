#!/usr/bin/env node
'use strict';
// Decrypt and restore a Praktikum encrypted export into an EMPTY,
// isolated localhost Valkey/Redis DB15. NEVER targets the public CMS.
// No FLUSHDB, DEL, overwrite or automatic production deployment.
const fs=require('node:fs');
const crypto=require('node:crypto');
const {createClient}=require('redis');
const {decryptBackup}=require('./backup-export.cjs');
const {hiddenQuestion,inspect}=require('./download-encrypted.cjs');

const TARGET='redis://127.0.0.1:6379/15';
const MAX_ARCHIVE=65*1024*1024, MAX_KEYS=7500, MAX_RAW_DUMPS=24*1024*1024;
const confirmation='RESTORE_TO_EMPTY_LOCAL_DB15_ONLY';
function validateTarget(url){
  if(url!==TARGET)throw Error('REFUSED: only '+TARGET+' is permitted; no external Redis/Valkey hosts');
}
function assertArchive(data){
  const details=inspect(data);
  if(!Number.isSafeInteger(data.keys)||data.keys>MAX_KEYS ||data.keys!==data.records.length)
    throw Error('Invalid key count');
  if(data.publicationVersionUnchanged!==true||data.atomic!==false)
    throw Error('Unsupported or inconsistent backup metadata');
  if(!details.hasPublishedHtml||!details.hasPublishedMetadata)
    throw Error('Refusing incomplete site recovery: published HTML and metadata both required');
  const now=Date.now();
  let rawBytes=0,expired=0;
  const prepared=[];
  for(const item of data.records){
    if(!['string','hash','list','set','zset','stream'].includes(item.type) ||
       !Number.isSafeInteger(item.pttl)||item.pttl< -1 ||
       !Number.isFinite(item.capturedAt)||item.capturedAt>now+60000 ||
       !Number.isFinite(data.unencodedBytes))
      throw Error('Invalid Redis key metadata');
    // Strict base64 validation; reject huge entries before Buffer allocation.
    if(typeof item.encodedDump!=='string'||item.encodedDump.length===0||
       item.encodedDump.length>Math.ceil(MAX_RAW_DUMPS*4/3)+4||
       !/^[A-Za-z0-9+/]+={0,2}$/.test(item.encodedDump))
      throw Error('Invalid encoded DUMP');
    const payload=Buffer.from(item.encodedDump,'base64');
    if(payload.toString('base64')!==item.encodedDump)throw Error('Non-canonical base64 data');
    rawBytes+=payload.length;
    if(rawBytes>MAX_RAW_DUMPS)throw Error('Backup exceeds validated size limit');
    let ttl=0;
    if(item.pttl!==-1){
      ttl=item.pttl-Math.max(0,now-item.capturedAt);
      if(ttl<=0){expired++;continue}
      ttl=Math.max(1,Math.floor(ttl));
    }
    prepared.push({key:item.key, type:item.type,ttl,payload});
  }
  if(rawBytes!==data.unencodedBytes)throw Error('Snapshot data size mismatch');
  if(!prepared.some(x=>x.key==='praktikum:published:html')||
     !prepared.some(x=>x.key==='praktikum:published:updatedAt'))
    throw Error('Published page or metadata expired; refusing partial restore');
  return {details,prepared,expired};
}
async function restoreToEmptyLocal(client,data,options={}){
  validateTarget(options.target);
  if(options.confirmation!==confirmation)throw Error('Explicit isolated-target confirmation required');
  const parsed=assertArchive(data);
  if(!client?.isOpen)throw Error('Target Redis connection is not open');
  if(await client.dbSize()!==0)throw Error('Refusing to modify non-empty isolated database (DBSIZE != 0)');
  // After all preflight checks, only RESTORE (no REPLACE), TYPE and PTTL are used.
  // If the restore fails partway, the target must be discarded manually.
  let restored=0;
  try {
    for(const item of parsed.prepared){
      await client.restore(item.key,item.ttl,item.payload); // no REPLACE
      restored++;
      if(await client.type(item.key)!==item.type)throw Error('Restored key has wrong type: '+item.key);
      if(item.ttl>0&&await client.pTTL(item.key)<0)throw Error('Restored key lost TTL: '+item.key);
    }
    if(await client.dbSize()!==restored)throw Error('Unexpected target key count after restore');
    return {restored,skippedExpired:parsed.expired,
      hasPublishedHtml:parsed.details.hasPublishedHtml,
      hasPublishedMetadata:parsed.details.hasPublishedMetadata,
      sourceAtomic:parsed.details.atomic};
  }catch(err){
    throw Error('PARTIAL RESTORE MAY EXIST IN DB15; DO NOT USE IT AS A VERIFIED BACKUP: '+err.message);
  }
}
async function main(){
  if(process.argv.length!==3)throw Error('Usage: node backup/restore-isolated.cjs /secure/path/encrypted-backup.json');
  const file=process.argv[2], stat=fs.statSync(file);
  if(!stat.isFile()||stat.size>MAX_ARCHIVE)throw Error('Invalid or excessive archive size');
  validateTarget(TARGET);
  const passphrase=await hiddenQuestion('Archive passphrase (hidden): ');
  const confirm=await hiddenQuestion('Type RESTORE_TO_EMPTY_LOCAL_DB15_ONLY to restore to LOCAL empty DB15: ');
  if(confirm!==confirmation)throw Error('User did not confirm isolated local recovery');
  const archive=JSON.parse(fs.readFileSync(file,'utf8'));
  const data=decryptBackup(archive,passphrase);
  const planned=assertArchive(data);
  console.log('Preflight: '+planned.prepared.length+' keys eligible, '+planned.expired+' keys expired; no writes yet.');
  const client=createClient({url:TARGET, socket:{connectTimeout:3500,reconnectStrategy:false}});
  client.on('error',()=>console.error('Local Valkey connection error'));
  try{
    await client.connect();
    const result=await restoreToEmptyLocal(client,data,{target:TARGET,confirmation});
    console.log('PASS: '+JSON.stringify(result));
    console.log('Review the local restored CMS and statistics before treating any production backup as verified.');
  }finally{if(client.isOpen)await client.quit()}
}
if(require.main===module)main().catch(err=>{console.error('RESTORE FAILED: '+err.message);process.exitCode=1});
module.exports={TARGET,confirmation,validateTarget,assertArchive,restoreToEmptyLocal};
