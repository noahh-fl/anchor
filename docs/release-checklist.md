# Release checklist

## Review and stage first

1. Review the source diff and draft migration against a schema-only export of the existing project. The current repository originally contained no schema/migrations.
2. Verify existing column types, UUID keys, triggers, grants, indexes, enum/check constraints, and the public share-calendar RPC. The draft changes ownership policies on existing tables; review especially any legitimate sharing/admin workflows. Do not apply blind.
3. Back up production with a verified restore procedure. Apply the migration to a disposable staging clone first, never live as a first test.
4. Configure a staging static HTTPS origin and Supabase auth redirect allowlist. Configure Edge CORS to that exact origin.
5. Provision server-only provider/scheduler credentials through secure secret management. Never paste credentials into chat, frontend code, Git, or browser localStorage. Choose an approved model and provider spending cap.
6. Verify existing account login and signup, email confirmation, session expiration and sign-out on two accounts. Review account preferences and imported local settings for identity isolation.
7. Exercise cross-account RLS for each table and RPC with two real test users. Verify anonymous requests, expired JWTs, service-only quota and dispatch endpoints, invalid inputs, forged user IDs and malformed payloads are rejected.
8. Test interrupted save/response and simultaneous same-request retries: one transaction, one result, no duplicate shift/gas expense/list/habit reminder. Test conflicting payload with same request ID.
9. Test failed reads, offline save, recovery, slow double-click, modal Close/Cancel/Escape and account switching while requests are pending. No lost inputs or false success.
10. Test AI opt-in/off, separate financial consent, history bounds, quota limits, invalid model output, provider timeout, prompt injection in stored records, and answering versus proposing. Confirm no prompts/records are logged. Check context coverage warnings; AI has bounded context, not full historical knowledge.
11. Test monthly date skipping, daily/weekly recurrence, timezone changes and DST. Run the server scheduler and confirm in-app notifications are created once, including after a missed scheduler run. No push/email delivery claim.
12. Run browser checks in real Chromium/Safari at 320px, 390px, tablet and desktop. Check VoiceOver/keyboard, touch scrolling, all calendar modes, mobile keyboard and focus return. Current environment could not run browser rendering.

## Hosting

Any static HTTPS host can serve index.html and assets. No host account was created or selected. Add security headers in that host's native configuration:
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera=(), microphone=(), geolocation=()
- Content-Security-Policy: start in report-only, inventory the current Supabase CDN, Google Fonts, Supabase HTTPS/WebSocket, OpenStreetMap and OSRM requests, and inline event handlers. Move remaining inline handlers before enforcing script-src without unsafe-inline.

Pin/self-host the Supabase browser SDK before production and review its license. The original app currently uses a CDN major-version URL; the frontend does not require a build step yet. Don't claim a strict CSP or offline capability that isn't implemented.

## Release boundary

Remote branch/draft PR publication, production database/RLS changes, secret creation, billing, scheduler activation, and deployment require approval. Verify the approved exact commit after publishing. Keep a rollback frontend bundle and database restore plan; do not roll back by deleting user data or emptying new tables.

After authorized deployment, verify the actual live origin, health/auth path, safe test-account writes and reminders; monitor real errors and quotas. Only then call the release live.
