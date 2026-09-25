function num(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function providerConfig() {
  const baseUrl = String(process.env.AI_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = String(process.env.AI_API_KEY || '').trim();
  const model = String(process.env.AI_MODEL || '').trim();
  const apiStyle = String(process.env.AI_API_STYLE || 'chat').trim().toLowerCase();
  const endpoint = String(process.env.AI_ENDPOINT || (apiStyle === 'responses' ? '/responses' : '/chat/completions')).trim();
  const authType = String(process.env.AI_AUTH_TYPE || 'bearer').trim().toLowerCase();
  const requireKey = String(process.env.AI_REQUIRE_KEY || 'true').toLowerCase() !== 'false';
  if (!baseUrl || !model || (requireKey && !apiKey)) return null;
  return { provider: process.env.AI_PROVIDER || 'custom', baseUrl, endpoint, apiKey, model, apiStyle, authType, temperature: num('AI_TEMPERATURE', 0.15), maxTokens: num('AI_MAX_TOKENS', 3600), timeout: num('AI_TIMEOUT', 120000) };
}

function headers(config) {
  const out = { 'content-type': 'application/json' };
  if (config.apiKey) {
    if (config.authType === 'x-api-key') out['x-api-key'] = config.apiKey;
    else if (config.authType === 'api-key') out['api-key'] = config.apiKey;
    else if (config.authType !== 'none') out.authorization = `Bearer ${config.apiKey}`;
  }
  if (process.env.AI_EXTRA_HEADERS) {
    try { Object.assign(out, JSON.parse(process.env.AI_EXTRA_HEADERS)); } catch { /* optional */ }
  }
  return out;
}

function body(config, prompt, maxTokens = config.maxTokens) {
  if (config.apiStyle === 'responses') return { model: config.model, input: prompt, max_output_tokens: maxTokens };
  return {
    model: config.model,
    messages: [
      { role: 'system', content: 'You are ARGUS, an evidence-bound senior web QA investigator and developer-facing debugging assistant. Explain what is wrong, why the evidence supports it, how a developer should fix it, and how to verify the fix. Never invent observations, source filenames, line numbers, API payloads, causes, user impact, or tests that are not supported by supplied evidence.' },
      { role: 'user', content: prompt }
    ],
    temperature: config.temperature,
    max_tokens: maxTokens
  };
}

function outputText(json) {
  const chat = json?.choices?.[0]?.message?.content;
  if (typeof chat === 'string') return chat.trim();
  if (Array.isArray(chat)) return chat.map(x => x?.text || x?.content || '').filter(Boolean).join('\n').trim();
  if (typeof json?.output_text === 'string') return json.output_text.trim();
  const parts = [];
  for (const item of json?.output || []) for (const c of item?.content || []) if (c?.type === 'output_text' && c.text) parts.push(c.text);
  if (parts.length) return parts.join('\n').trim();
  if (typeof json?.message?.content === 'string') return json.message.content.trim();
  if (typeof json?.response === 'string') return json.response.trim();
  if (typeof json?.text === 'string') return json.text.trim();
  return '';
}

async function call(config, prompt, maxTokens) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.timeout);
  try {
    const response = await fetch(`${config.baseUrl}${config.endpoint}`, { method:'POST', headers:headers(config), body:JSON.stringify(body(config,prompt,maxTokens)), signal:controller.signal });
    const raw = await response.text(); let json;
    try { json = JSON.parse(raw); } catch { throw new Error(`AI API returned non-JSON: ${raw.slice(0,240)}`); }
    if (!response.ok) throw new Error(json?.error?.message || json?.message || `AI request failed with HTTP ${response.status}`);
    const text = outputText(json); if (!text) throw new Error('AI provider responded but no text output was found.');
    return text;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('AI request timed out.');
    throw error;
  } finally { clearTimeout(timer); }
}

function rankedPages(report) {
  return [...(report.pages||[])].map(p=>({p,score:(p.issues||[]).reduce((n,i)=>n+({critical:10,high:6,medium:2,low:1}[i.severity]||1),0)+(p.httpErrors?.length||0)*4+(p.consoleErrors?.length||0)*3})).sort((a,b)=>b.score-a.score).slice(0,20).map(x=>x.p);
}

function compactReport(report) {
  let grouped=report.groupedFindings?.findings||[];
  if(!grouped.length){
    const map=new Map();
    for(const p of report.pages||[])for(const i of p.issues||[]){
      const key=`${String(i.category||'Other').toLowerCase()}|${String(i.title||'Untitled').toLowerCase().replace(/\s+/g,' ').trim()}`;
      const g=map.get(key)||{category:i.category||'Other',title:i.title,severity:i.severity,priority:i.priority,owner:i.owner,confidence:i.confidence,occurrenceCount:0,affectedPages:[],templates:[],evidence:i.evidence,whyItMatters:i.whyItMatters,likelyCause:i.likelyCause,solutionSteps:i.solutionSteps,retest:i.retest};
      g.occurrenceCount++;
      if(p.url&&!g.affectedPages.includes(p.url))g.affectedPages.push(p.url);
      if(p.templateId&&!g.templates.includes(p.templateId))g.templates.push(p.templateId);
      map.set(key,g);
    }
    grouped=[...map.values()];
  }
  return {
    rootUrl:report.rootUrl,
    scannedAt:report.scannedAt,
    scanMode:report.scanMode,
    coverage:report.coverage,
    issueCounts:report.issueCounts,
    uniqueFindingCount:report.uniqueFindingCount??grouped.length,
    score:report.score,
    investigation:report.investigation,
    dynamic:report.dynamic,
    systemHealth:report.systemHealth,
    technologies:report.technologies,
    externalHosts:(report.externalHosts||[]).slice(0,25),
    groupedFindings:grouped.slice(0,80).map(g=>({
      category:g.category,title:g.title,severity:g.severity,priority:g.priority,owner:g.owner,confidence:g.confidence,
      occurrenceCount:g.occurrenceCount,affectedPages:(g.affectedPages||[]).slice(0,20),templates:(g.templates||[]).slice(0,10),
      evidence:g.evidence,whyItMatters:g.whyItMatters,likelyCause:g.likelyCause,solutionSteps:g.solutionSteps,retest:g.retest
    })),
    systemicPatterns:(report.systemicPatterns||[]).slice(0,20),
    changeGuard:report.changeGuard,
    pages:rankedPages(report).map(p=>({
      url:p.url,status:p.status,templateId:p.templateId,performance:p.performance,mobileAudit:p.mobileAudit,
      consoleErrors:(p.consoleErrors||[]).slice(0,5),
      failedRequests:(p.failedRequests||[]).slice(0,5),
      httpErrors:(p.httpErrors||[]).slice(0,6),
      interactionChecks:(p.interactionChecks||[]).slice(0,8)
    }))
  };
}

function reportPrompt(report) {
  return `Analyze ONLY this ARGUS scan evidence. Distinguish CONFIRMED OBSERVATION from HYPOTHESIS. Do not claim source-code causes unless evidence proves them. Prefer systemic/template fixes when repeated evidence supports that conclusion.\n\nReturn Markdown with exactly these sections:\n# Executive QA Brief\n## Fix First\n## Issue-by-Issue Explanation\n## Cross-Page / Template Root Causes\n## Responsive & Accessibility Findings\n## Runtime / Network Findings\n## ChangeGuard Regression Summary\n## Website DNA & Dependency Risks\n## Recommended Manual Journeys\n## Retest Checklist\n\nFor every Critical and High issue, and the most important Medium issues, include: Issue, Page(s), Evidence, Plain-English explanation, what is CONFIRMED, Likely cause explicitly labeled HYPOTHESIS when not proven, Why it matters, Exact fix steps in implementation order, Suggested patch — developer review required when evidence supports one, Owner, Confidence, and Retest steps. Do not give generic advice such as 'optimize performance' or 'fix accessibility'. Tell the developer what to inspect and what change to make based on supplied evidence.\n\nEVIDENCE:\n${JSON.stringify(compactReport(report))}`;
}
function issuePrompt(report, page, issue) {
  const packet={site:report.rootUrl,scanMode:report.scanMode,page:{url:page.url,status:page.status,title:page.title,templateId:page.templateId,performance:page.performance,mobileAudit:page.mobileAudit},issue,consoleErrors:(page.consoleErrors||[]).slice(0,10),failedRequests:(page.failedRequests||[]).slice(0,10),httpErrors:(page.httpErrors||[]).slice(0,12),interactionChecks:(page.interactionChecks||[]).slice(0,12),network:(page.network||[]).filter(x=>x.status>=400).slice(0,15),systemicMatches:(report.systemicPatterns||[]).filter(x=>x.title===issue.title).slice(0,5)};
  return `Investigate ONE ARGUS issue using ONLY the evidence packet below. Be detailed but evidence-bound. Never invent a filename, line number, API payload, source-code cause, or user impact that was not observed. If the exact root cause is not proven, explicitly label it HYPOTHESIS and give the developer checks needed to confirm it.\n\nReturn Markdown with exactly:\n# Issue Investigation\n## Issue in Plain English\n## Evidence ARGUS Confirmed\n## Why This Matters\n## Reproduction\n## Likely Root Cause\n## How To Fix It\n## Suggested Patch — Developer Review Required\n## Verification / Retest\n## Confidence & Unknowns\n\nRequirements:\n- Issue in Plain English: explain the problem in 2–4 clear sentences a developer can understand immediately.\n- Evidence ARGUS Confirmed: cite only supplied page, selector, DOM, console, network, interaction, viewport or timing evidence.\n- Likely Root Cause: separate CONFIRMED facts from HYPOTHESIS. Never present a hypothesis as proven.\n- How To Fix It: give numbered concrete implementation steps in the order a developer should perform them.\n- For frontend issues, explain what element/component/layout/handler to inspect using available selector/DOM evidence.\n- For network/backend issues, explain what request/endpoint/status/log path to inspect without inventing payloads, filenames or line numbers.\n- Suggested Patch may contain a small generic code/config example only when it follows directly from evidence; otherwise state that a safe patch cannot be generated from current evidence.\n- Verification / Retest: explain how to prove the fix using the same page, viewport, selector, interaction or request.\n- Use a detected technology only when the evidence packet supports it.\n\nEVIDENCE PACKET:\n${JSON.stringify(packet)}`;
}
export function getAiStatus() {
  const c=providerConfig();
  return c?{configured:true,provider:c.provider,model:c.model,baseUrl:c.baseUrl,apiStyle:c.apiStyle}:{configured:false,provider:process.env.AI_PROVIDER||null,model:process.env.AI_MODEL||null};
}

export async function createAiAudit(report) {
  const config=providerConfig(); if(!config)return{enabled:false,message:'AI is not configured. Add AI_BASE_URL, AI_MODEL and AI_API_KEY (when required). Deterministic ARGUS investigation still works.'};
  try{return{enabled:true,provider:config.provider,model:config.model,text:await call(config,reportPrompt(report),config.maxTokens)}}catch(error){return{enabled:false,provider:config.provider,model:config.model,message:`AI analysis failed: ${error.message}`};}
}

export async function createAiIssueAnalysis(report, issueId) {
  const config=providerConfig(); if(!config)return{enabled:false,message:'AI is not configured.'};
  let page=null,found=null;
  for(const p of report.pages||[]){const i=(p.issues||[]).find(x=>x.id===issueId);if(i){page=p;found=i;break;}}
  if(!found)return{enabled:false,message:'Issue not found in this report.'};
  try{return{enabled:true,provider:config.provider,model:config.model,issueId,text:await call(config,issuePrompt(report,page,found),Math.min(config.maxTokens,2800))}}catch(error){return{enabled:false,provider:config.provider,model:config.model,issueId,message:`AI issue investigation failed: ${error.message}`};}
}
