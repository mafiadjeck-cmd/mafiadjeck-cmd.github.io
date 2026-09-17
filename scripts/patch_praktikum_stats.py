from pathlib import Path

p = Path('praktikum-demo/admin/index.html')
s = p.read_text(encoding='utf-8')

s = s.replace(
    '.danger{color:#9b3134}.loading{padding:50px;text-align:center;color:#6f7c8d}',
    '.danger{color:#9b3134}.loading{padding:50px;text-align:center;color:#6f7c8d}.statCards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0}.statCard{border:1px solid #dce2e8;border-radius:11px;padding:18px;background:#fff}.statCard b{display:block;font-size:28px;color:#a43d3f}.statCard span{font-size:12px;color:#718096}.statsGrid{display:grid;grid-template-columns:1.3fr .7fr;gap:18px}.statsTable{width:100%;border-collapse:collapse}.statsTable th,.statsTable td{padding:9px 7px;border-bottom:1px solid #edf0f3;text-align:right;font-size:13px}.statsTable th:first-child,.statsTable td:first-child{text-align:left}.rank{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #edf0f3}.rank b{font-size:13px}.rank span{color:#718096;font-size:13px}'
)
s = s.replace(
    '@media(max-width:850px){.app{grid-template-columns:1fr}',
    '@media(max-width:850px){.statCards,.statsGrid{grid-template-columns:1fr}.app{grid-template-columns:1fr}'
)

old = '<button class="active" data-tab="course">Курс и контакты</button><button data-tab="texts">Тексты страницы</button><button data-tab="photos">Фотографии</button><button data-tab="library">Библиотека</button><button data-tab="trainer">Тренажёр</button><button data-tab="history">История и копии</button>'
new = '<button class="active" data-tab="course">Курс и контакты</button><button data-tab="texts">Тексты страницы</button><button data-tab="photos">Фотографии</button><button data-tab="library">Библиотека</button><button data-tab="trainer">Тренажёр</button><button data-tab="stats">Статистика</button><button data-tab="history">История и копии</button>'
if old not in s:
    raise SystemExit('nav anchor not found')
s = s.replace(old, new)

marker = '<section class="panel" id="history"><div class="box"><h2>История и копии</h2>'
stats = '''<section class="panel" id="stats"><div class="box"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><div><h2>Статистика сайта</h2><p class="hint" style="margin-bottom:0">Собственная аналитика Практикума. Данные собираются анонимно.</p></div><div style="display:flex;gap:8px"><select id="statsDays" class="btn"><option value="7">7 дней</option><option value="30" selected>30 дней</option><option value="90">90 дней</option></select><button class="btn" id="refreshStats">Обновить</button></div></div><div id="statsStatus" class="mini" style="margin-top:12px">Откройте раздел для загрузки данных.</div><div class="statCards"><div class="statCard"><b id="stViews">—</b><span>Просмотры сайта</span></div><div class="statCard"><b id="stUnique">—</b><span>Уникальные посетители</span></div><div class="statCard"><b id="stWhatsApp">—</b><span>Клики WhatsApp</span></div><div class="statCard"><b id="stPhone">—</b><span>Клики по телефону</span></div><div class="statCard"><b id="stInstagram">—</b><span>Переходы Instagram</span></div><div class="statCard"><b id="stCta">—</b><span>Основные CTA</span></div></div><div class="statsGrid"><div class="jsonCard"><h3>Динамика по дням</h3><div style="overflow:auto"><table class="statsTable"><thead><tr><th>Дата</th><th>Посетители</th><th>Просмотры</th><th>WhatsApp</th><th>Телефон</th></tr></thead><tbody id="statsDaily"></tbody></table></div></div><div><div class="jsonCard"><h3>Источники</h3><div id="statsSources"></div></div><div class="jsonCard"><h3>Устройства</h3><div id="statsDevices"></div></div><div class="jsonCard"><h3>Язык</h3><div id="statsLangs"></div></div></div></div></div></section>\n'''
if marker not in s:
    raise SystemExit('history anchor not found')
s = s.replace(marker, stats + marker)

old = "const titles={course:'Курс и контакты',texts:'Тексты страницы',photos:'Фотографии',library:'Библиотека',trainer:'Тренажёр',history:'История и копии'};"
new = "const titles={course:'Курс и контакты',texts:'Тексты страницы',photos:'Фотографии',library:'Библиотека',trainer:'Тренажёр',stats:'Статистика',history:'История и копии'};"
if old not in s:
    raise SystemExit('titles anchor not found')
s = s.replace(old, new)

anchor = "function replaceAllSafe(s,a,b){return a?s.split(a).join(b):s}\n"
addon = r'''function adminKey(){let key=sessionStorage.getItem('praktikum-publish-key');if(!key){key=prompt('Введите пароль админки');if(key)sessionStorage.setItem('praktikum-publish-key',key)}return key||''}
function num(v){return Number(v||0).toLocaleString('ru-RU')}
function ranks(id,arr){$(id).innerHTML=(arr&&arr.length)?arr.map(x=>`<div class="rank"><b>${esc(x.name)}</b><span>${num(x.value)}</span></div>`).join(''):'<div class="mini">Пока нет данных</div>'}
async function loadStats(){const key=adminKey();if(!key)return;$('statsStatus').textContent='Загружаю статистику…';try{const r=await fetch(API+'/stats?days='+$('statsDays').value,{headers:{'X-Admin-Key':key},cache:'no-store'});if(r.status===401||r.status===429){sessionStorage.removeItem('praktikum-publish-key');throw new Error(r.status===429?'Слишком много неверных попыток. Попробуйте позже.':'Неверный пароль админки')}if(!r.ok)throw new Error('Не удалось загрузить статистику');const j=await r.json(),t=j.totals||{};$('stViews').textContent=num(t.page_view);$('stUnique').textContent=num(j.uniqueVisitors);$('stWhatsApp').textContent=num(t.whatsapp_click);$('stPhone').textContent=num(t.phone_click);$('stInstagram').textContent=num(t.instagram_click);$('stCta').textContent=num(t.cta_click);$('statsDaily').innerHTML=(j.daily||[]).slice().reverse().map(d=>`<tr><td>${esc(d.date)}</td><td>${num(d.uniqueVisitors)}</td><td>${num(d.page_view)}</td><td>${num(d.whatsapp_click)}</td><td>${num(d.phone_click)}</td></tr>`).join('');ranks('statsSources',j.sources);ranks('statsDevices',j.devices);ranks('statsLangs',j.langs);$('statsStatus').textContent='Данные обновлены: '+new Date().toLocaleString('ru-RU')}catch(e){$('statsStatus').textContent=e.message||'Ошибка статистики';toast(e.message||'Ошибка статистики')}}
'''
if anchor not in s:
    raise SystemExit('function anchor not found')
s = s.replace(anchor, anchor + addon)

old = "async function publish(){syncCourse();let key=sessionStorage.getItem('praktikum-publish-key');if(!key){key=prompt('Введите пароль админки');if(!key)return}"
new = "async function publish(){syncCourse();let key=adminKey();if(!key)return;"
if old not in s:
    raise SystemExit('publish anchor not found')
s = s.replace(old, new)

old = "document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active');$('pageTitle').textContent=titles[b.dataset.tab]});"
new = "document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active');$('pageTitle').textContent=titles[b.dataset.tab];if(b.dataset.tab==='stats')loadStats()});"
if old not in s:
    raise SystemExit('nav click anchor not found')
s = s.replace(old, new)

old = "$('previewBtn').onclick=preview;$('publishBtn').onclick=publish;$('textSearch').oninput=renderTexts;"
new = "$('previewBtn').onclick=preview;$('publishBtn').onclick=publish;$('refreshStats').onclick=loadStats;$('statsDays').onchange=loadStats;$('textSearch').oninput=renderTexts;"
if old not in s:
    raise SystemExit('events anchor not found')
s = s.replace(old, new)

p.write_text(s, encoding='utf-8')
