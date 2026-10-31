'use strict';
const assert=require('node:assert/strict');
const {snapshotReadonly}=require('../backup/backup-export.cjs');

async function main(){
  let dumped=false;
  const hugeClient={
    async get(){return 'unchanged'},
    async scan(){return {cursor:0,keys:['praktikum:oversized']}},
    async memoryUsage(){return 27*1024*1024},
    async dump(){dumped=true;throw Error('DUMP must not run on huge key')}
  };
  await assert.rejects(snapshotReadonly(hugeClient),/memory usage exceeds safe export limit/);
  assert.equal(dumped,false,'Oversized key refused before DUMP buffer allocation');
  console.log('PASS: oversized key rejected before DUMP');

  let revisionReads=0;
  const concurrentClient={
    async get(){return ++revisionReads===1?'before-update':'after-update'},
    async scan(){return {cursor:0,keys:[]}}
  };
  await assert.rejects(snapshotReadonly(concurrentClient),/Publication changed during backup/);
  console.log('PASS: concurrent publication causes backup rejection');

  let skipped=false;
  const expiredClient={
    async get(){return 'steady'},
    async scan(){return {cursor:0,keys:['praktikum:expired']}},
    async memoryUsage(){skipped=true;return null},
    async dump(){throw Error('DUMP must not run on expired key')}
  };
  const expired=await snapshotReadonly(expiredClient);
  assert.equal(skipped,true);
  assert.equal(expired.keys,0);
  assert.equal(expired.atomic,false);
  assert.equal(expired.publicationVersionUnchanged,true);
  console.log('PASS: keys expiring during SCAN do not trigger DUMP');

  const invalidClient={
    async get(){return 'steady'},
    async scan(){return {cursor:0,keys:['other-app:secret']}}
  };
  await assert.rejects(snapshotReadonly(invalidClient),/Key outside approved namespace/);
  console.log('PASS: outside namespace fails closed');

  const tinyClient={
    async get(){return 'steady'},
    async scan(){return {cursor:0,keys:['praktikum:published:html']}},
    async memoryUsage(){return 256},
    async pTTL(){return -1},
    commandOptions(){return {returnBuffers:true}},
    async dump(){return Buffer.from([0,1,2,3])},
    async type(){return 'string'}
  };
  const success=await snapshotReadonly(tinyClient);
  assert.equal(success.keys,1);
  assert.equal(success.hasPublishedHtml,true);
  assert.equal(success.hasPublishedMetadata,false);
  assert.equal(success.publicationVersionUnchanged,true);
  console.log('PASS: small binary key exported with explicit completeness indicators');
}
main().catch(e=>{console.error(e);process.exitCode=1});
