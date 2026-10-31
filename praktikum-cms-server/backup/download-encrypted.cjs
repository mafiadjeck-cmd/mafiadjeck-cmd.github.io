#!/usr/bin/env node
'use strict';
// Downloads an AES-256-GCM encrypted app-only backup through the designated
// HTTPS endpoint. Secrets are typed into a TTY and never passed via shell flags.
// No live export is possible while the protected route is disabled (default).
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {decryptBackup}=require('./backup-export.cjs');
const URL='https://praktikum-cms-api.onrender.com/backup/export';
function hiddenQuestion(question){
  if(!process.stdin.isTTY||typeof process.stdin.setRawMode!=='function')
    return Promise.reject(Error('Secure interactive terminal required; redirected input is not accepted.'));
  return new Promise((resolve,reject)=>{
    process.stdout.write(question);
    const input=process.stdin;
    let value='';
    let finished=false;
    const clean=()=>{
      if(finished)return;
      finished=true;
      input.removeListener('data',onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
    };
    const onData=chunk=>{
      for(const character of String(chunk)){
        if(character==='\u0003'){clean();reject(Error('Cancelled'));return}
        if(character==='\r'||character==='\n'){clean();resolve(value);return}
        if(character==='\u007f'||character==='\b'){value=value.slice(0,-1);continue}
        if(character.charCodeAt(0)>=32&&value.length<512)value+=character;
      }
    };
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    input.on('data',onData);
  });
}
function inspect(snapshot){
  if(snapshot.scope!=='praktikum:*'||snapshot.atomic!==false)
    throw Error('Unsupported scope or missing consistency notice');
  if(snapshot.keys<1)throw Error('Archive contains no application keys');
  const seen=new Set();
  for(const item of snapshot.records){
    if(typeof item.key!=='string'||!item.key.startsWith('praktikum:')||
       seen.has(item.key)||!Number.isInteger(item.pttl)||item.pttl< -1||
       !Number.isFinite(item.capturedAt)||!item.encodedDump||
       !['string','hash','list','set','zset','stream'].includes(item.type))
      throw Error('Unexpected key in decrypted archive');
    seen.add(item.key);
  }
  const hasPublishedHtml=seen.has('praktikum:published:html');
  const hasPublishedMetadata=seen.has('praktikum:published:updatedAt');
  if(snapshot.hasPublishedHtml!==hasPublishedHtml||
     snapshot.hasPublishedMetadata!==hasPublishedMetadata||
     snapshot.publicationVersionUnchanged!==true)
    throw Error('Inconsistent publication completeness metadata');
  return {keys:seen.size,finishedAt:snapshot.finishedAt,scope:snapshot.scope,
    atomic:snapshot.atomic,expiredDuringScan:snapshot.expiredDuringScan,
    hasPublishedHtml,hasPublishedMetadata};
}
async function main(){
  if(process.argv.length!==2)
    throw Error('No command line arguments accepted. Run: node backup/download-encrypted.cjs');
  const admin=await hiddenQuestion('Admin key (hidden): ');
  const backup=await hiddenQuestion('Separate export key (hidden): ');
  const passphrase=await hiddenQuestion('Archive passphrase (20+ characters; hidden): ');
  const confirm=await hiddenQuestion('Repeat archive passphrase (hidden): ');
  if(passphrase!==confirm)throw Error('The archive passphrases do not match');
  if(admin.length<12||backup.length<32||passphrase.length<20)
    throw Error('Credentials or passphrase too short');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),150000);
  let envelope;
  try{
    const r=await fetch(URL,{
      method:'POST',redirect:'error',signal:controller.signal,
      headers:{
        'Content-Type':'application/json',
        'X-Admin-Key':admin,
        'X-Backup-Key':backup,
      },
      body:JSON.stringify({passphrase})
    });
    if(!r.ok)throw Error('Export unavailable or denied (HTTP '+r.status+'). Nothing saved.');
    if(!r.headers.get('content-type')?.includes('application/json'))
      throw Error('Unexpected server content type');
    const text=await r.text();
    if(text.length>65*1024*1024)throw Error('Response too large');
    envelope=JSON.parse(text);
  }finally{clearTimeout(timer)}
  const details=inspect(decryptBackup(envelope,passphrase));
  const name='praktikum-backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
  const target=path.join(process.cwd(),name);
  // Never overwrite a previous backup. Restrict Unix permissions when available.
  const encryptedFile=JSON.stringify(envelope)+'\n';
  fs.writeFileSync(target,encryptedFile,{flag:'wx',mode:0o600});
  const fileHash=crypto.createHash('sha256').update(encryptedFile).digest('hex');
  console.log('Encrypted snapshot saved: '+target);
  console.log('Encrypted file SHA-256: '+fileHash);
  console.log('Published HTML in archive: '+(details.hasPublishedHtml?'YES':'NO'));
  console.log('Publication timestamp in archive: '+(details.hasPublishedMetadata?'YES':'NO'));
  if(!details.hasPublishedHtml||!details.hasPublishedMetadata)
    console.warn('WARNING: publication or its metadata is missing. Preserve this archive but DO NOT call it a complete site backup.');
  console.log('Verified: '+details.keys+' keys, scope '+details.scope+'; atomic snapshot: NO.');
  console.log('Redis/Valkey source is unchanged. Preserve the passphrase separately.');
  console.log('This is NOT proof of a complete real database backup until isolated restoration is tested.');
}
if(require.main===module)main().catch(e=>{console.error('EXPORT FAILED: '+e.message);process.exitCode=1});
module.exports={inspect};
