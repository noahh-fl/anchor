# Anchor

A personal dashboard for money, work shifts, tasks, habits, and calendar reminders.
This upgrade preserves the existing Supabase-backed app and splits its assets into reviewable modules.

## Current status

Implementation branch only. **Not deployed, not production-verified.** Existing production data has not been migrated or changed.

- Responsive mobile navigation includes all seven sections; zoom, keyboard focus, labels, and reduced motion are supported.
- Reads fail visibly without replacing known records with empty arrays. Save forms retain their input on errors.
- New entries use a transaction and a stable request ID so a failed response can be retried without duplicate records.
- AI runs behind an authenticated Edge Function. No provider key is read or transmitted by the browser. Old keys can be explicitly removed from the device.
- AI can answer questions from bounded account-scoped records or propose an entry. The user confirms every new entry. AI data use is opt-in; financial context has a separate opt-in.
- Preferences are account-scoped and atomically merged in Supabase. Legacy device settings are imported only with explicit confirmation.
- Daily, weekly and monthly reminders appear on the calendar. A server scheduler creates an in-app reminder inbox while the app is closed. **Phone push, email, and SMS are not connected.**

## Files

- `index.html`, `assets/app.css`: app shell and presentation
- `assets/app.js`: auth, views and interactions
- `assets/core.js`: pure validation, time and recurrence logic
- `supabase/functions/`: authenticated AI and private reminder dispatcher
- `supabase/migrations/`: draft transactional migration requiring schema/RLS review
- `tests/`: Node core, DOM integration and backend contracts; optional browser smoke test

## Local checks

Use Node 24 or later.

```sh
npm ci
npm test
npm run check
python3 -m http.server 8080 --bind 127.0.0.1
```

Opening the app normally connects to the configured Supabase project. Use a separate staging project and test accounts for integration testing. The automated DOM tests mock Supabase and do not send user data or invoke AI providers.

For visual/browser smoke checks, install Playwright from its official npm package and its matching Chromium, or set `CHROMIUM_PATH` to an installed Chromium. Then run `node tests/ui-smoke.cjs`. This test blocks external requests and uses fake data. It checks desktop/mobile overflow and captures screenshots. Chromium could not launch in the current build environment because OS socket creation is restricted; these browser checks have **not passed** here.

## Before deploying

Read [backend setup and review](docs/backend.md) and [release checklist](docs/release-checklist.md). Frontend and backend contracts must ship together. Deploying the frontend alone will show a clear setup/load error rather than fall back to insecure AI or non-atomic saves.

No paid service, secret provisioning, production migration, deployment, remote push, or PR is included in this implementation. These are separate approval steps.
