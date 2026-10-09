# Verification record

Verified locally on 2026-10-08 against the implementation branch:

- 53 Node tests passed: 22 pure client contracts, 10 jsdom UI/data-flow tests, 21 backend request/output/security contract and mocked Edge handler checks.
- JavaScript syntax checks passed for assets/app.js and assets/core.js.
- git diff --check passed.
- Isolated PostgreSQL/WASM migration fixture: 10 integration checks passed, including full migration application, actual role-based ownership isolation, atomic rollback/idempotency, quota, recurrence/DST and reminder dispatch/opt-out. This uses a synthetic legacy schema, not production.
- Static HTML/CSS review: valid labels and ARIA references, no duplicate IDs, all seven navigation destinations, stylesheet parsing, and readable muted text contrast.

DOM tests use a fake authenticated Supabase client; all values are test data. They cover screen rendering, recurrence visibility, failed-save form preservation, stable request IDs on retries, duplicate-send suppression, read-only AI answers, failed-read preservation, modal Escape/inert cleanup, account reset, financial consent, manual entry contract mapping and preference saves.

## Not verified

- Actual browser rendering/screenshots, mobile keyboard, Safari/VoiceOver, physical devices. Playwright is available, but Chromium cannot create its required socket in the current environment, including the approved escalation attempt. The browser smoke script is retained for an environment that supports it.
- Existing production schema, grants, enum/check constraints, RLS or public share-calendar behavior.
- Live Supabase auth, migrations, real AI model responses/billing, deployed CORS or HTTPS hosting.
- Live scheduled notifications or any push/email/SMS delivery.

See docs/backend.md for the separate isolated database fixture results and their limits. A successful synthetic fixture is not evidence that the unknown production schema is migration-compatible.
