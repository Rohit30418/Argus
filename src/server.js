import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScan, getReport, listReports, deleteReport, clearReports } from './scanner.js';
import { createAiAudit, createAiIssueAnalysis, getAiStatus } from './ai.js';

try { process.loadEnvFile?.('.env'); } catch { /* .env optional */ }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));
app.use('/artifacts', express.static(path.join(root, 'data'), { fallthrough: false, maxAge: '1h' }));
app.use(express.static(path.join(root, 'public')));

const PORT = Number(process.env.PORT || 4100);
const maxConcurrent = Math.max(1, Number(process.env.MAX_CONCURRENT_SCANS || 2));
let active = 0;
const jobs = new Map();

app.get('/api/status', async (req, res) => res.json({ ok:true, version:'3.0.0', activeScans:active, maxConcurrent, ai:getAiStatus(), healthProbeConfigured:Boolean(String(process.env.ARGUS_HEALTH_PATH||'').trim()), historyCount:(await listReports(500)).length }));
app.get('/api/history', async (req, res) => res.json({ items:await listReports(40) }));
app.delete('/api/history/:id', async (req,res)=>{try{const removed=await deleteReport(req.params.id);if(!removed)return res.status(404).json({error:'Report not found'});res.json({ok:true,id:req.params.id});}catch(error){res.status(500).json({error:error.message});}});
app.delete('/api/history', async (req,res)=>{try{const removed=await clearReports();res.json({ok:true,removed});}catch(error){res.status(500).json({error:error.message});}});
app.get('/api/reports/:id', async (req, res) => { const report=await getReport(req.params.id); if(!report)return res.status(404).json({error:'Report not found'}); res.json(report); });
app.get('/api/jobs/:id', (req,res)=>{const job=jobs.get(req.params.id);if(!job)return res.status(404).json({error:'Job not found'});res.json(job);});

app.post('/api/scans', async (req,res)=>{
  if(active>=maxConcurrent)return res.status(429).json({error:`ARGUS is already running ${active} scan(s). Try again shortly.`});
  const {url,mode='standard',options={}}=req.body||{}; if(!url)return res.status(400).json({error:'URL is required.'});
  const jobId=`job-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const job={id:jobId,status:'queued',progress:{stage:'queued',message:'Queued',done:0,total:1},reportId:null,error:null}; jobs.set(jobId,job); res.status(202).json(job);
  active++; job.status='running';
  runScan({url,mode,options},p=>{job.progress=p;})
    .then(report=>{job.status='completed';job.reportId=report.id;job.progress={stage:'done',message:'Investigation report ready',done:1,total:1,reportId:report.id};})
    .catch(error=>{job.status='failed';job.error=error.message;job.progress={stage:'failed',message:error.message,done:0,total:1};})
    .finally(()=>{active--;setTimeout(()=>jobs.delete(jobId),1000*60*60);});
});

app.post('/api/reports/:id/ai',async(req,res)=>{const report=await getReport(req.params.id);if(!report)return res.status(404).json({error:'Report not found'});try{res.json(await createAiAudit(report));}catch(error){res.status(500).json({error:error.message});}});
app.post('/api/reports/:id/issues/:issueId/ai',async(req,res)=>{const report=await getReport(req.params.id);if(!report)return res.status(404).json({error:'Report not found'});try{res.json(await createAiIssueAnalysis(report,req.params.issueId));}catch(error){res.status(500).json({error:error.message});}});
app.get('/api/reports/:id/export.json',async(req,res)=>{const report=await getReport(req.params.id);if(!report)return res.status(404).send('Not found');res.setHeader('content-disposition',`attachment; filename="ARGUS-${report.id}.json"`);res.type('json').send(JSON.stringify(report,null,2));});

app.use((req,res)=>res.sendFile(path.join(root,'public','index.html')));
app.listen(PORT,()=>console.log(`ARGUS Pro v3 running at http://localhost:${PORT}`));
