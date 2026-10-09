# Anchor backend upgrade: review and deployment handoff

## Status and boundaries

This directory contains implementation and a **not-applied draft migration**. No production database was inspected or changed, no secrets were created, no function was deployed, and no scheduler was enabled. The app's existing JavaScript was the schema reference. Applying this migration or enabling third-party AI transmission is a separate operator decision.

The migration preserves existing records. It adds account preferences, an idempotency ledger, quota accounting, a private reminder queue, and an in-app notification outbox. It also drafts ownership RLS policies on existing tables. Those policies can change access behavior, so they require explicit review, including the shared-calendar flows, before application.

## Browser contracts

### Account preferences

Read the signed-in user's `account_preferences` row by `user_id`. A missing row means defaults; a failed read must remain an error rather than being treated as defaults.

Call `anchor_patch_preferences({p_patch})`; response is the merged settings JSON object. The database atomically merges top-level keys so unrelated changes from different devices survive. Updates to the same key use last-write-wins. The browser should serialize its local preference writes and show failure/retry status.

Allowed keys:

- `work_types`, `vehicles`, `work_locations`: arrays, at most 100 elements each
- `home_address`: string, at most 1,000 characters
- `gas_price`: nonnegative number, at most 1,000
- `timezone`: valid PostgreSQL IANA timezone name, default UTC
- `ai_enabled`, `finance_ai_opt_in`, `reminders_enabled`: explicit booleans, default false

List entries must be objects with a nonempty name and only the relevant fields: work types use name/rate/color; vehicles use name/type/mpg/color/def; work locations use name/addr/oneWay/def. Colors must be six-digit hex, optional numbers must be bounded and nonnegative, and default flags must be booleans. Unknown fields and primitive list entries are rejected. Settings are capped at 40 KB. Neither home/work addresses nor vehicle details are included automatically in AI context. Enabling AI should disclose the selected provider and the exact record categories being sent. Finance context requires both the account opt-in and the request flag; an unchecked flag cannot be overridden by client-supplied context. User-written financial details in the current message/history are, naturally, still part of that message.

### Authenticated AI

Invoke Supabase Edge Function `anchor-ai` using the signed-in session, JSON body:

```json
{"message":"What is coming up this week?","history":[{"role":"user","text":"Earlier message"}],"include_finances":false}
```

Limits: latest message 4,000 characters; up to eight prior user/assistant messages, each at most 2,000 characters, aggregate history at most 8,000; streamed request body at most 18,000 bytes. No system prompt, provider key, model choice, user ID, URLs, or record context may be supplied by the browser. The server owns the prompt and model configuration.

Response has the existing parser fields `detected_type`, `confidence`, `needs_more`, `questions`, `reply`, `summary_title`, `data`, plus `mode` (`answer` or `proposal`) and `context` coverage metadata. Answer mode strips proposal data and must never show a save action. Proposal mode only previews creation. No AI-generated updates/deletes, external messages, calendar sharing, payments, or automatic writes are possible through this endpoint. The user must confirm the entry before invoking the save RPC.

The server validates JWTs with Supabase Auth, rejects anonymous users, and queries records using the caller's JWT and explicit ownership filters. It loads at most 60 rows per category, then applies per-category byte budgets and field/string limits:

- Open tasks, habits, list titles, and incomplete list items
- Calendar/reminder records from 30 days ago through 90 days ahead, including older daily/weekly/monthly recurring records
- Work schedule dates/type/start/end, without wage or tip fields
- Only with finance opt-in: finance entries and shift pay from 30 days ago through today

Coverage and truncation accompany every response. Finance totals are deterministic and cover only the retained records, not an all-time balance or complete account. Queries outside coverage should be answered with the limitation. Notes/titles remain untrusted context, never system instructions. This is useful organization assistance, not a substitute for financial advice.

Provider is fixed to `https://api.openai.com/v1/responses`. Requests use structured JSON schema, server validation, `store:false`, no tools, a 2,000-token output cap and a 25-second timeout. `store:false` is not a claim of zero retention; the operator must review provider data controls and applicable terms. Prompts, tokens and model responses are not logged in usage accounting. Errors return safe descriptions, never provider error bodies or credentials.

A service-only RPC atomically reserves per-account usage before the provider call: 10 requests per UTC minute, 100 requests per UTC day, and 600,000 conservatively reserved tokens per UTC day. Input UTF-8 byte size plus schema/instructions and output allowance is deliberately an upper estimate; reservations are not refunded on failed requests. No automatic provider retry duplicates costs. Configure a provider-side project spend limit and operational alerts too; per-account quota does not cap aggregate signups or project spend.

HTTP outcomes: 400 invalid input; 401 sign-in required; 403 AI opt-in/origin denied; 413 too large; 429 quota/provider busy; 502 invalid/unavailable provider response; 503 account/configuration/backend unavailable. These errors must not clear existing UI data or silently switch to browser provider keys.

### Atomic entry creation

Call:

```js
sb.rpc('anchor_save_entry', {
  p_request_id: crypto.randomUUID(),
  p_entry: {
    detected_type: 'todo_list',
    data: {title: 'Groceries', priority: 'Medium', items: ['Milk', 'Eggs']},
    original_text: 'Create a grocery list with milk and eggs'
  }
})
```

Create one request UUID per confirmed card/form and retain it for retries after uncertain delivery. The same UUID and identical payload returns the original IDs with `replayed:true`. A changed payload under that UUID is rejected. For an intentionally edited or new entry, use a new UUID. Responses are `{request_id, records:[{table,id}], replayed}`.

Supported types match the app: work_shift, expense, income, todo_task, todo_list, shopping_list, habit, workout_routine, calendar_event, reminder, note. Required dates must be real `YYYY-MM-DD` values. Tasks/lists/events/reminders/notes require a title; habits require a name. Finance amounts and worked hours must be positive; a zero hourly rate is valid. Time input accepts PostgreSQL time parsing (the AI emits `HH:MM`). Computed shift fields from the browser are ignored and recomputed server-side. Current CRUD edits remain separate RLS-protected single-row operations; this RPC creates entries only.

The whole call is one transaction: chat audit + shift + optional gas expense, list + items, or habit + linked reminder all commit or all roll back. Original text is optional; omitted or blank text does not create an empty chat audit record. A manual compound form uses this same RPC with no `original_text`.

Optional confirmed commute shape is `{cost,miles,mpg,veh:{name},trip}`. The server validates a bounded nonnegative estimate and stores the explicitly confirmed cost; no address is sent to a routing service. This backend does not recompute a gas price absent from the confirmed payload and does not pretend estimates are measured costs.

The ledger stores the submitted payload to detect changed retries and persists for the account lifetime; it is private and deleted on account deletion. Any future ledger retention cleanup must explicitly define an idempotency expiration window before deleting rows.

## Reminder delivery design

`reminders_enabled` is off by default. Turning it on schedules eligible existing reminders for their next future occurrence. Turning it off disables pending jobs. A missing time, unsupported Custom recurrence, or already-expired one-shot is not dispatched. Habit reminders stop when their linked habit no longer exists or its end date passes.

Scheduling uses local wall-clock date/time plus the account's IANA zone. Daily/weekly advances use calendar dates, not fixed 24-hour intervals. Monthly retains the original day-of-month and skips a month without that day. PostgreSQL's timezone resolution moves nonexistent spring-forward times forward by the gap and chooses the standard-time occurrence in a fall-back fold. Account timezone changes recompute future jobs; the history of already delivered occurrences is retained.

A server scheduler calls `reminder-dispatcher` every minute, after explicit deployment authorization. Its only accepted action is dispatching the next bounded batch. Authentication uses `x-anchor-dispatch-secret`, stored only in the scheduler/Edge Function. No request body, recipient, external URL or provider payload is accepted. Do not put this secret into a browser or committed cron SQL.

The SQL dispatcher locks at most 100 due jobs with `FOR UPDATE SKIP LOCKED`. In the same transaction it creates an `anchor_notifications` row and advances the job. The unique `(reminder_id,scheduled_for)` key prevents duplicate occurrences even after an uncertain response/retry. One occurrence up to 24 hours late can be delivered; older missed occurrences are skipped and advanced, preventing a notification storm. Failed transactions keep the jobs due for retry. Monitor oldest due job, delivery counts and repeated failures; alert before the queue exceeds the acceptable delay.

This is an **in-app outbox/inbox**, not phone push, browser push, email, SMS, or operating-system notifications. Reading new rows requires opening/refreshing the app unless a separate subscription is implemented. In-app rows expose id, reminder_id, scheduled_for, title, body, read_at and created_at to their owner. Only read_at may be updated by the client. Outbox title/body are rendered as text.

External delivery would require a separately reviewed adapter, fixed allowlisted provider endpoint, user opt-in to that channel, verified destination, bounded payload, encrypted endpoint/subscription storage, exponential retries/dead-letter state, and idempotency. Never accept arbitrary browser-supplied outgoing URLs; that would create an SSRF and data-exfiltration path. None of those external sends are enabled here.

## Security and migration review checklist

1. Export the real schema and a backup. Compare every referenced column/type/default/constraint, especially UUID IDs, numeric finance columns, time columns, `habits.end_date`, and profile defaults, against the fixture. The preflight only verifies required tables and UUID ownership IDs; it is not a complete schema audit.
2. Confirm default privileges and table/column grants. New preferences and notification tables explicitly revoke PUBLIC/anon/authenticated privileges before granting the intended minimum. Existing tables require a grant review: row ownership alone does not prevent a user changing an `is_admin`/role/privileged column on their own profile. Restrict profile INSERT/UPDATE to approved columns or use narrowly scoped RPCs, and inspect every existing privileged trigger/function before release.
3. Review drafted ownership policies on profiles, entries, tasks, lists, finances, shifts, habits, reminders and calendar_shares. They add both self-access and a restrictive ownership boundary; existing policies are retained. Check intentional collaborative/shared access is not broken. Existing service-role/SECURITY DEFINER functions bypass RLS and require a separate audit. In particular, shared-calendar token entropy, expiry, revocation, field disclosure, rate limits and function grants are not solved by this migration.
4. Verify child/parent ownership constraints on legacy todo_list_items and habit_completions. This new RPC creates only owned parents/children, but direct legacy CRUD must not be able to link a child to another user's parent. Review foreign-key/trigger checks on a staging clone.
5. Run all app/contract tests and the optional PostgreSQL fixture checks below. Then run equivalent tests on staging with the real schema, two separate user JWTs, unauthenticated requests, and a service-role worker.
6. Verify that service-only functions are not executable by anon/authenticated and that internal schemas are not exposed through PostgREST. Security-definer functions have an empty search_path and qualified objects.
7. Apply the reviewed migration as one transaction. It is intentionally a once-only versioned migration, not an ad hoc rerunnable setup script. No automatic down migration is supplied because dropping preferences/outbox/ledger would lose data; restore from the approved backup/forward-fix plan if needed.
8. Configure server-only secrets from `supabase/.env.example`. Set exact allowed browser origins, including scheme and port, and a chosen model supporting Responses structured output. Never enable wildcard CORS, copy provider secrets into the app, or commit secret values.
9. Deploy authenticated `anchor-ai`; keep gateway JWT verification enabled and the in-function Auth check. Deploy the dispatcher with gateway JWT verification off only because it separately validates a high-entropy scheduler secret. Schedule only after verifying the protected endpoint and consent flows. The migration deliberately enables no scheduler.
10. Test signed-out access, cross-account sessions, interrupted saves, duplicate clicks, same-ID/different-payload rejects, forced compound-write rollback, preference merging, quota exhaustion, no-consent requests, provider timeout, injection-like record text, DST folds/gaps, monthly day 31, late jobs, concurrent dispatch, notification acknowledgment and opt-out.

## Verification commands

```sh
npm test
npm run check
# Optional isolated PostgreSQL/WASM fixture (no live credentials or network services):
npm install --prefix /tmp/anchor-dbtest --cache /tmp/anchor-npm-cache --no-audit --no-fund @electric-sql/pglite@0.3.14
PGLITE_MODULE=/tmp/anchor-dbtest/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/database.integration.mjs
```

Verification completed locally: 21 backend contract/mocked Edge handler tests passed, and 10 PostgreSQL/WASM fixture checks passed, including migration application, atomic rollback/idempotency, real role RLS, quota, timezone recurrence and outbox dispatch.

The fixture recreates a synthetic legacy schema and tests the complete migration plus RPCs, RLS and recurrence in isolated memory. It does not establish compatibility with an unseen production schema or validate hosted Edge/CORS/cron/provider behavior. Deno deployment/type checks and hosted end-to-end tests remain operator acceptance checks if that runtime is unavailable locally.

## Implementation references

- [Supabase authenticated Edge Functions](https://supabase.com/docs/guides/functions/auth-legacy-jwt)
- [Supabase getUser validation](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Supabase database function security](https://supabase.com/docs/guides/database/functions)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
