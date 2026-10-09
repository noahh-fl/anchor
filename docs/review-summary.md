# Review summary

## What changed

- Split existing single-file Anchor into shell, styling, app logic and tested core utilities.
- Preserved finance, shifts, habits, tasks, lists, calendar and sharing features.
- Added accessible seven-destination mobile navigation, safe-area spacing, contrast/focus and reduced motion.
- Removed direct browser AI calls and browser key entry. AI now uses authenticated server requests, bounded account context, explicit AI/financial consent, strict schemas and usage reservation.
- Routed new record creation through a user-scoped, idempotent transaction, including related lists/items, habits/reminders and shifts/gas. Added visible read/save failures and retained forms.
- Added account-scoped synced preferences, explicit legacy settings import, recurrence display and an opt-in server-scheduled in-app reminder inbox.
- Added regression tests, isolated database fixture, backend documentation and deployment/review checklists.

## What is still required

Approval to publish the feature branch/draft PR; production schema/grants/RLS and public calendar sharing review; staging migration and real auth/API tests; secure server credentials and provider spending decisions; authorized HTTPS hosting and scheduler setup; real browser/mobile/assistive-tech QA.

The reminder inbox is implemented; phone push, email and SMS are not. Secure cloud hosting has a documented release path, but is not provisioned or live. The migration includes proposed policies affecting existing tables, so do not apply it blind.

## Validation

53 Node tests and 10 isolated PostgreSQL/WASM integration checks passed. Syntax and whitespace checks passed. Actual browser rendering was blocked by the environment's Chromium socket restrictions; production integration remains untested.

No production data, paid plans, live secrets, deployed functions, scheduler settings or remote repository state were changed.
