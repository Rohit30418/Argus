# Security and Authorized Use

ARGUS is intended for websites you own or are explicitly authorized to test.

- Private/local IP ranges are blocked by default.
- Automatic interaction testing is conservative and avoids destructive/payment/submit/logout/approval-style actions.
- ARGUS does not bypass authentication or attempt exploitation.
- API keys belong in `.env`, which is ignored by Git.
- Review generated fix patterns before applying them to production.
