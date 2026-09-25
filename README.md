# ARGUS Pro v3

ARGUS is an evidence-first autonomous website QA investigator for authorized public-site testing.

## What makes v3 different

ARGUS does not stop at "issue found". Each deep finding can include:

- exact page and selector
- cropped issue-level screenshot (affected element only)
- DOM/runtime evidence packet
- confirmed observation vs heuristic/hypothesis
- reproduction steps
- expected vs actual result
- likely owner (frontend/backend/content/infrastructure)
- ordered implementation plan
- suggested patch pattern (developer review required)
- verification/retest checklist
- on-demand AI deep dive for one issue
- ChangeGuard comparison on the next scan

Page-level findings such as CSP/header or HTTP failures do **not** receive a misleading visual screenshot; ARGUS shows the relevant header/network evidence instead.

## Smart coverage

ARGUS discovers many URLs, broadly checks a larger set, groups route templates, then promotes risky/representative pages to deep browser investigation. This avoids running expensive interaction/mobile investigation on hundreds of duplicate template pages.

Default scan modes:

| Mode | Discover | Broad QA | Deep investigate |
|---|---:|---:|---:|
| Quick | 100 | 35 | 8 |
| Standard | 500 | 140 | 30 |
| Deep | 1,600 | 450 | 90 |
| Full | 5,000 | 1,200 | 220 |

Environment ceilings can reduce these numbers.

## Run on Windows

```powershell
npm install
copy .env.example .env
npm run dev
```

Open `http://localhost:4100`.

ARGUS uses installed Chrome when available. You may set:

```env
ARGUS_BROWSER_EXECUTABLE=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe
```

## Z.ai

Fill these in `.env`:

```env
AI_PROVIDER=zai
AI_BASE_URL=https://api.z.ai/api/paas/v4
AI_ENDPOINT=/chat/completions
AI_API_STYLE=chat
AI_API_KEY=YOUR_KEY
AI_MODEL=YOUR_AVAILABLE_ZAI_MODEL
```

AI is optional. Crawling, browser evidence, screenshots, deterministic fix plans and ChangeGuard work without AI.

## Safety model

ARGUS is designed for websites you own or are authorized to test. It blocks private/local targets by default and conservative interaction testing avoids destructive/payment/submit/delete/logout/approval-style actions.


## Deploy on Render

ARGUS includes a Dockerfile and Render Blueprint for Chromium-based production deployment.

- Runtime: Docker / Playwright Chromium
- Health check: `/healthz`
- Default Render port: `10000`
- Recommended first deployment: 1 concurrent scan
- AI secrets are not committed. Set `AI_API_KEY` and `AI_MODEL` in Render.
- Local Windows Chrome detection remains supported.

The Render filesystem is ephemeral unless a persistent disk or external storage is configured, so scan history/screenshots can reset after redeploys or restarts.
