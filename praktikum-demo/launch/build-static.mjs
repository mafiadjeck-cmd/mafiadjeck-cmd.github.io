#!/usr/bin/env node
// Build a standalone, SEO-ready STATIC preview from a previously saved CMS HTML.
// This tool does NOT contact the live API, publish, configure DNS or send email.
// Required: --source HTML --config JSON --site-url https://owned-domain.tld/ --out EMPTY_FOLDER
import fs from 'node:fs';
import path from 'node:path';
function fail(message){throw new Error(message)}
function argumentsMap(args){
  const out={};
  for(let i=0;i<args.length;i+=2){
    if(!args[i]?.startsWith('--') || !args[i+1])fail('Expected --flag value');
    const k=args[i].slice(2);
    if(!['source','config','site-url','out','mode'].includes(k)||out[k])fail('Unknown/repeated flag: '+k);
    out[k]=args[i+1];
  }
  if(['source','config','site-url','out'].some(k=>!out[k]))fail('Missing required --source, --config, --site-url or --out');
  return out;
}
const esc=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jsafe=(value)=>JSON.stringify(value).replace(/</g,'\\u003c');
function setExactlyOnce(html,needle,value,label){
  const i=html.indexOf(needle);
  if(i<0||html.indexOf(needle,i+needle.length)!==-1)fail('Unexpected HTML structure: '+label);
  return html.slice(0,i)+value+html.slice(i+needle.length);
}
function makeLocalizedHtml(source,config,origin,lang,mode){
  const meta=config.seo[lang];
  let html=source;
  if(!/<!doctype html>/i.test(html)||!/id=["']site-data["']/.test(html))fail('Not a verified Praktikum HTML document');
  // The saved GET /site response may contain live analytics hard-coded to old Render.
  // The new domain has not been allowlisted or consent-reviewed. Do not transmit events.
  const oldAnalytics=/<script\b[^>]*\bid=(["'])praktikum-first-party-analytics\1[^>]*>[\s\S]*?<\/script>/gi;
  const matches=html.match(oldAnalytics)||[];
  if(matches.length>1)fail('Multiple analytics scripts in source');
  if(matches.length===1)html=html.replace(oldAnalytics,'');

  // This release builder works with the current public Praktikum HTML structure.
  html=setExactlyOnce(html,'<html lang="ru" lang-mode="ru">',`<html lang="${lang}" lang-mode="${lang}" data-seo-locale="${lang}">`,'html opening');
  const titleMatch=html.match(/<title>[^<]*<\/title>/i);
  if(!titleMatch)fail('Missing title element');
  html=setExactlyOnce(html,titleMatch[0],'<title>'+esc(meta.title)+'</title>','title');
  const descriptionMatch=html.match(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i);
  if(!descriptionMatch)fail('Missing meta description');
  html=setExactlyOnce(html,descriptionMatch[0],'<meta name="description" content="'+esc(meta.description)+'">','description');
  // Existing language preferences must not override the URL's canonical language.
  const languageInit="try{setLanguage(localStorage.getItem('praktikum-language')||'ru');}catch(e){setLanguage('ru');}";
  const languageInitNext="try{setLanguage(document.documentElement.getAttribute('data-seo-locale')||'ru');}catch(e){setLanguage(document.documentElement.getAttribute('data-seo-locale')||'ru');}";
  html=setExactlyOnce(html,languageInit,languageInitNext,'language initialization');
  const switcher="langBtns.forEach(function(b){b.addEventListener('click',function(){setLanguage(b.dataset.lang);});});";
  const switcherNext="langBtns.forEach(function(b){b.addEventListener('click',function(){var p=b.dataset.lang==='ky'?'/ky/':'/';if(location.protocol==='file:'){p=b.dataset.lang==='ky'?(location.pathname.includes('/ky/')?'./index.html':'./ky/index.html'):(location.pathname.includes('/ky/')?'../index.html':'./index.html')}if(location.pathname!==p){location.assign(p)}else{setLanguage(b.dataset.lang)}});});";
  html=setExactlyOnce(html,switcher,switcherNext,'language switcher');
  const ru=origin+'/', ky=origin+'/ky/';
  const canonical=lang==='ky'?ky:ru;
  const tags=[
    '<link rel="canonical" href="'+esc(canonical)+'">',
    '<link rel="alternate" hreflang="ru" href="'+esc(ru)+'">',
    '<link rel="alternate" hreflang="ky" href="'+esc(ky)+'">',
    '<link rel="alternate" hreflang="x-default" href="'+esc(ru)+'">',
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="'+(lang==='ru'?'ru_RU':'ky_KG')+'">',
    '<meta property="og:title" content="'+esc(meta.title)+'">',
    '<meta property="og:description" content="'+esc(meta.description)+'">',
    '<meta property="og:url" content="'+esc(canonical)+'">',
    '<meta name="twitter:card" content="summary">',
  ];
  // Some source styles shift the closed fixed menu to x=100vw,
  // doubling document.scrollWidth. Keep it at x=0 while invisible;
  // the existing .nav-open rule still makes it visible and interactive.
  tags.push('<style id="praktikum-nav-overflow-fix">@media(max-width:1400px){header:not(.nav-open) .nav-list{transform:none!important}}</style>');
  if(mode==='preview')tags.push('<meta name="robots" content="noindex,nofollow,noarchive">');
  if(config.ogImage && mode==='release'){
    const og=new URL(config.ogImage,ru);
    if(og.protocol!=='https:'||og.origin!==origin)fail('ogImage must use the verified HTTPS site domain');
    tags.push('<meta property="og:image" content="'+esc(og.href)+'">');
  }
  if(config.verifiedOrganization && mode==='release'){
    const org=config.verifiedOrganization;
    if(!org.name||!org.type || !['Organization','EducationalOrganization','LocalBusiness'].includes(org.type))fail('Incorrect verifiedOrganization');
    const structured={'@context':'https://schema.org','@type':org.type,name:org.name,url:canonical};
    if(org.phone)structured.telephone=org.phone;
    if(org.address)structured.address={'@type':'PostalAddress',...org.address};
    tags.push('<script type="application/ld+json">'+jsafe(structured)+'</script>');
  }
  html=setExactlyOnce(html,'</head>',tags.join('\n')+'\n</head>','head');
  const address=String(config.contactEmail||'').trim();
  if(address && mode==='release'){
    if(!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(address))fail('Unverified or invalid contactEmail');
    html=setExactlyOnce(html,'</footer>','<p class="container"><a href="mailto:'+esc(address)+'">'+esc(address)+'</a></p>\n</footer>','footer');
  }
  if(mode==='preview')html=setExactlyOnce(html,'<body>','<body>\n<div role="status" style="position:relative;z-index:100;background:#fff2b3;color:#222;text-align:center;padding:9px;font:14px Arial">ПРЕДПРОСМОТР / АЛДЫН АЛА КӨРҮҮ — НЕ ОПУБЛИКОВАНО</div>','preview banner');
  return html;
}
function xmlEscape(s){return esc(s)}
function generateSitemap(origin){
  const ru=origin+'/',ky=origin+'/ky/';
  const links='<xhtml:link rel="alternate" hreflang="ru" href="'+xmlEscape(ru)+'"/>\n'+
    '<xhtml:link rel="alternate" hreflang="ky" href="'+xmlEscape(ky)+'"/>\n'+
    '<xhtml:link rel="alternate" hreflang="x-default" href="'+xmlEscape(ru)+'"/>';
  return '<?xml version="1.0" encoding="UTF-8"?>\n'+
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'+
    '<url><loc>'+xmlEscape(ru)+'</loc>\n'+links+'\n</url>\n'+
    '<url><loc>'+xmlEscape(ky)+'</loc>\n'+links+'\n</url>\n</urlset>\n';
}
function build(args) {
  const opts=argumentsMap(args);
  const config=JSON.parse(fs.readFileSync(opts.config,'utf8'));
  const mode=opts.mode||'release';
  if(!['release','preview'].includes(mode))fail('Unsupported build mode');
  if(mode==='release' && config.editoriallyApproved!==true)fail('SEO texts and public business details require owner approval: editoriallyApproved=true');
  if(!config.seo?.ru?.title||!config.seo?.ru?.description||!config.seo?.ky?.title||!config.seo?.ky?.description)fail('Missing approved RU/KG SEO content');
  const domain=new URL(opts['site-url']);
  if(domain.protocol!=='https:'||domain.username||domain.password||domain.search||domain.hash||domain.pathname!=='/'||!domain.hostname.includes('.'))fail('Use a final HTTPS domain at its root, for example https://company.kg/');
  const origin=domain.origin;
  if(mode==='preview' && domain.hostname!=='preview.invalid')fail('Preview may only use reserved non-public https://preview.invalid/ origin');
  if(mode==='release' && domain.hostname.endsWith('.invalid'))fail('Reserved preview domain is forbidden for release');
  const root=path.resolve(opts.out);
  if(fs.existsSync(root)&&fs.readdirSync(root).length)fail('Output directory is not empty: '+root);
  const source=fs.readFileSync(opts.source,'utf8');
  // Render both languages BEFORE creating files: failures must not leave partial output.
  const ru=makeLocalizedHtml(source,config,origin,'ru',mode);
  const ky=makeLocalizedHtml(source,config,origin,'ky',mode);
  const sitemap=generateSitemap(origin);
  const robots=mode==='preview'?'User-agent: *\nDisallow: /\n':'User-agent: *\nAllow: /\nSitemap: '+origin+'/sitemap.xml\n';
  fs.mkdirSync(path.join(root,'ky'),{recursive:true});
  fs.writeFileSync(path.join(root,'index.html'),ru);
  fs.writeFileSync(path.join(root,'ky','index.html'),ky);
  fs.writeFileSync(path.join(root,'sitemap.xml'),sitemap);
  fs.writeFileSync(path.join(root,'robots.txt'),robots);
  console.log('Staged '+mode+' files generated locally only. No network requests, no deployment and no email sent.');
}
try{build(process.argv.slice(2))}catch(e){console.error('SEO STAGING ERROR:',e.message);process.exitCode=1}
