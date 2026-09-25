const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sevRank={critical:4,high:3,medium:2,low:1};
const state={report:null,view:'overview',history:[],selectedIssue:null,issueAi:{},globalAi:null};
const modeHints={quick:'Up to 35 broad checks · 8 deep investigations',standard:'Up to 140 broad checks · 30 deep investigations',deep:'Up to 450 broad checks · 90 deep investigations',full:'Up to 1,200 broad checks · 220 deep investigations'};
const fmtDate=d=>{try{return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(d));}catch{return d||'—';}};
const fmtMs=ms=>ms==null?'—':ms<1000?`${Math.round(ms)} ms`:`${(ms/1000).toFixed(2)} s`;
const fmtBytes=n=>!n?'0 B':n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
const shortUrl=u=>{try{const x=new URL(u);return x.pathname+x.search||'/';}catch{return u||'—';}};

function toast(msg,error=false){const e=$('#toast');e.textContent=msg;e.className=`toast show${error?' error':''}`;clearTimeout(toast.t);toast.t=setTimeout(()=>e.className='toast',3500);}
async function api(url,opts){const r=await fetch(url,opts);const t=await r.text();let j;try{j=JSON.parse(t);}catch{j={error:t||r.statusText};}if(!r.ok)throw new Error(j.error||j.message||`HTTP ${r.status}`);return j;}
function allIssues(){if(!state.report)return[];return state.report.pages.flatMap(p=>(p.issues||[]).map(i=>({...i,page:p}))).sort((a,b)=>(sevRank[b.severity]||0)-(sevRank[a.severity]||0));}
function groupedIssues(){
  if(!state.report)return[];
  const raw=allIssues(),byId=new Map(raw.map(i=>[i.id,i]));
  const saved=state.report.groupedFindings?.findings;
  if(Array.isArray(saved)&&saved.length){
    return saved.map(g=>{
      const rep=byId.get(g.representativeIssueId)||raw.find(i=>i.title===g.title&&i.category===g.category)||{};
      return {...rep,...g,id:g.representativeIssueId||rep.id,url:g.representativeUrl||rep.url,occurrenceCount:g.occurrenceCount||1,affectedPages:g.affectedPages||[rep.url].filter(Boolean),grouped:true};
    }).sort((a,b)=>(sevRank[b.severity]||0)-(sevRank[a.severity]||0)||b.occurrenceCount-a.occurrenceCount);
  }
  const map=new Map();
  for(const i of raw){
    const key=`${String(i.category||'Other').toLowerCase()}|${String(i.title||'Untitled').toLowerCase().replace(/\s+/g,' ').trim()}`;
    const g=map.get(key)||{...i,occurrenceCount:0,affectedPages:[],grouped:true};
    g.occurrenceCount++;
    if(i.url&&!g.affectedPages.includes(i.url))g.affectedPages.push(i.url);
    if((sevRank[i.severity]||0)>(sevRank[g.severity]||0))Object.assign(g,i);
    map.set(key,g);
  }
  return [...map.values()].sort((a,b)=>(sevRank[b.severity]||0)-(sevRank[a.severity]||0)||b.occurrenceCount-a.occurrenceCount);
}
function categories(){const m={};for(const i of groupedIssues())m[i.category]=(m[i.category]||0)+1;return m;}
function sevBadge(s){return `<span class="severity ${esc(s)}">${esc(s)}</span>`;}
function panelHead(title,sub='',right=''){return `<div class="panel-head"><div><h3>${esc(title)}</h3>${sub?`<p>${esc(sub)}</p>`:''}</div>${right}</div>`;}
function markdown(text=''){return esc(text).split('\n').map(line=>{if(line.startsWith('# '))return`<h1>${line.slice(2)}</h1>`;if(line.startsWith('## '))return`<h2>${line.slice(3)}</h2>`;if(/^[-*] /.test(line))return`<li>${line.slice(2)}</li>`;if(/^\d+\. /.test(line))return`<li>${line.replace(/^\d+\. /,'')}</li>`;if(!line.trim())return'<br>';return`<p>${line}</p>`;}).join('').replace(/(?:<li>.*?<\/li>)+/gs,m=>`<ul>${m}</ul>`);}

async function boot(){try{const s=await api('/api/status');$('#engineDot').classList.add('ok');$('#engineStatus').textContent=`Engine ready · v${s.version} · AI ${s.ai?.configured?`${s.ai.provider}/${s.ai.model}`:'optional'} · DB probe ${s.healthProbeConfigured?'on':'off'}`;}catch{$('#engineStatus').textContent='Engine unavailable';}await loadHistory();}
async function loadHistory(){try{state.history=(await api('/api/history')).items||[];}catch{state.history=[];}}

$('#scanMode').onchange=e=>$('#modeHint').textContent=modeHints[e.target.value];
$('#mobileMenu').onclick=()=>$('#sidebar').classList.toggle('open');
$('#startScan').onclick=startScan;$('#urlInput').onkeydown=e=>{if(e.key==='Enter')startScan();};
$('#exportBtn').onclick=()=>{if(!state.report)return toast('Run or open a report first.',true);location.href=`/api/reports/${encodeURIComponent(state.report.id)}/export.json`;};
$('#htmlBtn').onclick=downloadHtml;

for(const btn of $$('#nav .nav'))btn.onclick=()=>{if(btn.dataset.action==='newScan'){window.scrollTo({top:0,behavior:'smooth'});$('#urlInput').focus();return;}switchView(btn.dataset.view);};
for(const btn of $$('#tabs .tab'))btn.onclick=()=>switchView(btn.dataset.view);

async function startScan(){const url=$('#urlInput').value.trim();if(!url)return toast('Enter an authorized public URL.',true);$('#startScan').disabled=true;$('#progress').classList.remove('hidden');$('#progressBar').style.width='4%';$('#progressTitle').textContent='Planning investigation…';$('#progressMeta').textContent='';try{const job=await api('/api/scans',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,mode:$('#scanMode').value,options:{crawlEntireSite:$('#crawlEntireSite').checked,testInteractions:$('#testInteractions').checked,mobile:$('#mobileChecks').checked,comparePrevious:$('#comparePrevious').checked}})});pollJob(job.id);}catch(e){$('#startScan').disabled=false;toast(e.message,true);}}
async function pollJob(id){try{const j=await api(`/api/jobs/${id}`),p=j.progress||{};const pct=j.status==='completed'?100:p.total?Math.max(5,Math.min(96,Math.round((p.done/p.total)*100))):12;$('#progressBar').style.width=`${pct}%`;$('#progressTitle').textContent=p.message||j.status;$('#progressMeta').textContent=p.total>1?`${p.done||0} / ${p.total}`:'';if(j.status==='completed'){state.report=await api(`/api/reports/${j.reportId}`);state.globalAi=null;state.issueAi={};state.selectedIssue=groupedIssues()[0]?.id||null;$('#startScan').disabled=false;setTimeout(()=>$('#progress').classList.add('hidden'),900);await loadHistory();renderReport();toast('Investigation complete.');return;}if(j.status==='failed')throw new Error(j.error||p.message||'Scan failed');setTimeout(()=>pollJob(id),800);}catch(e){$('#startScan').disabled=false;toast(e.message,true);}}

function renderReport(){const r=state.report;if(!r)return;$('#welcome').classList.add('hidden');$('#workspace').classList.remove('hidden');$('#reportUrl').textContent=r.rootUrl;$('#reportMeta').textContent=`${fmtDate(r.scannedAt)} · ${r.scanMode} · ${fmtMs(r.durationMs)} · ${r.coverage?.urlsDiscovered||0} discovered`;$('#mScore').textContent=r.score??'—';$('#mPages').textContent=r.coverage?.lightChecked||0;$('#mDeep').textContent=r.coverage?.deepTested||0;$('#mEvidence').textContent=r.investigation?.issuesWithVisualEvidence||0;$('#mIssues').textContent=groupedIssues().length||0;$('#navIssueCount').textContent=groupedIssues().length||0;switchView(state.view||'overview');}

function switchView(view){if(!view)return;state.view=view;$$('.nav').forEach(x=>x.classList.toggle('active',x.dataset.view===view));$$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view===view));if(view==='history')return renderHistory();if(!state.report)return toast('Run a scan or open one from History first.',true);({overview:renderOverview,issues:renderIssues,pages:renderPages,journeys:renderJourneys,network:renderNetwork,dynamic:renderDynamic,performance:renderPerformance,accessibility:renderAccessibility,changeguard:renderChangeGuard,ai:renderAI}[view]||renderOverview)();}

function renderOverview(){
  const r=state.report,iss=groupedIssues(),cats=categories();
  const critical=iss.filter(i=>i.severity==='critical').length;
  const high=iss.filter(i=>i.severity==='high').length;
  const medium=iss.filter(i=>i.severity==='medium').length;
  const low=iss.filter(i=>i.severity==='low').length;
  const top=iss[0]||null;
  const topArt=top?.artifacts?.[0];
  const cg=r.changeGuard||{};
  const crawled=r.coverage?.lightChecked||0;
  const discovered=r.coverage?.urlsDiscovered||crawled||1;
  const excluded=Math.max(0,discovered-crawled);
  const coveragePct=Math.round((crawled/Math.max(discovered,1))*100);
  const coverageDeg=Math.round(coveragePct*3.6);
  const deepPct=Math.round(((r.coverage?.deepTested||0)/Math.max(crawled,1))*100);
  const severityTotal=Math.max(iss.length,1);
  const issueBars=[
    ['critical',critical,'Critical'],
    ['high',high,'High'],
    ['medium',medium,'Medium'],
    ['low',low,'Low']
  ];
  const categoryRows=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,6);

  $('#view').innerHTML=`
  <div class="view enterprise-dashboard">
    <div class="dashboard-top-grid">
      <section class="card overview-card">
        <div class="section-title-row">
          <div>
            <h3>Investigation Overview</h3>
            <p>Coverage, severity distribution and scan health</p>
          </div>
          <span class="status-chip success">● Completed</span>
        </div>

        <div class="overview-body">
          <div class="coverage-ring-wrap">
            <div class="coverage-ring" style="--coverage:${coverageDeg}deg">
              <div><b>${crawled}</b><span>of ${discovered} pages</span></div>
            </div>
            <div class="coverage-legend">
              <div><i class="legend-dot blue"></i><span>Crawled</span><b>${crawled}</b><em>${coveragePct}%</em></div>
              <div><i class="legend-dot red"></i><span>Not checked</span><b>${excluded}</b><em>${100-coveragePct}%</em></div>
              <div><i class="legend-dot purple"></i><span>Deep tested</span><b>${r.coverage?.deepTested||0}</b><em>${deepPct}%</em></div>
              <div><i class="legend-dot gray"></i><span>Templates</span><b>${r.coverage?.templates||0}</b><em>unique</em></div>
            </div>
          </div>

          <div class="issue-trend-panel">
            <div class="issue-trend-head">
              <strong>Findings by severity</strong>
              <span>${iss.length} total findings</span>
            </div>
            <div class="severity-bars">
              ${issueBars.map(([s,n,label])=>`<div class="severity-bar-row"><span>${label}</span><div class="severity-track"><i class="${s}" style="width:${Math.max(4,Math.round(n/severityTotal*100))}%"></i></div><b>${n}</b></div>`).join('')}
            </div>
            <div class="category-mini-grid">
              ${categoryRows.map(([k,v])=>`<div><span>${esc(k)}</span><b>${v}</b></div>`).join('')||'<div><span>No categories yet</span><b>0</b></div>'}
            </div>
          </div>
        </div>
      </section>

      <section class="card fix-first-card">
        <div class="section-title-row">
          <div><h3>Fix First</h3><p>${critical?critical+' critical issue(s) require attention':'Highest-priority findings'}</p></div>
          <button class="text-action" data-go-issues>View all →</button>
        </div>
        <div class="fix-first-list">
          ${iss.slice(0,5).map((i,n)=>`
            <button class="fix-first-item" data-issue="${esc(i.id)}">
              <span class="rank">${n+1}</span>
              <span class="fix-copy"><strong>${esc(i.title)}</strong><small>${esc(shortUrl(i.url))}</small><em>${esc(i.evidence)}</em></span>
              ${sevBadge(i.severity)}
              <span class="chevron">›</span>
            </button>`).join('')||'<div class="empty compact">No findings in scanned coverage.</div>'}
        </div>
      </section>
    </div>

    <div class="dashboard-main-grid">
      <section class="card evidence-preview-card">
        <div class="section-title-row">
          <div><h3>Evidence Lab</h3><p>Visual proof, technical details and reproduction steps</p></div>
          <span class="record-count">1 of ${iss.length||0}</span>
        </div>
        ${top?`
          <div class="evidence-preview-body">
            <div class="evidence-media">
              ${topArt?`<div class="evidence-shot large"><img src="${esc(topArt.url)}" alt="Issue evidence"></div>`:
              '<div class="evidence-empty-visual"><span>◎</span><strong>No visual capture for this issue</strong><small>ARGUS uses runtime/header/network evidence when a screenshot would be misleading.</small></div>'}
              <div class="viewport-chips"><span>Desktop</span><span>Mobile evidence when applicable</span></div>
            </div>
            <div class="evidence-facts">
              <div class="subtabs"><b>Details</b><span>Network</span><span>Console</span><span>Accessibility</span></div>
              <dl>
                <div><dt>Page URL</dt><dd>${esc(top.url)}</dd></div>
                <div><dt>CSS Selector</dt><dd class="mono">${esc(top.selector||'No visual selector')}</dd></div>
                <div><dt>Confidence</dt><dd>${esc(top.confidence||'—')}</dd></div>
                <div><dt>Owner</dt><dd>${esc(top.owner||'Review')}</dd></div>
              </dl>
              <h4>Evidence</h4>
              <p>${esc(top.evidence)}</p>
              <h4>Reproduction Steps</h4>
              <ol class="compact-steps">${(top.reproductionSteps||[]).slice(0,4).map((x,n)=>`<li><i>${n+1}</i><span>${esc(x)}</span></li>`).join('')}</ol>
            </div>
          </div>
          <div class="related-strip">
            ${iss.slice(1,4).map((i,n)=>`<button data-issue="${esc(i.id)}"><span>${n+1}</span><div><b>${esc(i.title)}</b><small>${esc(i.category)}</small></div>${sevBadge(i.severity)}</button>`).join('')}
          </div>
        `:'<div class="empty">No evidence to display.</div>'}
      </section>

      <section class="card solution-card">
        <div class="section-title-row">
          <div><h3>Solution Engine</h3><p>Deterministic fix guidance from captured evidence</p></div>
          ${top?'<span class="status-chip success">High signal</span>':''}
        </div>
        ${top?`
          <div class="solution-scroll">
            <h4>Likely Cause</h4>
            <p>${esc(top.likelyCause||'Review the evidence and owning implementation.')}</p>
            <h4>Recommended Fix</h4>
            <ol class="solution-steps">${(top.solutionSteps||[]).slice(0,5).map((x,n)=>`<li><i>${n+1}</i><span>${esc(x)}</span></li>`).join('')}</ol>
            <h4>Suggested Patch Pattern</h4>
            ${top.fixSnippet?`<pre class="solution-code">${esc(top.fixSnippet)}</pre>`:'<div class="callout">No generic patch is safe for this finding. Follow the implementation steps and inspect the owning code.</div>'}
            <h4>Retest Checklist</h4>
            <div class="retest-grid">${(top.retest||[]).slice(0,6).map(x=>`<span>✓ ${esc(x)}</span>`).join('')}</div>
          </div>
          <button class="primary retest-cta" data-issue="${esc(top.id)}">Open Full Issue & Retest →</button>
        `:'<div class="empty">No solution data yet.</div>'}
      </section>

      <div class="right-stack">
        <section class="card ai-summary-card">
          <div class="section-title-row">
            <div><h3>AI Investigator</h3><p>Optional evidence-bound deep analysis</p></div>
            <span class="ai-pill">✦ ARGUS AI</span>
          </div>
          <div class="ai-summary-body">
            <div class="ai-orb-small">✦</div>
            <div>
              <strong>${state.globalAi?.enabled?'Deep analysis available':'Run AI when you need cross-page reasoning'}</strong>
              <p>${state.globalAi?.enabled?'ARGUS AI analyzed the verified evidence packet.':'The deterministic investigation is already complete. AI is only used for synthesis, hypotheses and prioritization.'}</p>
            </div>
          </div>
          <button class="ai-action wide" data-open-ai>${state.globalAi?.enabled?'View Full Analysis →':'Open AI Investigator →'}</button>
        </section>

        <section class="card changeguard-summary-card">
          <div class="section-title-row">
            <div><h3>ChangeGuard</h3><p>Compared with previous scan</p></div>
            <button class="text-action" data-open-changeguard>View comparison →</button>
          </div>
          <div class="change-stats">
            <div class="danger"><b>${cg.newIssues?.length||0}</b><span>New issues</span></div>
            <div class="success"><b>${cg.resolvedIssues?.length||0}</b><span>Resolved</span></div>
            <div class="purple"><b>${cg.performanceRegressions?.length||0}</b><span>Regressions</span></div>
          </div>
          <div class="change-foot">${cg.available?'Baseline comparison available':'First scan becomes the baseline for future comparisons.'}</div>
        </section>

        <section class="card release-card">
          <div class="section-title-row"><div><h3>Release Gate</h3><p>Automated triage, not deployment approval</p></div></div>
          <div class="release-status ${String(r.releaseGate?.status||'REVIEW').toLowerCase().replace(/[^a-z]/g,'-')}">
            <b>${esc(r.releaseGate?.status||'REVIEW')}</b>
            <span>${esc(r.releaseGate?.reason||'Review findings before release.')}</span>
          </div>
        </section>
      </div>
    </div>
  </div>`;

  $$('[data-go-issues]').forEach(b=>b.onclick=()=>switchView('issues'));
  $$('[data-issue]').forEach(x=>x.onclick=()=>{state.selectedIssue=x.dataset.issue;switchView('issues');});
  $$('[data-open-ai]').forEach(x=>x.onclick=()=>switchView('ai'));
  $$('[data-open-changeguard]').forEach(x=>x.onclick=()=>switchView('changeguard'));
}
function renderIssues(){const issues=groupedIssues();if(!issues.length)state.selectedIssue=null;else if(!state.selectedIssue||!issues.some(x=>x.id===state.selectedIssue))state.selectedIssue=issues[0].id;$('#view').innerHTML=`<div class="view issue-workspace"><aside class="card issue-sidebar"><div class="issue-filters"><input id="issueSearch" placeholder="Search findings, URL, evidence"><select id="issueSeverity"><option value="all">All severity</option><option>critical</option><option>high</option><option>medium</option><option>low</option></select></div><div class="issue-scroll" id="issueList"></div></aside><section class="card issue-detail" id="issueDetail"></section></div>`;$('#issueSearch').oninput=renderIssueList;$('#issueSeverity').onchange=renderIssueList;renderIssueList();renderIssueDetail(state.selectedIssue);}
function renderIssueList(){
  const q=($('#issueSearch')?.value||'').toLowerCase(),sev=$('#issueSeverity')?.value||'all';
  const list=groupedIssues().filter(i=>(sev==='all'||i.severity===sev)&&(!q||`${i.title} ${i.url} ${i.evidence} ${i.category} ${i.owner} ${(i.affectedPages||[]).join(' ')}`.toLowerCase().includes(q)));
  const groups={};
  for(const i of list)(groups[i.category||'Other']||(groups[i.category||'Other']=[])).push(i);
  $('#issueList').innerHTML=Object.entries(groups).sort((a,b)=>Math.max(...b[1].map(i=>sevRank[i.severity]||0))-Math.max(...a[1].map(i=>sevRank[i.severity]||0))).map(([category,items])=>`
    <section class="issue-category-group">
      <div class="issue-category-head"><strong>${esc(category)}</strong><span>${items.length} unique finding${items.length===1?'':'s'}</span></div>
      ${items.map(i=>`<article class="issue-list-item ${i.id===state.selectedIssue?'active':''}" data-issue="${esc(i.id)}"><header><i class="sev-dot ${esc(i.severity)}"></i><h4>${esc(i.title)}</h4>${sevBadge(i.severity)}</header><p>${esc(shortUrl(i.url))}</p><footer><span class="tiny">${esc(i.priority||'')}</span><span class="tiny">${esc(i.owner||'Review')}</span><span class="tiny">${i.occurrenceCount||1} observation${(i.occurrenceCount||1)===1?'':'s'}</span><span class="tiny">${(i.affectedPages||[]).length||1} page${((i.affectedPages||[]).length||1)===1?'':'s'}</span>${(i.artifacts||[]).length?'<span class="tiny">📷 evidence</span>':''}</footer></article>`).join('')}
    </section>`).join('')||'<div class="empty">No matching findings.</div>';
  $('#issueList [data-issue]').forEach(x=>x.onclick=()=>{state.selectedIssue=x.dataset.issue;renderIssueList();renderIssueDetail(state.selectedIssue);});
}
function findIssue(id){
  if(!state.report||!id)return null;
  const group=groupedIssues().find(x=>x.id===id||x.representativeIssueId===id);
  const representativeId=group?.representativeIssueId||id;
  for(const page of state.report.pages||[]){
    const raw=(page.issues||[]).find(x=>x.id===representativeId||x.id===id);
    if(raw)return{
      i:{...group,...raw,id:raw.id,occurrenceCount:group?.occurrenceCount||1,affectedPages:group?.affectedPages||[raw.url].filter(Boolean),templates:group?.templates||[]},
      page,
      group:group||raw
    };
  }
  if(group){
    const page=(state.report.pages||[]).find(p=>p.url===group.representativeUrl||p.url===group.url)||{url:group.representativeUrl||group.url||''};
    return{i:group,page,group};
  }
  return null;
}
function renderIssueDetail(id){const f=findIssue(id);if(!f){$('#issueDetail').innerHTML='<div class="empty">Select a finding.</div>';return;}const {i,page,group:resolvedGroup}=f;
const group=resolvedGroup||groupedIssues().find(x=>x.id===id);
const artifacts=i.artifacts||[];
const art=artifacts[0];
const visuals=[];
const visualSeen=new Set();
for(const a of artifacts){
  if(a?.url&&!visualSeen.has(a.url)){visuals.push({url:a.url,label:a.label||'Exact affected element',viewport:a.viewport||''});visualSeen.add(a.url);}
  if(a?.contextUrl&&!visualSeen.has(a.contextUrl)){visuals.push({url:a.contextUrl,label:a.contextLabel||'Surrounding page context',viewport:a.viewport||''});visualSeen.add(a.contextUrl);}
}
const affectedPages=(group?.affectedPages||i.affectedPages||[i.url]).filter(Boolean);
const impactedTemplates=group?.templates||i.templates||[];
const ai=state.issueAi[i.id]||state.issueAi[id];const evidenceRows=[['Status',i.status],['Confidence',i.confidence],['Owner',i.owner],['Priority',i.priority],['Category',i.category],['Observations',group?.occurrenceCount||1],['Affected pages',(group?.affectedPages||[i.url]).length],['Selector',i.selector||'No visual selector'],['Viewport',art?.viewport||(i.evidenceDetails?.viewport?`${i.evidenceDetails.viewport.width||''}×${i.evidenceDetails.viewport.height||''}`:'—')]];$('#issueDetail').innerHTML=`<div class="detail-hero"><div class="top"><div><div class="detail-badges">${sevBadge(i.severity)}<span class="tiny">${esc(i.priority||'')}</span><span class="tiny">${esc(i.confidence||'')}</span><span class="tiny">${esc(i.owner||'')}</span></div><h2>${esc(i.title)}</h2><p>${esc(i.url)}</p></div><button class="ai-action" id="issueAiBtn">✦ Explain Issue & Fix</button></div></div><div class="detail-body"><div class="detail-grid"><section class="section full issue-summary-section"><div class="section-kicker">Issue Summary</div><div class="issue-summary-grid"><div class="issue-summary-card"><span>Problem</span><strong>${esc(i.evidence||i.title)}</strong></div><div class="issue-summary-card"><span>Why it matters</span><strong>${esc(i.whyItMatters||'Review the affected user flow and evidence to understand the practical impact.')}</strong></div><div class="issue-summary-card"><span>Fix direction</span><strong>${esc((i.solutionSteps||[])[0]||i.recommendation||'Follow the evidence, inspect the owning implementation, then retest the same condition.')}</strong></div></div></section><section class="section full blast-radius-section"><div class="section-kicker">Blast Radius</div><div class="blast-radius-grid"><div><b>${affectedPages.length||1}</b><span>Affected pages</span></div><div><b>${group?.occurrenceCount||i.occurrenceCount||1}</b><span>Observations</span></div><div><b>${impactedTemplates.length||'—'}</b><span>Template groups</span></div><div><b>${esc(i.owner||'Review')}</b><span>Suggested owner</span></div></div>${affectedPages.length?`<details class="affected-pages-details" ${affectedPages.length<=5?'open':''}><summary>View affected URLs</summary><div class="affected-page-list">${affectedPages.slice(0,30).map((u,n)=>`<div><span>${n+1}</span><code>${esc(u)}</code></div>`).join('')}</div></details>`:''}</section><section class="section visual-evidence-section"><h3>Visual Evidence</h3>${visuals.length?`<div class="evidence-gallery"><a class="evidence-primary" href="${esc(visuals[0].url)}" target="_blank" rel="noopener"><img src="${esc(visuals[0].url)}" alt="Primary evidence for ${esc(i.title)}"><span>${esc(visuals[0].label)}${visuals[0].viewport?` · ${esc(visuals[0].viewport)}`:''}</span></a>${visuals.length>1?`<div class="evidence-thumbs">${visuals.slice(1,6).map(v=>`<a href="${esc(v.url)}" target="_blank" rel="noopener"><img src="${esc(v.url)}" alt="${esc(v.label)}"><span>${esc(v.label)}</span></a>`).join('')}</div>`:''}</div>`:`<div class="no-shot deep-no-shot"><strong>No misleading screenshot attached</strong><p>This finding is supported by header, network, runtime or structural evidence where a visual crop would not add reliable proof.</p></div>`}</section><section class="section"><h3>Evidence Record</h3>${evidenceRows.map(([k,v])=>`<div class="kv"><span>${esc(k)}</span><b>${esc(v||'—')}</b></div>`).join('')}<div class="insight" style="margin-top:9px"><b>Observed:</b> ${esc(i.evidence)}</div></section><section class="section full"><h3>Exact Element / Runtime Evidence</h3>${i.elementHtml?`<div class="evidence-code">${esc(i.elementHtml)}</div>`:''}${i.selector?`<div class="kv"><span>CSS selector</span><b class="mono">${esc(i.selector)}</b></div>`:''}${i.evidenceDetails&&Object.keys(i.evidenceDetails).length?`<details style="margin-top:9px"><summary>Structured evidence packet</summary><div class="evidence-code">${esc(JSON.stringify(i.evidenceDetails,null,2))}</div></details>`:''}${!i.elementHtml&&!i.selector?`<div class="evidence-code">${esc(JSON.stringify(i.evidenceDetails||{},null,2))}</div>`:''}</section><section class="section"><h3>Reproduce</h3><ol>${(i.reproductionSteps||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ol><div class="kv"><span>Expected</span><b>${esc(i.expected)}</b></div><div class="kv"><span>Actual</span><b>${esc(i.actual)}</b></div></section><section class="section"><div class="section-kicker">Developer Diagnosis</div><h3>Root-Cause Analysis</h3><p><b>What ARGUS can say:</b> ${esc(i.whyItMatters||'')}</p><p><b>Likely cause:</b> ${esc(i.likelyCause||'')}</p><div class="callout">${i.confidence==='Low'||i.status==='heuristic'?'Treat the root-cause explanation as a hypothesis until a developer reproduces it.':'The observation is confirmed; implementation-level cause can still require source/server inspection.'}</div></section><section class="section"><div class="section-kicker">Implementation</div><h3>Exact Fix Plan</h3>${(i.solutionSteps||[]).map((x,n)=>`<div class="fix-step"><i>${n+1}</i><p>${esc(x)}</p></div>`).join('')}<h3 style="margin-top:14px">Inspect these areas</h3><ul>${(i.filesToInspect||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section><section class="section"><div class="section-kicker">Code Guidance</div><h3>Suggested Patch Pattern</h3>${i.fixSnippet?`<div class="evidence-code">${esc(i.fixSnippet)}</div>`:'<div class="no-shot">No generic code patch is safe for this evidence. Follow the implementation steps and inspect the owning code.</div>'}<div class="callout">Suggested patch patterns require developer review; ARGUS does not pretend it knows unseen source files.</div></section><section class="section full"><div class="section-kicker">Definition of Fixed</div><h3>Verification / Retest</h3><ol>${(i.retest||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ol></section><section class="section full"><h3>AI Issue Investigation</h3><div class="ai-explain-note">AI explains this specific finding in plain developer language: what happened, what evidence proves it, likely cause vs hypothesis, exactly how to fix it, and how to verify the fix. It must not invent unseen source code.</div><div id="issueAiOutput" class="${ai?.enabled?'ai-box markdown':'callout'}">${ai?.enabled?markdown(ai.text):ai?.message?esc(ai.message):'Optional: ask ARGUS AI to explain this issue, its evidence, likely cause, exact fix steps, suggested patch pattern, and retest plan.'}</div></section></div></div>`;$('#issueAiBtn').onclick=()=>runIssueAi(i.id);}
async function runIssueAi(issueId){const btn=$('#issueAiBtn');btn.disabled=true;btn.textContent='Investigating…';try{state.issueAi[issueId]=await api(`/api/reports/${state.report.id}/issues/${issueId}/ai`,{method:'POST'});renderIssueDetail(issueId);if(!state.issueAi[issueId].enabled)toast(state.issueAi[issueId].message||'AI unavailable',true);}catch(e){toast(e.message,true);btn.disabled=false;btn.textContent='✦ Explain Issue & Fix';}}

function renderPages(){const r=state.report;$('#view').innerHTML=`<div class="view"><section class="card panel">${panelHead('Page Explorer',`${r.pages.length} checked · ${r.coverage?.deepTested||0} deep-tested`)}<div class="table-wrap"><table class="data-table"><thead><tr><th>Page</th><th>Status</th><th>Template</th><th>Depth</th><th>Issues</th><th>Load</th><th>Evidence</th></tr></thead><tbody>${r.pages.map(p=>`<tr><td class="url" title="${esc(p.url)}">${esc(p.url)}</td><td>${p.status||'ERR'}</td><td class="mono">${esc(p.templateId)}</td><td>${p.deepTested?'Deep':'Broad'}</td><td>${p.issues?.length||0}</td><td>${fmtMs(p.performance?.load)}</td><td>${(p.evidenceArtifacts||[]).length}</td></tr>`).join('')}</tbody></table></div></section></div>`;}
function renderJourneys(){const checks=state.report.pages.flatMap(p=>(p.interactionChecks||[]).map(x=>({...x,url:p.url})));$('#view').innerHTML=`<div class="view"><div class="grid two"><section class="card panel">${panelHead('Safe Interaction Testing','ARGUS avoids destructive/submit/payment/logout actions')}<div class="stat-row"><div class="stat"><span>Tested</span><b>${checks.length}</b></div><div class="stat"><span>Observable</span><b>${checks.filter(x=>x.outcome==='observable-change').length}</b></div><div class="stat high"><span>No effect</span><b>${checks.filter(x=>x.outcome==='no-observable-change').length}</b></div><div class="stat medium"><span>Errors</span><b>${checks.filter(x=>x.outcome==='error').length}</b></div></div></section><section class="card panel"><div class="insight">This is conservative automation: menus, tabs, toggles, accordions, filters and similar controls. ARGUS intentionally does not auto-submit destructive forms, payments, bookings, approvals, deletes or account actions.</div></section></div><div style="height:12px"></div><section class="card panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Page</th><th>Control</th><th>Selector</th><th>Outcome</th><th>Network</th><th>Error</th></tr></thead><tbody>${checks.map(x=>`<tr><td class="url">${esc(shortUrl(x.url))}</td><td>${esc(x.text||'—')}</td><td class="mono">${esc(x.selector||'—')}</td><td>${esc(x.outcome)}</td><td>${x.networkHits||0}</td><td>${esc(x.error||'')}</td></tr>`).join('')||'<tr><td colspan="6">No safe interactions were tested.</td></tr>'}</tbody></table></div></section></div>`;}
function renderNetwork(){const pages=state.report.pages;const errors=pages.flatMap(p=>(p.httpErrors||[]).map(x=>({...x,page:p.url})));const failed=pages.flatMap(p=>(p.failedRequests||[]).map(x=>({...x,page:p.url})));$('#view').innerHTML=`<div class="view"><div class="grid two"><section class="card panel">${panelHead('Runtime HTTP Errors',`${errors.length} observed responses`)}<div class="table-wrap"><table class="data-table"><thead><tr><th>Page</th><th>Status</th><th>Method</th><th>Request</th></tr></thead><tbody>${errors.slice(0,100).map(x=>`<tr><td class="url">${esc(shortUrl(x.page))}</td><td>${x.status}</td><td>${esc(x.method)}</td><td class="url">${esc(x.url)}</td></tr>`).join('')||'<tr><td colspan="4">No runtime HTTP errors in deep coverage.</td></tr>'}</tbody></table></div></section><section class="card panel">${panelHead('Failed Requests',`${failed.length} browser-level failures`)}<div class="table-wrap"><table class="data-table"><thead><tr><th>Page</th><th>Type</th><th>Request</th><th>Error</th></tr></thead><tbody>${failed.slice(0,100).map(x=>`<tr><td class="url">${esc(shortUrl(x.page))}</td><td>${esc(x.resourceType||'')}</td><td class="url">${esc(x.url)}</td><td>${esc(x.error)}</td></tr>`).join('')||'<tr><td colspan="4">No browser-level failed requests.</td></tr>'}</tbody></table></div></section></div><div style="height:12px"></div><section class="card panel">${panelHead('External Hosts','Third-party dependency surface')}<div class="host-list">${(state.report.externalHosts||[]).slice(0,60).map(x=>`<div class="host-row"><b>${esc(x.host)}</b><span>${x.resources} resources</span><span>${x.pageCount} pages</span></div>`).join('')}</div></section></div>`;}
function renderDynamic(){
  const r=state.report,d=r.dynamic||{},h=r.systemHealth||{configured:false,status:'not-configured',database:{state:'unknown'}};
  const findings=groupedIssues().filter(i=>['Dynamic','Database','Authentication','Infrastructure'].includes(i.category));
  const interactions=r.pages.flatMap(p=>(p.interactionChecks||[]).filter(x=>x.apiRequests?.length||x.dynamicBefore||x.dynamicAfter).map(x=>({...x,page:p.url})));
  const db=h.database||{state:'unknown'};
  const healthTone=db.state==='unhealthy'?'danger':db.state==='healthy'?'success':h.status==='unreachable'||h.status==='http-error'?'warning':'neutral';
  const healthLabel=!h.configured?'Not configured':db.state==='healthy'?'Database healthy':db.state==='unhealthy'?'Database unhealthy':h.status==='reachable'?'Health endpoint reachable':h.status==='unreachable'?'Health endpoint unreachable':h.status==='invalid-config'?'Health config invalid':'Health status unknown';
  $('#view').innerHTML=`<div class="view dynamic-view">
    <div class="grid three dynamic-stats">
      <section class="card panel"><div class="stat-row"><div class="stat"><span>API ↔ UI mismatch</span><b>${d.apiUiMismatch||0}</b></div><div class="stat"><span>Duplicate requests</span><b>${d.duplicateRequests||0}</b></div><div class="stat"><span>Stuck loaders</span><b>${d.stuckLoaders||0}</b></div><div class="stat"><span>Auth rejections</span><b>${d.authRejections||0}</b></div></div></section>
      <section class="card panel system-health-card">
        ${panelHead('System / DB Health','Safe same-origin health correlation')}
        <div class="health-state ${healthTone}"><i></i><div><strong>${esc(healthLabel)}</strong><span>${h.configured?esc(h.url||'Configured health endpoint'):'Enable ARGUS_HEALTH_PATH in .env to correlate backend/database health.'}</span></div></div>
        <div class="health-grid">
          <div><span>Application</span><b>${esc(h.application?.state||'unknown')}</b></div>
          <div><span>Database</span><b>${esc(db.state||'unknown')}</b></div>
          <div><span>DB latency</span><b>${db.responseMs!=null?fmtMs(db.responseMs):'—'}</b></div>
          <div><span>Probe latency</span><b>${h.responseMs!=null?fmtMs(h.responseMs):'—'}</b></div>
          <div><span>Provider</span><b>${esc(db.provider||'—')}</b></div>
          <div><span>Database</span><b>${esc(db.name||'—')}</b></div>
        </div>
        ${!h.configured?'<div class="callout">ARGUS never needs database credentials. Configure a safe same-origin GET health endpoint that reports only connection state and latency.</div>':h.error?`<div class="callout">${esc(h.error)}</div>`:''}
      </section>
      <section class="card panel">
        ${panelHead('Dynamic QA Coverage','Observed browser state transitions')}
        <div class="kv"><span>Dynamic findings</span><b>${findings.length}</b></div>
        <div class="kv"><span>Instrumented interactions</span><b>${interactions.length}</b></div>
        <div class="kv"><span>Pages deep-tested</span><b>${r.coverage?.deepTested||0}</b></div>
        <div class="kv"><span>DB findings</span><b>${d.database||0}</b></div>
        <div class="insight" style="margin-top:10px">ARGUS correlates DOM state + browser requests + interaction evidence. Database conclusions require explicit health evidence; a 500 alone is not labeled as a DB failure.</div>
      </section>
    </div>
    <div style="height:12px"></div>
    <div class="grid two">
      <section class="card panel">
        ${panelHead('Dynamic & Data Findings',findings.length?`${findings.length} unique finding${findings.length===1?'':'s'}`:'No dynamic/database findings')}
        <div class="triage-list">
          ${findings.map(i=>`<div class="triage-item" data-issue="${esc(i.id)}"><i class="sev-dot ${esc(i.severity)}"></i><div><strong>${esc(i.title)}</strong><small>${esc(shortUrl(i.url))} · ${i.occurrenceCount||1} observation${(i.occurrenceCount||1)===1?'':'s'} · ${esc(i.evidence||'')}</small></div>${sevBadge(i.severity)}</div>`).join('')||'<div class="empty">No evidence-backed dynamic or database finding in this scan.</div>'}
        </div>
      </section>
      <section class="card panel">
        ${panelHead('Interaction State Correlation',`${interactions.length} interaction sample${interactions.length===1?'':'s'} with dynamic/API evidence`)}
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Page</th><th>Control</th><th>Outcome</th><th>API calls</th><th>Before → After</th></tr></thead><tbody>
          ${interactions.slice(0,80).map(x=>`<tr><td class="url">${esc(shortUrl(x.page))}</td><td>${esc(x.text||x.selector||'—')}</td><td>${esc(x.outcome||'—')}</td><td>${x.apiRequests?.length||0}</td><td>${x.dynamicBefore&&x.dynamicAfter?`${x.dynamicBefore.bodyTextLength||0} → ${x.dynamicAfter.bodyTextLength||0} chars`:'—'}</td></tr>`).join('')||'<tr><td colspan="5">No instrumented dynamic interaction samples yet.</td></tr>'}
        </tbody></table></div>
      </section>
    </div>
  </div>`;
  $$('[data-issue]').forEach(x=>x.onclick=()=>{state.selectedIssue=x.dataset.issue;switchView('issues');});
}

function renderPerformance(){const deep=state.report.pages.filter(p=>p.performance);$('#view').innerHTML=`<div class="view"><section class="card panel">${panelHead('Browser Performance Samples','Use ChangeGuard for like-for-like comparison; these are navigation samples, not lab certification')}<div class="table-wrap"><table class="data-table"><thead><tr><th>Page</th><th>TTFB</th><th>DOMContentLoaded</th><th>Load</th><th>Transfer</th><th>Resources</th></tr></thead><tbody>${deep.sort((a,b)=>(b.performance?.load||0)-(a.performance?.load||0)).map(p=>`<tr><td class="url">${esc(p.url)}</td><td>${fmtMs(p.performance?.ttfb)}</td><td>${fmtMs(p.performance?.domContentLoaded)}</td><td>${fmtMs(p.performance?.load)}</td><td>${fmtBytes(p.performance?.resourceBytes)}</td><td>${p.performance?.resourceCount||0}</td></tr>`).join('')}</tbody></table></div></section></div>`;}
function renderAccessibility(){const iss=allIssues().filter(i=>i.category==='Accessibility'||i.category==='Responsive');$('#view').innerHTML=`<div class="view"><section class="card panel">${panelHead('Accessibility & Responsive Evidence',`${iss.length} findings`)}<div class="triage-list">${iss.map(i=>`<div class="triage-item" data-issue="${esc(i.id)}"><i class="sev-dot ${esc(i.severity)}"></i><div><strong>${esc(i.title)}</strong><small>${esc(shortUrl(i.url))} · ${esc(i.evidence)}</small></div>${sevBadge(i.severity)}</div>`).join('')||'<div class="empty">No sampled findings.</div>'}</div></section></div>`;$$('[data-issue]').forEach(x=>x.onclick=()=>{state.selectedIssue=x.dataset.issue;switchView('issues');});}
function renderChangeGuard(){const c=state.report.changeGuard||{};$('#view').innerHTML=`<div class="view"><div class="grid three"><section class="card panel"><div class="stat-row"><div class="stat"><span>Baseline</span><b>${c.available?'Yes':'No'}</b></div><div class="stat"><span>Issue delta</span><b>${c.delta?`${c.delta.issues>0?'+':''}${c.delta.issues}`:'—'}</b></div><div class="stat"><span>Score delta</span><b>${c.delta?`${c.delta.score>0?'+':''}${c.delta.score}`:'—'}</b></div><div class="stat"><span>Perf drift</span><b>${c.performanceRegressions?.length||0}</b></div></div></section><section class="card panel">${panelHead('New Findings')}<div class="triage-list">${(c.newIssues||[]).slice(0,12).map(i=>`<div class="triage-item"><i class="sev-dot ${esc(i.severity)}"></i><div><strong>${esc(i.title)}</strong><small>${esc(shortUrl(i.page||i.url))}</small></div></div>`).join('')||'<div class="empty">No new fingerprints.</div>'}</div></section><section class="card panel">${panelHead('Resolved Findings')}<div class="triage-list">${(c.resolvedIssues||[]).slice(0,12).map(i=>`<div class="triage-item"><i class="sev-dot low"></i><div><strong>${esc(i.title)}</strong><small>${esc(shortUrl(i.page||i.url))}</small></div></div>`).join('')||'<div class="empty">No resolved fingerprints.</div>'}</div></section></div>${!c.available?'<div style="height:12px"></div><div class="card empty">This is the baseline scan. Run ARGUS after your next deployment to see exact new/resolved issue fingerprints and performance drift.</div>':''}</div>`;}
function renderAI(){const a=state.globalAi;$('#view').innerHTML=`<div class="view"><section class="card panel" style="background:linear-gradient(135deg,#0a1730,#142d54);color:#fff"><div class="panel-head"><div><h3 style="font-size:18px">AI Root-Cause Investigator</h3><p style="color:#9cb5ce">On-demand only. ARGUS sends compact verified evidence, not the entire raw crawl.</p></div><button class="ai-action" id="runGlobalAi">${a?.enabled?'Re-run analysis':'✦ Analyze Report'}</button></div></section><div style="height:12px"></div><section class="card panel"><div class="markdown">${a?.enabled?markdown(a.text):a?.message?`<div class="callout">${esc(a.message)}</div>`:'<div class="empty">Deterministic investigation is already complete. Run AI only when you want cross-page prioritization and hypothesis synthesis.</div>'}</div></section></div>`;$('#runGlobalAi').onclick=runGlobalAi;}
async function runGlobalAi(){const b=$('#runGlobalAi');b.disabled=true;b.textContent='Analyzing…';try{state.globalAi=await api(`/api/reports/${state.report.id}/ai`,{method:'POST'});renderAI();if(!state.globalAi.enabled)toast(state.globalAi.message||'AI unavailable',true);}catch(e){toast(e.message,true);}}
async function deleteHistoryReport(id,event){
  event?.stopPropagation();
  const item=state.history.find(x=>x.id===id);
  if(!confirm(`Delete this ARGUS report?\n\n${item?.rootUrl||id}\n\nIts saved screenshots will also be removed.`))return;
  try{
    await api(`/api/history/${encodeURIComponent(id)}`,{method:'DELETE'});
    if(state.report?.id===id){state.report=null;state.selectedIssue=null;state.globalAi=null;state.issueAi={};}
    await renderHistory();
    toast('History report deleted.');
  }catch(e){toast(e.message,true);}
}
async function clearHistory(){
  if(!state.history.length)return;
  if(!confirm(`Delete all ${state.history.length} saved ARGUS reports and their screenshots? This cannot be undone.`))return;
  try{
    const result=await api('/api/history',{method:'DELETE'});
    state.report=null;state.selectedIssue=null;state.globalAi=null;state.issueAi={};
    await renderHistory();
    toast(`${result.removed||0} history report(s) deleted.`);
  }catch(e){toast(e.message,true);}
}
async function renderHistory(){
  await loadHistory();
  $('#welcome').classList.add('hidden');
  $('#workspace').classList.remove('hidden');
  const clearButton=state.history.length?'<button class="danger-action" id="clearHistoryBtn">Delete all</button>':'';
  $('#view').innerHTML=`<div class="view"><section class="card panel history-panel">${panelHead('Scan History',`${state.history.length} saved investigation${state.history.length===1?'':'s'}`,clearButton)}
    <div class="history-list">
      ${state.history.map(x=>`<article class="card history-item" data-report="${esc(x.id)}">
        <div class="history-main"><h4>${esc(x.rootUrl)}</h4><p>${fmtDate(x.scannedAt)} · ${esc(x.scanMode||'standard')} · ${x.coverage?.lightChecked||0} pages · ${x.uniqueFindingCount??x.issueCounts?.total??0} unique findings · ${x.issueCounts?.total||0} observations</p></div>
        <div class="history-actions"><div class="history-score">${x.score??'—'}</div><button class="history-delete" data-delete-report="${esc(x.id)}" title="Delete report">Delete</button></div>
      </article>`).join('')||'<div class="empty">No saved investigations yet.</div>'}
    </div>
  </section></div>`;
  $('#clearHistoryBtn')?.addEventListener('click',clearHistory);
  $$('[data-delete-report]').forEach(x=>x.onclick=e=>deleteHistoryReport(x.dataset.deleteReport,e));
  $$('[data-report]').forEach(x=>x.onclick=async e=>{
    if(e.target.closest('[data-delete-report]'))return;
    try{
      state.report=await api(`/api/reports/${x.dataset.report}`);
      state.globalAi=null;state.issueAi={};state.selectedIssue=null;state.view='overview';renderReport();
    }catch(err){toast(err.message,true);}
  });
}

function downloadHtml(){
  if(!state.report)return toast('Run or open a report first.',true);
  const r=state.report,findings=groupedIssues(),groups={};
  for(const i of findings)(groups[i.category||'Other']||(groups[i.category||'Other']=[])).push(i);
  const categoryHtml=Object.entries(groups).map(([category,items])=>`
    <section class="category">
      <h2>${esc(category)} <span>${items.length} unique finding${items.length===1?'':'s'}</span></h2>
      ${items.map(i=>`<article class="issue">
        <div class="issue-top"><div class="sev ${esc(i.severity)}">${esc(i.severity)} · ${esc(i.priority||'')} · ${esc(i.owner||'Review')}</div><div class="count">${i.occurrenceCount||1} observation${(i.occurrenceCount||1)===1?'':'s'} · ${(i.affectedPages||[]).length||1} page${((i.affectedPages||[]).length||1)===1?'':'s'}</div></div>
        <h3>${esc(i.title)}</h3>
        <div class="meta">Representative page: ${esc(i.url||'')}</div>
        ${(i.affectedPages||[]).length>1?`<details><summary>Affected pages</summary><ul>${i.affectedPages.slice(0,30).map(u=>`<li>${esc(u)}</li>`).join('')}</ul></details>`:''}
        ${i.artifacts?.[0]?`<div class="shot"><p><b>Representative visual evidence</b></p><img src="${location.origin}${esc(i.artifacts[0].url)}"></div>`:''}
        <p><b>Evidence:</b> ${esc(i.evidence||'')}</p>
        <p><b>Why it matters:</b> ${esc(i.whyItMatters||'')}</p>
        <p><b>Likely cause:</b> ${esc(i.likelyCause||'')}</p>
        <h4>Fix plan</h4><ol>${(i.solutionSteps||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ol>
        ${i.fixSnippet?`<pre>${esc(i.fixSnippet)}</pre>`:''}
        <h4>Retest</h4><ol>${(i.retest||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ol>
      </article>`).join('')}
    </section>`).join('');
  const html=`<!doctype html><meta charset="utf-8"><title>ARGUS Investigation - ${esc(r.rootUrl)}</title>
  <style>
    body{font:14px/1.55 Arial,sans-serif;max-width:1180px;margin:35px auto;color:#152a40;padding:0 22px}
    h1{margin-bottom:4px}.meta{color:#6c7f91;word-break:break-word}.metrics{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 28px}
    .metric{border:1px solid #ddd;padding:12px 16px;border-radius:8px;min-width:120px}.metric b{font-size:24px}
    .category{margin:30px 0}.category>h2{border-bottom:2px solid #dce6ef;padding-bottom:8px}.category>h2 span{font-size:12px;color:#6c7f91;font-weight:normal}
    .issue{border:1px solid #dce3ea;border-radius:9px;padding:16px;margin:14px 0}.issue-top{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
    .sev{text-transform:uppercase;font-weight:bold}.count{font-size:12px;color:#60758a}.critical{color:#c9273a}.high{color:#d4641b}.medium{color:#9b7410}.low{color:#176ac4}
    .shot img{max-width:520px;max-height:320px;border:1px solid #ddd}pre{background:#101b28;color:#d7e7f7;padding:12px;white-space:pre-wrap;border-radius:7px}li{margin:5px 0}details{margin:9px 0}
  </style>
  <h1>ARGUS QA Investigation</h1><div class="meta">${esc(r.rootUrl)} · ${esc(fmtDate(r.scannedAt))}</div>
  <div class="metrics"><div class="metric"><b>${r.score}</b><br>QA score</div><div class="metric"><b>${r.coverage?.lightChecked||0}</b><br>Pages</div><div class="metric"><b>${findings.length}</b><br>Unique findings</div><div class="metric"><b>${r.issueCounts?.total||0}</b><br>Observations</div></div>
  ${categoryHtml||'<p>No findings.</p>'}`;
  const blob=new Blob([html],{type:'text/html'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=`ARGUS-${new URL(r.rootUrl).hostname}-${r.id}.html`;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}

boot();
