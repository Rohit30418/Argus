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

## Smart Form Tester (opt-in)

Enable **Smart form testing** before scanning to run native browser-validation checks on
public, non-sensitive forms. Form Tester appears as its own sidebar and report tab.

- Discovers forms on a capped selection of deep-scanned pages.
- Uses synthetic data to check required-empty, invalid email, invalid URL,
  minimum-length and number min/max browser constraints.
- Records passed, failed, skipped checks; failed native validation checks create
  evidence-backed findings with element screenshots when available.
- Opens a separate isolated tab, blocks non-GET/HEAD network calls and cross-origin
  navigation, **never submits a form**, and skips password/payment/authentication,
  upload and other sensitive workflows.
- Does not claim to verify submit-only JavaScript validation, database writes or
  server-side validation. Some JavaScript applications trigger GET requests from
  field events; only scan websites you are authorized to test.

The option is off by default. Deep scan coverage is capped (quick: 3 pages,
standard: 8, deep: 14, full: 24; a limited number of forms/scenarios per page).

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

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Rohit30418/Argus)


ARGUS includes a Dockerfile and Render Blueprint for Chromium-based production deployment.

- Runtime: Docker / Playwright Chromium
- Health check: `/healthz`
- Default Render port: `10000`
- Recommended first deployment: 1 concurrent scan
- AI secrets are not committed. Set `AI_API_KEY` and `AI_MODEL` in Render.
- Local Windows Chrome detection remains supported.

The Render filesystem is ephemeral unless a persistent disk or external storage is configured, so scan history/screenshots can reset after redeploys or restarts.
