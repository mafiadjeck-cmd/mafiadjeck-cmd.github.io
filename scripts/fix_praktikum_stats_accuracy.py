from pathlib import Path

p = Path('praktikum-cms-server/server.js')
s = p.read_text(encoding='utf-8')

old = "function dayKey(date = new Date()){\n  return date.toISOString().slice(0,10);\n}"
new = "function dayKey(date = new Date()){\n  return new Date(date.getTime() + 6*60*60*1000).toISOString().slice(0,10);\n}"
if old not in s:
    raise SystemExit('dayKey anchor not found')
s = s.replace(old, new)

old = """    const multi = redis.multi()\n      .hIncrBy('praktikum:analytics:totals', event, 1)\n      .hIncrBy(`praktikum:analytics:day:${day}`, event, 1)\n      .hIncrBy('praktikum:analytics:sources', source, 1)\n      .hIncrBy('praktikum:analytics:devices', device, 1)\n      .hIncrBy('praktikum:analytics:langs', lang, 1)\n      .pfAdd('praktikum:analytics:visitors', visitor)\n      .pfAdd(`praktikum:analytics:visitors:${day}`, visitor)\n      .expire(`praktikum:analytics:day:${day}`, 400*24*3600)\n      .expire(`praktikum:analytics:visitors:${day}`, 400*24*3600);\n    if (campaign && campaign !== 'direct') multi.hIncrBy('praktikum:analytics:campaigns', campaign, 1);"""
new = """    const multi = redis.multi()\n      .hIncrBy('praktikum:analytics:totals', event, 1)\n      .hIncrBy(`praktikum:analytics:day:${day}`, event, 1)\n      .pfAdd('praktikum:analytics:visitors', visitor)\n      .pfAdd(`praktikum:analytics:visitors:${day}`, visitor)\n      .expire(`praktikum:analytics:day:${day}`, 400*24*3600)\n      .expire(`praktikum:analytics:visitors:${day}`, 400*24*3600);\n    if (event === 'page_view') {\n      multi\n        .hIncrBy(`praktikum:analytics:sources:${day}`, source, 1)\n        .hIncrBy(`praktikum:analytics:devices:${day}`, device, 1)\n        .hIncrBy(`praktikum:analytics:langs:${day}`, lang, 1)\n        .expire(`praktikum:analytics:sources:${day}`, 400*24*3600)\n        .expire(`praktikum:analytics:devices:${day}`, 400*24*3600)\n        .expire(`praktikum:analytics:langs:${day}`, 400*24*3600);\n      if (campaign && campaign !== 'direct') {\n        multi\n          .hIncrBy(`praktikum:analytics:campaigns:${day}`, campaign, 1)\n          .expire(`praktikum:analytics:campaigns:${day}`, 400*24*3600);\n      }\n    }"""
if old not in s:
    raise SystemExit('event storage anchor not found')
s = s.replace(old, new)

old = """    const totals = await redis.hGetAll('praktikum:analytics:totals');\n    const uniqueVisitors = await redis.pfCount('praktikum:analytics:visitors');\n    const sourcesRaw = await redis.hGetAll('praktikum:analytics:sources');\n    const campaignsRaw = await redis.hGetAll('praktikum:analytics:campaigns');\n    const devicesRaw = await redis.hGetAll('praktikum:analytics:devices');\n    const langsRaw = await redis.hGetAll('praktikum:analytics:langs');\n    const daily=[];\n    for(const date of dates){\n      const [row,unique] = await Promise.all([\n        redis.hGetAll(`praktikum:analytics:day:${date}`),\n        redis.pfCount(`praktikum:analytics:visitors:${date}`)\n      ]);\n      daily.push({date,uniqueVisitors:Number(unique||0),...Object.fromEntries(Object.entries(row).map(([k,v])=>[k,Number(v)]))});\n    }\n    const top = o => Object.entries(o||{}).map(([name,value])=>({name,value:Number(value)})).sort((a,b)=>b.value-a.value).slice(0,12);"""
new = """    const daily=[];\n    const totals={};\n    const sourcesRaw={};\n    const campaignsRaw={};\n    const devicesRaw={};\n    const langsRaw={};\n    const addMap = (target, obj) => { for (const [k,v] of Object.entries(obj||{})) target[k]=(target[k]||0)+Number(v||0); };\n    for(const date of dates){\n      const [row,unique,sources,campaigns,devices,langs] = await Promise.all([\n        redis.hGetAll(`praktikum:analytics:day:${date}`),\n        redis.pfCount(`praktikum:analytics:visitors:${date}`),\n        redis.hGetAll(`praktikum:analytics:sources:${date}`),\n        redis.hGetAll(`praktikum:analytics:campaigns:${date}`),\n        redis.hGetAll(`praktikum:analytics:devices:${date}`),\n        redis.hGetAll(`praktikum:analytics:langs:${date}`)\n      ]);\n      addMap(totals,row); addMap(sourcesRaw,sources); addMap(campaignsRaw,campaigns); addMap(devicesRaw,devices); addMap(langsRaw,langs);\n      daily.push({date,uniqueVisitors:Number(unique||0),...Object.fromEntries(Object.entries(row).map(([k,v])=>[k,Number(v)]))});\n    }\n    const visitorKeys = dates.map(date=>`praktikum:analytics:visitors:${date}`);\n    const tempVisitors = `praktikum:analytics:range:${Date.now()}:${Math.random().toString(36).slice(2)}`;\n    let uniqueVisitors = 0;\n    if (visitorKeys.length) {\n      await redis.sendCommand(['PFMERGE', tempVisitors, ...visitorKeys]);\n      uniqueVisitors = Number(await redis.sendCommand(['PFCOUNT', tempVisitors])) || 0;\n      await redis.del(tempVisitors);\n    }\n    const top = o => Object.entries(o||{}).map(([name,value])=>({name,value:Number(value)})).sort((a,b)=>b.value-a.value).slice(0,12);"""
if old not in s:
    raise SystemExit('stats aggregation anchor not found')
s = s.replace(old, new)

old = """      totals:Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,Number(v)])),\n      uniqueVisitors:Number(uniqueVisitors||0),"""
new = """      totals,\n      uniqueVisitors:Number(uniqueVisitors||0),"""
if old not in s:
    raise SystemExit('stats response anchor not found')
s = s.replace(old, new)

p.write_text(s, encoding='utf-8')
