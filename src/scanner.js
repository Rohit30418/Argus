import { chromium } from 'playwright-core';
import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { enrichIssue, issueFingerprint } from './solutions.js';

const DATA_DIR = path.resolve('data');
const SCAN_DIR = path.join(DATA_DIR, 'scans');
const SCREEN_DIR = path.join(DATA_DIR, 'screenshots');

const MODES = {
  quick: { discovered: 100, light: 35, deep: 8, depth: 2, interactions: 3, mobile: 5 },
  standard: { discovered: 500, light: 140, deep: 30, depth: 4, interactions: 6, mobile: 12 },
  deep: { discovered: 1600, light: 450, deep: 90, depth: 7, interactions: 10, mobile: 35 },
  full: { discovered: 5000, light: 1200, deep: 220, depth: 10, interactions: 14, mobile: 80 }
};

const severityWeight = { critical: 16, high: 8, medium: 3, low: 1 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const cleanText = s => String(s || '').replace(/\s+/g, ' ').trim();
const uniq = arr => [...new Set(arr.filter(Boolean))];
const sha = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback;
}

function isPrivateIp(ip) {
  if (!net.isIP(ip)) return false;
  if (ip === '::1' || ip === '0.0.0.0') return true;
  if (ip.startsWith('10.') || ip.startsWith('127.') || ip.startsWith('169.254.') || ip.startsWith('192.168.')) return true;
  if (ip.startsWith('172.')) { const n = Number(ip.split('.')[1]); if (n >= 16 && n <= 31) return true; }
  if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(ip.replace(/:/g, ''))) return true;
  return false;
}

function obviousPrivateHost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || isPrivateIp(h);
}

export async function assertPublicUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a valid absolute URL, including https:// or http://'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP/HTTPS targets are supported.');
  if (obviousPrivateHost(url.hostname)) throw new Error('Local/private targets are blocked by default.');
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(x => isPrivateIp(x.address))) throw new Error('Target resolves to a private/local address and is blocked.');
  return url;
}

function normalizeUrl(raw, root) {
  try {
    const u = new URL(raw, root);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    u.hash = '';
    const noisy = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','mc_cid','mc_eid'];
    noisy.forEach(k => u.searchParams.delete(k));
    [...u.searchParams.keys()].forEach(k => { if (/^(utm_|_ga|yclid)/i.test(k)) u.searchParams.delete(k); });
    u.searchParams.sort();
    if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  } catch { return null; }
}

function sameOrigin(url, root) {
  try { return new URL(url).origin === new URL(root).origin; } catch { return false; }
}

function routePattern(raw) {
  try {
    const u = new URL(raw);
    const parts = u.pathname.split('/').filter(Boolean).map(p => {
      if (/^\d+$/.test(p)) return ':id';
      if (/^[0-9a-f]{8,}$/i.test(p) || /^[0-9a-f-]{20,}$/i.test(p)) return ':id';
      if (p.length > 28 && /[-_]/.test(p)) return ':slug';
      return p.toLowerCase();
    });
    return '/' + parts.join('/');
  } catch { return '/'; }
}

function stripTags(s = '') { return cleanText(s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')); }
function matchOne(html, re) { return cleanText((html.match(re)?.[1] || '').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'")); }
function matchAll(html, re, group = 1, limit = 500) { const out=[]; let m; while ((m = re.exec(html)) && out.length < limit) out.push(m[group]); return out; }

function issue(input) { return enrichIssue(input); }

function parseHtmlSummary(html, pageUrl, headers, status) {
  const title = matchOne(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1 = matchAll(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, 1, 10).map(stripTags);
  const description = matchOne(html, /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) || matchOne(html, /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  const canonical = matchOne(html, /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  const hrefs = matchAll(html, /<a\b[^>]*href=["']([^"']+)["']/gi, 1, 1600).map(x => normalizeUrl(x, pageUrl)).filter(Boolean);
  const images = [...html.matchAll(/<img\b([^>]*)>/gi)].slice(0, 900).map(m => {
    const attrs = m[1] || ''; const src = matchOne(attrs, /src=["']([^"']*)["']/i); const altMatch = attrs.match(/\balt=["']([^"']*)["']/i);
    return { src: normalizeUrl(src, pageUrl) || src, hasAlt: Boolean(altMatch), alt: altMatch ? altMatch[1] : null };
  });
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].slice(0, 50).map((m, index) => {
    const attrs=m[1]||'', body=m[2]||'';
    const method=(matchOne(attrs,/method=["']([^"']+)["']/i)||'GET').toUpperCase();
    const action=normalizeUrl(matchOne(attrs,/action=["']([^"']*)["']/i)||pageUrl,pageUrl)||pageUrl;
    const fields=(body.match(/<(input|select|textarea)\b/gi)||[]).length;
    const passwordFields=(body.match(/<input\b[^>]*type=["']password["']/gi)||[]).length;
    const fileFields=(body.match(/<input\b[^>]*type=["']file["']/gi)||[]).length;
    return { id:`form-${index+1}`, method, action, fields, passwordFields, fileFields };
  });
  const scripts = matchAll(html, /<script\b[^>]*src=["']([^"']+)["']/gi,1,600).map(x=>normalizeUrl(x,pageUrl)||x);
  const styles = matchAll(html, /<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi,1,700).map(x=>normalizeUrl(x,pageUrl)||x).filter(x=>/\.css(?:\?|$)/i.test(x));
  const allResources = uniq([...scripts, ...styles, ...images.map(x=>x.src)]);
  const issues=[];
  const add=(severity,category,titleText,evidence,recommendation,confidence='High',extra={})=>issues.push(issue({severity,category,title:titleText,evidence,recommendation,confidence,url:pageUrl,...extra}));
  if (status >= 500) add('critical','Functional',`Server error ${status}`,`HTTP ${status} returned by ${pageUrl}`,'Inspect server/application logs and fix the failing route.');
  else if (status === 404) add('high','Functional','Page returns 404',`HTTP 404 returned by ${pageUrl}`,'Restore the intended page or update links to the correct route.');
  else if (status >= 400) add('high','Functional',`HTTP error ${status}`,`HTTP ${status} returned by ${pageUrl}`,'Review the route, authentication and server response.');
  if (!title) add('medium','SEO','Missing page title','No non-empty <title> was found in the fetched HTML.','Add a unique descriptive title.');
  if (!description) add('low','SEO','Missing meta description','No non-empty meta description was found in the fetched HTML.','Add a concise page-specific description.');
  if (h1.length === 0) add('medium','Accessibility','Missing H1','No H1 heading was found in the fetched HTML.','Add one meaningful primary H1.');
  if (h1.length > 1) add('low','Accessibility','Multiple H1 headings',`${h1.length} H1 elements were found.`,'Review heading hierarchy and use one clear primary page heading where appropriate.','Medium');
  const missingAlt = images.filter(x=>!x.hasAlt).length;
  if (missingAlt) add(missingAlt > 5 ? 'high':'medium','Accessibility','Images missing alt text',`${missingAlt} image(s) do not expose an alt attribute.`,'Add meaningful alt text or alt="" for decorative images.', 'High', {evidenceDetails:{count:missingAlt}});
  const csp=headers['content-security-policy'];
  if (!csp) add('medium','Security','CSP header missing','No Content-Security-Policy response header was observed.','Use SENTINEL to inventory origins and deploy CSP in Report-Only before enforcement.','High',{evidenceKind:'header'});
  return { title, h1, description, canonical, hrefs, images, forms, scripts, styles, resources: allResources, issues };
}

async function fetchWithTimeout(url, timeout=12000) {
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const res=await fetch(url,{redirect:'follow',headers:{'user-agent':'ARGUS-QA/3.0 (+authorized website audit)'},signal:controller.signal});
    const final=await assertPublicUrl(res.url);
    const type=res.headers.get('content-type')||'';
    const text=/text\/html|application\/xhtml\+xml/i.test(type)?await res.text():'';
    const headers=Object.fromEntries([...res.headers.entries()].map(([k,v])=>[k.toLowerCase(),v]));
    return {url:final.toString(),status:res.status,headers,text,type};
  } finally {clearTimeout(timer);}
}

async function sitemapUrls(root, max) {
  const seed=new URL('/sitemap.xml',root).toString(); const urls=[]; const seen=new Set(); const queue=[seed];
  while(queue.length && urls.length<max && seen.size<16){
    const s=queue.shift(); if(seen.has(s))continue; seen.add(s);
    try{
      const r=await fetchWithTimeout(s,9000); if(!r.text)continue;
      const locs=matchAll(r.text,/<loc>([\s\S]*?)<\/loc>/gi,1,max*2).map(x=>cleanText(x.replace(/&amp;/g,'&')));
      for(const loc of locs){
        if(/\.xml(?:\?|$)/i.test(loc)&&queue.length<16)queue.push(loc);
        else if(sameOrigin(loc,root)){const n=normalizeUrl(loc,root);if(n&&!urls.includes(n))urls.push(n);}
        if(urls.length>=max)break;
      }
    }catch{/* sitemap optional */}
  }
  return urls;
}

async function discover(root, cfg, onProgress) {
  const found=new Map(); const queue=[];
  const add=(url,reason,depth=0)=>{const n=normalizeUrl(url,root);if(!n||!sameOrigin(n,root)||found.has(n)||found.size>=cfg.discovered)return;found.set(n,{url:n,reason,depth});queue.push({url:n,depth});};
  add(root,'seed',0);
  const maps=await sitemapUrls(root,cfg.discovered); maps.forEach(u=>add(u,'sitemap',1));
  onProgress?.({stage:'discover',message:`Planning site map · ${found.size} URL(s)`,done:found.size,total:cfg.discovered});
  let cursor=0;
  while(cursor<queue.length && found.size<cfg.discovered){
    const item=queue[cursor++]; if(item.depth>=cfg.depth)continue;
    try{
      const r=await fetchWithTimeout(item.url,10000); if(!r.text)continue;
      const hrefs=matchAll(r.text,/<a\b[^>]*href=["']([^"']+)["']/gi,1,2200);
      for(const h of hrefs)add(h,'link',item.depth+1);
    }catch{/* captured during scan */}
    if(cursor%12===0)onProgress?.({stage:'discover',message:`Discovered ${found.size} unique URL(s)`,done:found.size,total:cfg.discovered});
  }
  return [...found.values()];
}

async function lightScan(item) {
  try{
    const r=await fetchWithTimeout(item.url,15000); const parsed=parseHtmlSummary(r.text,r.url,r.headers,r.status);
    return {url:r.url,discoveredBy:item.reason,depth:item.depth,status:r.status,headers:r.headers,title:parsed.title,h1:parsed.h1,seo:{description:parsed.description,canonical:parsed.canonical},forms:parsed.forms,resources:parsed.resources,issues:parsed.issues,links:parsed.hrefs,images:parsed.images,consoleErrors:[],failedRequests:[],httpErrors:[],performance:null,a11y:null,mobileAudit:null,interactionChecks:[],evidenceArtifacts:[],templateId:routePattern(r.url)};
  }catch(error){
    return {url:item.url,discoveredBy:item.reason,depth:item.depth,status:0,headers:{},title:'',h1:[],seo:{},forms:[],resources:[],links:[],images:[],consoleErrors:[],failedRequests:[],httpErrors:[],performance:null,a11y:null,mobileAudit:null,interactionChecks:[],evidenceArtifacts:[],templateId:routePattern(item.url),issues:[issue({severity:'high',category:'Functional',title:'Page could not be fetched',evidence:error.message,recommendation:'Verify DNS/TLS/server availability and retry.',confidence:'High',url:item.url,evidenceKind:'network'})]};
  }
}

function chooseDeepPages(pages,cfg){
  const candidates=pages.map(p=>{
    const issueScore=(p.issues||[]).reduce((n,i)=>n+(severityWeight[i.severity]||1),0);
    const formScore=(p.forms||[]).length*6;
    const important=/login|sign|register|contact|checkout|cart|search|member|dashboard|event|apply|booking|payment|profile/i.test(new URL(p.url).pathname)?10:0;
    const runtimeRisk=p.status>=400?12:0;
    return {p,score:issueScore+formScore+important+runtimeRisk};
  }).sort((a,b)=>b.score-a.score);
  const out=[]; const templates=new Set();
  for(const c of candidates){if(out.length>=cfg.deep)break;if(c.score>0||!templates.has(c.p.templateId)){out.push(c.p);templates.add(c.p.templateId);}}
  for(const c of candidates){if(out.length>=cfg.deep)break;if(!out.includes(c.p))out.push(c.p);}
  return out;
}

async function findBrowserExecutable(){
  if(process.env.ARGUS_BROWSER_EXECUTABLE)return process.env.ARGUS_BROWSER_EXECUTABLE;
  const candidates=process.platform==='win32'?[process.env.PROGRAMFILES+'\\Google\\Chrome\\Application\\chrome.exe',process.env['PROGRAMFILES(X86)']+'\\Google\\Chrome\\Application\\chrome.exe',process.env.LOCALAPPDATA+'\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean):['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'];
  for(const c of candidates){try{await fs.access(c);return c;}catch{}}
  return null;
}

async function captureElement(page, reportId, issueObj, selector, label, viewport) {
  if (!selector) return null;
  try {
    const locator = page.locator(selector).first();
    if (!await locator.count()) return null;
    await locator.scrollIntoViewIfNeeded({timeout:1800}).catch(()=>{});
    await sleep(80);
    const visible = await locator.isVisible({timeout:1200}).catch(()=>false);
    if (!visible) return null;
    const original = await locator.evaluate(el => ({outline:el.style.outline, outlineOffset:el.style.outlineOffset, boxShadow:el.style.boxShadow})).catch(()=>null);
    await locator.evaluate(el => { el.style.outline='3px solid #ff3b30'; el.style.outlineOffset='3px'; el.style.boxShadow='0 0 0 5px rgba(255,59,48,.18)'; }).catch(()=>{});
    const filename=`${reportId}-${issueObj.id}-${sha(label||selector)}.png`;
    const disk=path.join(SCREEN_DIR,filename);
    await locator.screenshot({path:disk,animations:'disabled',timeout:3500});
    if(original) await locator.evaluate((el,old)=>{el.style.outline=old.outline;el.style.outlineOffset=old.outlineOffset;el.style.boxShadow=old.boxShadow;},original).catch(()=>{});
    return {kind:'element-screenshot',label:label||'Issue evidence',url:`/artifacts/screenshots/${filename}`,selector,viewport};
  } catch { return null; }
}

function mergeIssue(existing, patch) {
  if (!existing) return issue(patch);
  return enrichIssue({...existing,...patch,evidenceDetails:{...(existing.evidenceDetails||{}),...(patch.evidenceDetails||{})},artifacts:[...(existing.artifacts||[]),...(patch.artifacts||[])]});
}

const riskyClick=/delete|remove|purchase|buy|pay|checkout|submit|send|save|logout|sign out|unsubscribe|confirm|book|apply|upload|download|accept|decline|reject|approve/i;

async function deepScan(browser, pageSummary, cfg, index, reportId, onProgress){
  const context=await browser.newContext({viewport:{width:1366,height:820},ignoreHTTPSErrors:false});
  const page=await context.newPage();
  const consoleErrors=[],failedRequests=[],httpErrors=[],network=[]; let networkHits=0;
  page.on('console',m=>{if(m.type()==='error'&&consoleErrors.length<40)consoleErrors.push(cleanText(m.text()).slice(0,900));});
  page.on('requestfailed',r=>{if(failedRequests.length<40)failedRequests.push({url:r.url(),method:r.method(),resourceType:r.resourceType(),error:r.failure()?.errorText||'failed'});});
  page.on('response',async r=>{
    networkHits++; const s=r.status();
    const entry={url:r.url(),status:s,type:r.request().resourceType(),method:r.request().method(),initiator:r.request().frame()?.url()||''};
    if(s>=400&&httpErrors.length<60)httpErrors.push(entry);
    if(network.length<1200)network.push(entry);
  });
  await page.route('**/*',async route=>{try{const u=new URL(route.request().url());if(obviousPrivateHost(u.hostname)&&u.origin!==new URL(pageSummary.url).origin)return route.abort();}catch{}return route.continue();});
  try{
    const response=await page.goto(pageSummary.url,{waitUntil:'domcontentloaded',timeout:35000}); await sleep(650);
    const finalUrl=page.url(); await assertPublicUrl(finalUrl);
    const dom=await page.evaluate(()=>{
      const visible=el=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity)!==0;};
      const cssPath=el=>{
        if(!el||el.nodeType!==1)return '';
        if(el.id)return `#${CSS.escape(el.id)}`;
        const parts=[]; let cur=el;
        while(cur&&cur.nodeType===1&&cur!==document.documentElement&&parts.length<6){
          let part=cur.tagName.toLowerCase();
          const classes=[...cur.classList].filter(Boolean).slice(0,2); if(classes.length)part+='.'+classes.map(CSS.escape).join('.');
          const parent=cur.parentElement;
          if(parent){const same=[...parent.children].filter(x=>x.tagName===cur.tagName);if(same.length>1)part+=`:nth-of-type(${same.indexOf(cur)+1})`;}
          parts.unshift(part); cur=parent;
          if(cur?.id){parts.unshift(`#${CSS.escape(cur.id)}`);break;}
        }
        return parts.join(' > ');
      };
      const describe=el=>{const r=el.getBoundingClientRect();return{selector:cssPath(el),html:el.outerHTML.slice(0,500),text:(el.innerText||el.getAttribute('aria-label')||el.getAttribute('title')||'').trim().slice(0,160),rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};};
      const imgs=[...document.images];
      const controls=[...document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="link"]')].filter(visible);
      const missingAltItems=imgs.filter(x=>visible(x)&&!x.hasAttribute('alt')).slice(0,12).map(describe);
      const unlabeledItems=controls.filter(el=>{if(el.matches('input[type="hidden"]'))return false;const aria=el.getAttribute('aria-label')||el.getAttribute('aria-labelledby');const txt=(el.innerText||el.value||'').trim();const id=el.id;const label=id?document.querySelector(`label[for="${CSS.escape(id)}"]`):null;return !aria&&!txt&&!label&&!el.getAttribute('title');}).slice(0,12).map(describe);
      const ids=[...document.querySelectorAll('[id]')].map(x=>x.id).filter(Boolean); const dupIds=ids.filter((x,i,a)=>a.indexOf(x)!==i).filter((x,i,a)=>a.indexOf(x)===i).slice(0,20);
      const duplicateItems=dupIds.map(id=>{const el=document.getElementById(id);return el?{id,...describe(el)}:{id,selector:`#${CSS.escape(id)}`};}).slice(0,8);
      const buttons=[...document.querySelectorAll('button,[role="button"],a[href="#"],a[href^="javascript:"]')].filter(visible).slice(0,100).map(el=>({...describe(el),tag:el.tagName.toLowerCase(),type:el.getAttribute('type')||'',cls:(el.className||'').toString().slice(0,180)}));
      const timing=performance.getEntriesByType('navigation')[0]; const resources=performance.getEntriesByType('resource');
      return {
        title:document.title,h1:[...document.querySelectorAll('h1')].map(x=>x.innerText.trim()).filter(Boolean).slice(0,10),
        missingAlt:missingAltItems.length,missingAltItems,unlabeledItems,dupIds,duplicateItems,buttons,
        timing:timing?{domContentLoaded:Math.round(timing.domContentLoadedEventEnd),load:Math.round(timing.loadEventEnd),ttfb:Math.round(timing.responseStart),transferSize:timing.transferSize||0}:null,
        resourceBytes:Math.round(resources.reduce((n,x)=>n+(x.transferSize||0),0)),resourceCount:resources.length,
        fonts:[...document.fonts].map(f=>f.family).filter((x,i,a)=>a.indexOf(x)===i).slice(0,20),
        colors:[...document.querySelectorAll('body,header,nav,main,section,article,button,a')].slice(0,180).map(el=>getComputedStyle(el).color).filter((x,i,a)=>a.indexOf(x)===i).slice(0,20)
      };
    });

    let issues=[...(pageSummary.issues||[])];
    const add=(severity,category,titleText,evidence,recommendation,confidence='High',extra={})=>{const x=issue({severity,category,title:titleText,evidence,recommendation,confidence,url:pageSummary.url,...extra});issues.push(x);return x;};
    const patchFirst=(titleMatcher,patch)=>{const idx=issues.findIndex(i=>titleMatcher.test(i.title)); if(idx>=0){issues[idx]=mergeIssue(issues[idx],patch);return issues[idx];} return null;};

    if(consoleErrors.length)add(consoleErrors.length>2?'high':'medium','Functional','Console errors observed',`${consoleErrors.length} console error(s). First: ${consoleErrors[0]}`,'Trace the first application error and reproduce the affected interaction.','High',{evidenceKind:'console',evidenceDetails:{errors:consoleErrors.slice(0,8)}});
    if(failedRequests.length)add('high','Functional','Failed network requests observed',`${failedRequests.length} request(s) failed. First: ${failedRequests[0].url} — ${failedRequests[0].error}`,'Inspect the failed request, dependency availability and browser/server logs.','High',{evidenceKind:'network',evidenceDetails:{requests:failedRequests.slice(0,8)}});
    if(httpErrors.some(x=>x.status>=500))add('critical','Functional','Runtime request returns 5xx',`Observed ${httpErrors.filter(x=>x.status>=500).length} request(s) with 5xx status. First: ${httpErrors.find(x=>x.status>=500)?.method} ${httpErrors.find(x=>x.status>=500)?.url}`,'Investigate the failing endpoint/server logs and retest the owning journey.','High',{evidenceKind:'network',evidenceDetails:{requests:httpErrors.filter(x=>x.status>=500).slice(0,8)}});

    if(dom.missingAltItems.length){
      let found=patchFirst(/images missing alt/i,{selector:dom.missingAltItems[0].selector,elementHtml:dom.missingAltItems[0].html,evidenceDetails:{count:dom.missingAltItems.length,instances:dom.missingAltItems}});
      if(!found)found=add(dom.missingAltItems.length>5?'high':'medium','Accessibility','Images missing alt text',`${dom.missingAltItems.length} visible image(s) are missing alt attributes in the rendered page.`,'Add meaningful alt text or alt="" for decorative images.','High',{selector:dom.missingAltItems[0].selector,elementHtml:dom.missingAltItems[0].html,evidenceDetails:{count:dom.missingAltItems.length,instances:dom.missingAltItems}});
      const art=await captureElement(page,reportId,found,found.selector,'First image missing alt','1366×820'); if(art)found.artifacts.push(art);
    }
    if(dom.unlabeledItems.length){
      const t=dom.unlabeledItems[0]; const found=add('medium','Accessibility','Interactive controls may be unlabeled',`${dom.unlabeledItems.length} visible control(s) do not expose an obvious text/ARIA/label name. First selector: ${t.selector}`,'Give every interactive control an accessible name.','Medium',{selector:t.selector,elementHtml:t.html,evidenceDetails:{instances:dom.unlabeledItems}});
      const art=await captureElement(page,reportId,found,t.selector,'Unlabeled interactive control','1366×820'); if(art)found.artifacts.push(art);
    }
    if(dom.duplicateItems.length){
      const t=dom.duplicateItems[0]; const found=add('medium','Best Practices','Duplicate element IDs observed',`Duplicate IDs: ${dom.dupIds.slice(0,6).join(', ')}. First captured element: ${t.selector}`,'Ensure IDs are unique, especially in repeated components/templates.','High',{selector:t.selector,elementHtml:t.html,evidenceDetails:{duplicateIds:dom.dupIds,instances:dom.duplicateItems}});
      const art=await captureElement(page,reportId,found,t.selector,'Element using duplicated ID','1366×820'); if(art)found.artifacts.push(art);
    }
    if(dom.timing?.load>4500)add('high','Performance','Slow browser load sample',`Browser load event completed in ${dom.timing.load} ms during this deep sample.`,'Inspect large/render-blocking resources and confirm with a dedicated performance profile.','Medium',{evidenceKind:'performance',evidenceDetails:{timing:dom.timing}});
    if(dom.resourceBytes>4*1024*1024)add('medium','Performance','Heavy page transfer sample',`Observed resource transfer size was approximately ${Math.round(dom.resourceBytes/1024/1024*10)/10} MB across ${dom.resourceCount} sampled resources.`,'Optimize large assets and remove unnecessary third-party or duplicate dependencies.','Medium',{evidenceKind:'performance',evidenceDetails:{resourceBytes:dom.resourceBytes,resourceCount:dom.resourceCount}});
    const mixed=network.filter(x=>pageSummary.url.startsWith('https://')&&x.url.startsWith('http://'));
    if(mixed.length)add('high','Security','Mixed-content resource observed',`HTTPS page requested ${mixed.length} HTTP resource(s). First: ${mixed[0].url}`,'Serve every subresource over HTTPS and update hard-coded HTTP URLs.','High',{evidenceKind:'network',evidenceDetails:{requests:mixed.slice(0,8)}});

    const mobile={};
    if(index<cfg.mobile){
      await page.setViewportSize({width:390,height:844}); await sleep(260);
      Object.assign(mobile,await page.evaluate(()=>{
        const cssPath=el=>{if(el.id)return`#${CSS.escape(el.id)}`;const parts=[];let cur=el;while(cur&&cur.nodeType===1&&cur!==document.documentElement&&parts.length<5){let p=cur.tagName.toLowerCase();const cl=[...cur.classList].slice(0,2);if(cl.length)p+='.'+cl.map(CSS.escape).join('.');const parent=cur.parentElement;if(parent){const same=[...parent.children].filter(x=>x.tagName===cur.tagName);if(same.length>1)p+=`:nth-of-type(${same.indexOf(cur)+1})`;}parts.unshift(p);cur=parent;}return parts.join(' > ');};
        const describe=el=>{const r=el.getBoundingClientRect();return{selector:cssPath(el),text:(el.innerText||el.getAttribute('aria-label')||'').trim().slice(0,90),html:el.outerHTML.slice(0,400),right:Math.round(r.right),left:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)};};
        const vw=document.documentElement.clientWidth,sw=document.documentElement.scrollWidth;
        const overflow=[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&(r.right>vw+2||r.left<-2);}).slice(0,12).map(describe);
        const small=[...document.querySelectorAll('a,button,input,select,[role="button"]')].filter(el=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&(r.width<36||r.height<36);}).slice(0,12).map(describe);
        return {horizontalOverflow:sw>vw+2,scrollWidth:sw,viewportWidth:vw,overflowElements:overflow,smallTapTargets:small};
      }));
      if(mobile.horizontalOverflow){
        const t=mobile.overflowElements[0]; const found=add('high','Responsive','Horizontal overflow on mobile',`At 390px viewport, document width is ${mobile.scrollWidth}px while viewport is ${mobile.viewportWidth}px. First offending selector: ${t?.selector||'unknown'}.`,'Fix the specific overflowing layout/media elements and retest at small widths.','High',{selector:t?.selector,elementHtml:t?.html,evidenceDetails:{viewport:{width:390,height:844},overflowElements:mobile.overflowElements,scrollWidth:mobile.scrollWidth}});
        const art=await captureElement(page,reportId,found,t?.selector,'Overflowing element at 390px','390×844'); if(art)found.artifacts.push(art);
      }
      if(mobile.smallTapTargets.length>=4){
        const t=mobile.smallTapTargets[0]; const found=add('medium','Responsive','Small tap targets on mobile',`${mobile.smallTapTargets.length} sampled visible controls are below the touch-size heuristic. First: ${t?.selector} (${t?.w}×${t?.h}px).`,'Increase clickable area and spacing for mobile controls.','Medium',{selector:t?.selector,elementHtml:t?.html,evidenceDetails:{viewport:{width:390,height:844},targets:mobile.smallTapTargets}});
        const art=await captureElement(page,reportId,found,t?.selector,'Small mobile tap target','390×844'); if(art)found.artifacts.push(art);
      }
      await page.setViewportSize({width:1366,height:820}); await sleep(100);
    }

    const interactionChecks=[];
    if(cfg.interactions>0){
      const candidates=dom.buttons.filter(x=>x.text&&!riskyClick.test(x.text)&&/menu|nav|toggle|tab|accordion|filter|sort|expand|collapse|open|close|next|prev|more|details/i.test(`${x.text} ${x.cls}`)).slice(0,cfg.interactions);
      for(const c of candidates){
        const loc=page.locator(c.selector).first();
        let preArtifact=null;
        try{
          const before={url:page.url(),text:await page.locator('body').innerText({timeout:2000}).then(x=>x.length).catch(()=>0),networkHits,httpErrors:httpErrors.length,consoleErrors:consoleErrors.length};
          const tempIssue=issue({severity:'low',category:'Functional',title:`Interaction evidence: ${c.text||c.selector}`,evidence:'Pre-click evidence capture.',url:pageSummary.url,selector:c.selector,confidence:'Low'});
          preArtifact=await captureElement(page,reportId,tempIssue,c.selector,`Before click · ${c.text||'control'}`,'1366×820');
          await loc.click({timeout:3200}); await sleep(260);
          const after={url:page.url(),text:await page.locator('body').innerText({timeout:2000}).then(x=>x.length).catch(()=>0),networkHits,httpErrors:httpErrors.length,consoleErrors:consoleErrors.length};
          const changed=after.url!==before.url||Math.abs(after.text-before.text)>10||after.networkHits>before.networkHits;
          const newHttp=httpErrors.slice(before.httpErrors);
          const newConsole=consoleErrors.slice(before.consoleErrors);
          const check={text:c.text,selector:c.selector,role:c.tag,outcome:changed?'observable-change':'no-observable-change',networkHits:after.networkHits-before.networkHits,error:'',httpErrors:newHttp.slice(0,5),consoleErrors:newConsole.slice(0,5)};
          interactionChecks.push(check);
          if(!changed){
            const found=add('low','Functional','UI control produced no observable effect',`Safe click on “${c.text||c.selector}” produced no URL change, meaningful body-length change, or network activity in the observation window.`,'Reproduce manually and verify the control wiring/state.','Low',{selector:c.selector,elementHtml:c.html,reproductionSteps:[`Open ${pageSummary.url}.`,`Locate “${c.text||c.selector}” (${c.selector}).`,'Click the control once.','Observe whether the intended UI state, navigation or network activity occurs.'],expected:'The control should produce its documented UI/navigation/state effect.',actual:'ARGUS detected no observable URL, body-length or network change during the conservative observation window.',evidenceDetails:{interaction:check}});
            if(preArtifact)found.artifacts.push({...preArtifact,label:'Control with no observed effect'});
          }
          if(newHttp.some(x=>x.status>=500)){
            const fail=newHttp.find(x=>x.status>=500);
            const found=add('critical','Functional','Interaction triggered failing request',`Clicking “${c.text||c.selector}” was followed by ${fail.status} from ${fail.method} ${fail.url}.`,'Investigate the endpoint and owning UI journey.','High',{selector:c.selector,elementHtml:c.html,reproductionSteps:[`Open ${pageSummary.url}.`,`Locate “${c.text||c.selector}”.`,'Click the control once.',`Observe ${fail.status} on ${fail.method} ${fail.url}.`],expected:'The interaction should complete without a server-side failure.',actual:`The interaction was followed by HTTP ${fail.status}.`,evidenceKind:'interaction+network',evidenceDetails:{interaction:check,request:fail}});
            if(preArtifact)found.artifacts.push({...preArtifact,label:'Trigger control'});
          }
        }catch(error){
          const check={text:c.text,selector:c.selector,role:c.tag,outcome:'error',networkHits:0,error:error.message.slice(0,500)}; interactionChecks.push(check);
          const found=add('medium','Functional','Interaction error during safe click',`ARGUS could not complete safe click on “${c.text||c.selector}”: ${check.error}`,'Inspect overlay, disabled state, re-render timing and event wiring.','Medium',{selector:c.selector,elementHtml:c.html,reproductionSteps:[`Open ${pageSummary.url}.`,`Locate “${c.text||c.selector}” (${c.selector}).`,'Attempt the same click manually.','Check whether an overlay, disabled state or re-render blocks the interaction.'],evidenceDetails:{interaction:check}});
          if(preArtifact)found.artifacts.push({...preArtifact,label:'Control that failed interaction test'});
        }
      }
    }

    issues=issues.map(i=>enrichIssue(i));
    const artifacts=issues.flatMap(i=>i.artifacts||[]);
    return {...pageSummary,url:finalUrl,status:response?.status()||pageSummary.status,title:dom.title||pageSummary.title,h1:dom.h1.length?dom.h1:pageSummary.h1,issues,consoleErrors,failedRequests,httpErrors,network,performance:dom.timing?{...dom.timing,resourceBytes:dom.resourceBytes,resourceCount:dom.resourceCount}:null,a11y:{missingAlt:dom.missingAltItems.length,unlabeledControls:dom.unlabeledItems.length,duplicateIds:dom.dupIds.length},mobileAudit:Object.keys(mobile).length?mobile:null,interactionChecks,evidenceArtifacts:artifacts,designSample:{fonts:dom.fonts,colors:dom.colors},deepTested:true};
  }catch(error){
    const issues=[...(pageSummary.issues||[]),issue({severity:'high',category:'Functional',title:'Deep browser test failed',evidence:error.message,recommendation:'Open the page manually and inspect browser/network errors, then retry ARGUS.',confidence:'High',url:pageSummary.url,evidenceKind:'browser'})];
    return {...pageSummary,issues,consoleErrors,failedRequests,httpErrors,network,deepTested:true,deepError:error.message};
  }finally{await context.close(); onProgress?.({stage:'deep',message:`Investigated ${index+1} deep page(s)`,done:index+1,total:cfg.deep});}
}

function technologies(pages){
  const hay=pages.flatMap(p=>p.resources||[]).join('\n').toLowerCase(); const html=pages.map(p=>`${p.headers?.['x-powered-by']||''} ${p.title||''}`).join(' ').toLowerCase(); const out=[];
  const add=(name,evidence)=>{if(!out.some(x=>x.name===name))out.push({name,evidence});};
  if(/jquery/.test(hay))add('jQuery','Resource URL'); if(/bootstrap/.test(hay))add('Bootstrap','Resource URL'); if(/react|_next\//.test(hay))add(/_next\//.test(hay)?'Next.js':'React','JavaScript assets'); if(/angular/.test(hay))add('Angular','JavaScript assets'); if(/vue/.test(hay))add('Vue','JavaScript assets'); if(/fontawesome|font-awesome/.test(hay))add('Font Awesome','Asset URL'); if(/google-analytics|googletagmanager/.test(hay))add('Google Analytics / GTM','External resource'); if(/cloudflare/.test(hay))add('Cloudflare','External resource'); if(/asp\.net|x-aspnet|__viewstate/.test(html+hay))add('ASP.NET','Headers/assets');
  return out;
}

function externalHosts(pages,root){
  const origin=new URL(root).hostname; const map=new Map();
  for(const p of pages)for(const r of p.resources||[]){try{const u=new URL(r);if(u.hostname===origin)continue;const x=map.get(u.hostname)||{host:u.hostname,pageSet:new Set(),resources:0,categories:new Set()};x.pageSet.add(p.url);x.resources++;const s=u.pathname.toLowerCase();x.categories.add(/font/.test(s)?'font':/\.css/.test(s)?'style':/\.js/.test(s)?'script':/image|\.png|\.jpg|\.webp|\.svg/.test(s)?'image':'other');map.set(u.hostname,x);}catch{}}
  return [...map.values()].map(x=>({host:x.host,pageCount:x.pageSet.size,resources:x.resources,category:[...x.categories].join(', ')})).sort((a,b)=>b.resources-a.resources);
}

function templateGroups(pages){const map=new Map();for(const p of pages){const id=p.templateId||routePattern(p.url);const x=map.get(id)||{id,pageCount:0,routePatterns:[id],example:p.url,issueCount:0,deepTested:0};x.pageCount++;x.issueCount+=(p.issues||[]).length;if(p.deepTested)x.deepTested++;map.set(id,x);}return [...map.values()].sort((a,b)=>b.pageCount-a.pageCount);}
function issueCounts(pages){const out={critical:0,high:0,medium:0,low:0,total:0};for(const p of pages)for(const i of p.issues||[]){out[i.severity]=(out[i.severity]||0)+1;out.total++;}return out;}
function scoreFrom(counts){return clamp(Math.round(100-(counts.critical*10+counts.high*4+counts.medium*1.5+counts.low*.4)),0,100);}
function systemicPatterns(pages){const map=new Map();for(const p of pages)for(const i of p.issues||[]){const key=`${i.category}|${i.title}`;const x=map.get(key)||{category:i.category,title:i.title,severity:i.severity,pageCount:0,pages:[],recommendation:i.recommendation,likelyCause:i.likelyCause,owner:i.owner,priority:i.priority};x.pageCount++;if(x.pages.length<12)x.pages.push(p.url);map.set(key,x);}return [...map.values()].filter(x=>x.pageCount>1).sort((a,b)=>b.pageCount-a.pageCount).slice(0,40);}
function consoleGroups(pages){const map=new Map();for(const p of pages)for(const e of p.consoleErrors||[]){const sig=cleanText(e).replace(/https?:\/\/\S+/g,'<url>').replace(/\d+/g,'#').slice(0,220);const x=map.get(sig)||{signature:sig,example:e,pageCount:0,occurrences:0,pages:[]};x.occurrences++;if(!x.pages.includes(p.url)){x.pageCount++;if(x.pages.length<10)x.pages.push(p.url);}map.set(sig,x);}return [...map.values()].sort((a,b)=>b.occurrences-a.occurrences).slice(0,30);}

async function previousForHost(host,currentId){try{const files=(await fs.readdir(SCAN_DIR)).filter(x=>x.endsWith('.json')).sort().reverse();for(const f of files){const j=JSON.parse(await fs.readFile(path.join(SCAN_DIR,f),'utf8'));if(j.id!==currentId&&new URL(j.rootUrl).hostname===host)return j;}}catch{}return null;}
function changeGuard(current,prev){if(!prev)return{available:false,status:'baseline',delta:null,newIssues:[],resolvedIssues:[],performanceRegressions:[],performanceImprovements:[]};const cur=new Map(),old=new Map();for(const p of current.pages)for(const i of p.issues||[])cur.set(issueFingerprint(i),{...i,page:p.url});for(const p of prev.pages||[])for(const i of p.issues||[])old.set(issueFingerprint(i),{...i,page:p.url});const newIssues=[...cur].filter(([k])=>!old.has(k)).map(([,v])=>v).slice(0,50),resolvedIssues=[...old].filter(([k])=>!cur.has(k)).map(([,v])=>v).slice(0,50);const prevPerf=new Map((prev.pages||[]).filter(p=>p.performance?.load).map(p=>[p.url,p.performance.load]));const regs=[],imps=[];for(const p of current.pages){if(!p.performance?.load||!prevPerf.has(p.url))continue;const before=prevPerf.get(p.url),after=p.performance.load,pct=Math.round(((after-before)/Math.max(before,1))*100);if(pct>=25)regs.push({url:p.url,before,after,percent:pct});if(pct<=-25)imps.push({url:p.url,before,after,percent:pct});}return{available:true,status:newIssues.length?'changed':'stable',delta:{issues:current.issueCounts.total-(prev.issueCounts?.total||0),score:current.score-(prev.score||0)},newIssues,resolvedIssues,performanceRegressions:regs.slice(0,25),performanceImprovements:imps.slice(0,25)};}

function designSystem(pages){const fonts=uniq(pages.flatMap(p=>p.designSample?.fonts||[])).slice(0,20),colors=uniq(pages.flatMap(p=>p.designSample?.colors||[])).slice(0,20);return{fonts,colors};}
function responsive(pages){const tested=pages.filter(p=>p.mobileAudit);return{pagesTested:tested.length,horizontalOverflowPages:tested.filter(p=>p.mobileAudit?.horizontalOverflow).length,smallTapTargetPages:tested.filter(p=>(p.mobileAudit?.smallTapTargets?.length||0)>=4).length};}
function interactions(pages){const checks=pages.flatMap(p=>(p.interactionChecks||[]).map(x=>({...x,url:p.url})));return{tested:checks.length,observable:checks.filter(x=>x.outcome==='observable-change').length,noObservableChange:checks.filter(x=>x.outcome==='no-observable-change').length,errors:checks.filter(x=>x.outcome==='error').length,checks:checks.slice(0,100)};}
function investigationStats(pages){const issues=pages.flatMap(p=>p.issues||[]);return{issuesWithVisualEvidence:issues.filter(i=>(i.artifacts||[]).some(a=>a.kind==='element-screenshot')).length,issuesWithSelectors:issues.filter(i=>i.selector).length,networkEvidenceIssues:issues.filter(i=>/network/.test(i.evidenceKind||'')).length,confirmedObservations:issues.filter(i=>i.status==='confirmed-observation').length,heuristics:issues.filter(i=>i.status==='heuristic'||i.confidence==='Low').length};}

async function mapPool(items, concurrency, worker, onItem) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({length:Math.min(concurrency,items.length)}, async()=>{
    while(true){const i=cursor++;if(i>=items.length)return;results[i]=await worker(items[i],i);onItem?.(i,results[i]);}
  });
  await Promise.all(runners);
  return results;
}

function releaseGate(pages, counts) {
  const all=pages.flatMap(p=>(p.issues||[]).map(i=>({...i,page:p.url})));
  const blockers=all.filter(i=>i.severity==='critical'||(i.severity==='high'&&['Functional','Security'].includes(i.category))).slice(0,20);
  const status=blockers.length?'BLOCK':counts.high?'REVIEW':'READY-WITH-REVIEW';
  return {status,blockerCount:blockers.length,blockers,reason:blockers.length?'Critical/high functional or security evidence should be reviewed before release.':counts.high?'No release blocker rule fired, but high-severity findings remain.':'No critical/high release-blocker rule fired in scanned coverage.'};
}

export async function runScan({url,mode='standard',options={}},onProgress){
  const root=(await assertPublicUrl(url)).toString(); const base=MODES[mode]||MODES.standard; const cfg={...base};
  cfg.discovered=Math.min(cfg.discovered,envInt('ARGUS_MAX_DISCOVERED_URLS',5000)); cfg.light=Math.min(cfg.light,envInt('ARGUS_MAX_LIGHT_PAGES',1200)); cfg.deep=Math.min(cfg.deep,envInt('ARGUS_MAX_DEEP_PAGES',220));
  if(options.crawlEntireSite===false){cfg.discovered=Math.min(cfg.discovered,40);cfg.light=Math.min(cfg.light,30);}
  if(options.testInteractions===false)cfg.interactions=0; if(options.mobile===false)cfg.mobile=0;
  const id=`${Date.now()}-${sha(root)}`; const started=Date.now();
  await fs.mkdir(SCAN_DIR,{recursive:true}); await fs.mkdir(SCREEN_DIR,{recursive:true});
  onProgress?.({stage:'start',message:'Validating target and building scan plan…',done:0,total:1});
  const discovered=await discover(root,cfg,onProgress); const selected=discovered.slice(0,cfg.light);
  let completedLight=0;
  const lightConcurrency=Math.min(12,envInt('ARGUS_LIGHT_CONCURRENCY',6));
  const pages=await mapPool(selected,lightConcurrency,item=>lightScan(item),()=>{completedLight++;if(completedLight%5===0||completedLight===selected.length)onProgress?.({stage:'light',message:`Broad QA ${completedLight}/${selected.length}`,done:completedLight,total:selected.length});});
  const deepTargets=chooseDeepPages(pages,cfg); let browser=null;
  if(deepTargets.length){const executablePath=await findBrowserExecutable();const launch={headless:String(process.env.ARGUS_HEADLESS||'true').toLowerCase()!=='false'};if(executablePath)launch.executablePath=executablePath;else if(process.env.ARGUS_BROWSER_CHANNEL)launch.channel=process.env.ARGUS_BROWSER_CHANNEL;browser=await chromium.launch(launch);}
  try{for(let i=0;i<deepTargets.length;i++){const result=await deepScan(browser,deepTargets[i],cfg,i,id,onProgress);const idx=pages.findIndex(p=>p.url===deepTargets[i].url);if(idx>=0)pages[idx]=result;}}
  finally{if(browser)await browser.close();}
  const counts=issueCounts(pages); const brokenLinks=pages.filter(p=>p.status===404||p.status===0).map(p=>({url:p.url,status:p.status,source:p.discoveredBy}));
  const templates=templateGroups(pages);
  const report={id,version:'3.0.0',rootUrl:root,scannedAt:new Date().toISOString(),durationMs:Date.now()-started,scanMode:mode,browserEngine:'Chromium / installed Chrome',coverage:{urlsDiscovered:discovered.length,uniquePages:selected.length,lightChecked:pages.length,deepTested:pages.filter(p=>p.deepTested).length,templates:templates.length,discoveryLimit:cfg.discovered,lightLimit:cfg.light,deepLimit:cfg.deep,lightConcurrency},scanPlan:{mode,deepTargets:deepTargets.map(p=>({url:p.url,templateId:p.templateId,reason:(p.issues||[]).length?'existing findings':(p.forms||[]).length?'form/critical journey':'template representative'})).slice(0,250)},pages,issueCounts:counts,score:scoreFrom(counts),releaseGate:releaseGate(pages,counts),brokenLinks,technologies:technologies(pages),externalHosts:externalHosts(pages,root),templateGroups:templates,systemicPatterns:systemicPatterns(pages),consoleGroups:consoleGroups(pages),designSystem:designSystem(pages),responsive:responsive(pages),interactions:interactions(pages),investigation:investigationStats(pages),timeline:[]};
  const prev=options.comparePrevious===false?null:await previousForHost(new URL(root).hostname,id); report.changeGuard=changeGuard(report,prev);
  report.timeline=[{label:'Scan started',at:new Date(started).toISOString()},{label:`URLs discovered (${report.coverage.urlsDiscovered})`,at:new Date(started+Math.min(report.durationMs*.16,report.durationMs)).toISOString()},{label:`Broad QA completed (${report.coverage.lightChecked})`,at:new Date(started+Math.min(report.durationMs*.55,report.durationMs)).toISOString()},{label:`Deep investigation completed (${report.coverage.deepTested})`,at:new Date().toISOString()},{label:`Issue evidence captured (${report.investigation.issuesWithVisualEvidence})`,at:new Date().toISOString()},{label:'Report ready',at:new Date().toISOString()}];
  await fs.writeFile(path.join(SCAN_DIR,`${id}.json`),JSON.stringify(report,null,2));onProgress?.({stage:'done',message:'ARGUS investigation report ready',done:1,total:1,reportId:id});return report;
}

export async function getReport(id){const safe=String(id||'').replace(/[^a-zA-Z0-9_-]/g,'');if(!safe)return null;try{return JSON.parse(await fs.readFile(path.join(SCAN_DIR,`${safe}.json`),'utf8'));}catch{return null;}}
export async function listReports(limit=30){try{const files=(await fs.readdir(SCAN_DIR)).filter(x=>x.endsWith('.json')).sort().reverse().slice(0,limit);const out=[];for(const f of files){try{const j=JSON.parse(await fs.readFile(path.join(SCAN_DIR,f),'utf8'));out.push({id:j.id,rootUrl:j.rootUrl,scannedAt:j.scannedAt,score:j.score,issueCounts:j.issueCounts,coverage:j.coverage,scanMode:j.scanMode,durationMs:j.durationMs,investigation:j.investigation});}catch{}}return out;}catch{return[];}}
