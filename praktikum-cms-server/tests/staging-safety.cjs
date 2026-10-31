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
assert.match(home, /fetch\('https:\/\/praktikum-cms-api\.onrender\.com\/site/);
assert.match(base, /id="site-data"/);
console.log('Praktikum staging safety checks: PASS (code only, not live API).');
