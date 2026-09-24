# ARGUS Pro Architecture

## Pipeline

1. **Target validation** — only HTTP/HTTPS public targets; private/local resolution is blocked by default.
2. **Discovery** — seed URL + sitemap indexes + same-origin links.
3. **Normalization** — strips tracking parameters, fragments, duplicate trailing slashes.
4. **Broad QA** — HTTP status, metadata, headings, images, forms, resources, basic security headers.
5. **Template/risk planning** — route patterns, forms, severity and important journey paths rank pages for deep investigation.
6. **Deep browser investigation** — Chromium captures console, failed requests, HTTP failures, runtime DOM, responsive behavior and conservative interactions.
7. **Issue evidence** — when an issue has a visual DOM target, ARGUS captures only the exact affected element with a red evidence outline.
8. **Solution engine** — deterministic owner, priority, reproduction, root-cause hypothesis, exact fix plan, patch pattern and retest checklist.
9. **Optional AI** — compact evidence packets only; per-report and per-issue deep dives.
10. **ChangeGuard** — compares issue fingerprints and sampled performance with the previous scan for the same host.

## Evidence policy

A screenshot is attached only when it actually helps prove the issue. Header, CSP, HTTP and network failures use header/network evidence rather than an unrelated viewport screenshot.

## Interaction safety

ARGUS targets low-risk UI interactions such as menus, tabs, accordions and filters. Text patterns associated with payments, submission, delete/remove, logout, approval, booking and similar state-changing actions are excluded from automatic clicking.
