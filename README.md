# IFVG Trading Journal

Existing teal layout, private user journals, offline cache and revision-checked cloud sync for phone and desktop. No build step; serve these files over HTTPS.

## Account deletion and session choice (3.1.0)

Account detail has a confirmed delete action. It removes that account, its trades
and embedded payouts; other accounts and free-form daily/weekly reviews remain.
Individual trades can also be deleted directly from their detail dialog.
The existing revision-checked cloud merge propagates these deletions to other
devices and prevents stale offline copies from resurrecting deleted accounts.

Trade entry/editing offers automatic session classification or explicit London
Opening (09:00–10:00), New York Opening (15:30–17:00), Late Night Rush Hour
(21:00–22:00) and outside-session selection. Times are Europe/Berlin. Windows
include their start and exclude their end. Manual session choice does not alter
the entered time. Legacy Late Night Session values normalize to the new label.

## Journal workflows (3.0.0)

- Trade detail dialogs, retained screenshots with an in-app zoom view, safe editing
  with stable IDs and three-way merging of parallel changes, and explicit cancel.
- An eight-step IFVG preflight, optional planned risk, net P&L and separately
  documented fees. R is computed only for trades with documented positive risk.
- Profit factor, expectancy, realized equity drawdown, losing streak and plan rate.
- Configurable account profit target, cycle start, minimum positive daily profit,
  required qualifying days, drawdown limit and documented payouts. Payouts reduce
  the balance consistently across the dashboard and account detail views.
- Monday–Sunday weekly review with sessions, emotions, violations, reflection and
  next-week focus. Reviews and payouts use keyed objects for concurrent merging.
- Combined account/date/market/session/setup/text filters and 50-row pagination.
- CSV mapping and preview: BOM, comma/semicolon/tab, quoted multiline fields,
  German or ISO dates, validation, optional gross-to-net fee subtraction, and
  account-scoped duplicate detection by broker ID or normalized trade values.
  Max 5,000 rows / 4 MB. With only a comma in a currency value, it is treated as
  the decimal separator; check the preview for your broker's number format.
- Explicit read-only coach sharing by confirmed sign-in email, with independently
  optional notes, psychology and screenshots. The recipient opens shares from
  Settings → Coach-Freigaben in their own account. No invitation emails are sent.

The new Supabase migration is applied to the existing project. Public invoker RPCs
call a private checked implementation. Sharing requires a confirmed, non-anonymous
user with an active server session. Full journal documents remain owner-only;
shared trades omit account details, email, broker IDs and all optional fields by
default. Reads use the latest journal and recheck recipient access every time.
Revocation denies future reads; previously viewed or copied content cannot be
retracted. Shared screenshots support inline image data, not arbitrary external
URLs. A deleted trade stops appearing in incoming shares.

`npm test` covers calculations, CSV parsing and three-way cloud merge behavior.
`npm run test:browser` covers real clicks at 1440, 390 and 320px in both themes,
editing/cancel, screenshot zoom, risk, goals/payouts, review persistence, filters,
CSV preview/deduplication and the coach UI contract. `tests/coach-security.sql`
uses rolled-back synthetic fixtures to verify default privacy, optional fields,
owner-only journal access, recipient checks, revocation, anonymous restrictions
and expired session rejection against the deployed database. Coach UI stubs in
browser tests do not replace these database authorization tests.

All additions are included in the existing cloud document and offline cache.
Existing anonymous/local journals remain local until explicitly migrated to an
account. Drawdown reflects closed trades, not floating equity or prop-firm
intraday rules; goals are entered by the account owner, not inferred from a firm.

## Sync status fix (2.0.2)

JSONB reorders object keys. Journal comparisons now ignore object key order while
preserving array order and detecting changed values. This stops false pending
status and repeated writes of unchanged documents. Cloud tests emulate reordered
JSONB replies and assert that revisions remain stable after synchronization.
The core script URL and PWA cache are versioned to refresh older installations.

## Navigation fix (2.0.1)

Desktop sidebar buttons now invoke the same view switch used on mobile. Both
menus show the active view. The PWA asset cache version is bumped. Run `npm ci`,
`npx playwright install chromium-headless-shell`, then `npm run test:browser` to
exercise actual clicks in desktop and phone layouts, keyboard navigation, account
creation, trade submission, calendar controls and reload. CI runs this regression.
Set `TEST_APP_URL` to the deployed URL to run the same checks against GitHub Pages;
this uses isolated guest browser storage and does not modify cloud user journals.

## Validation

`npm test` runs deterministic merge and application integration tests. Integration tests simulate two clients and the cloud API; they do not replace live Supabase authorization or browser tests.

## Verified release status (2026-10-06)

The migration has been applied to the existing project `rgghadpfwxamnibwdgca`.
The rollback SQL tests passed against that database: revision conflicts, owner-only
reads, no direct client writes, anonymous access denial, and owner spoof rejection.
All 16 automated tests passed. Chromium tests with the real Supabase SDK and API
also passed: login for two test users, desktop/phone document sync, offline edits
merged with parallel desktop edits, deletion, reload and logout. Test users are
removed after verification. No JavaScript page errors were observed.

Database security advisors are clear apart from the existing disabled leaked-password
protection setting. Public registration and email recovery are implemented, but
email delivery, SMTP configuration and confirmation redirect URLs require live
verification before advertising open registration. No email delivery test was run.

## Release requirements

1. Apply `supabase/migrations/20261006190222_journal_sync.sql` to the **existing** Supabase project. It adds `journal_documents` and `save_journal_document`; it leaves the existing accounts, trades, profiles and daily journals untouched.
2. Run `supabase/tests/journal_security.sql` with a privileged SQL connection. Tests roll back their fixtures. Verify existing legacy tables have owner-only RLS before enabling migration from them.
3. Verify the project's publishable key in `index.html`, enable email/password sign-up, and add the current HTTPS app URL to Supabase's Site URL and allowed redirect URLs. Email confirmation and password reset need working email delivery.
4. Test login and registration with two dedicated test users; confirm user B cannot read user A's data. Test two browser sessions with one account: create, edit, delete, disconnect/reconnect, and reload the installed PWA.
5. Merge after the database and browser tests pass; verify the GitHub Pages deployment serves the new application assets.

## Data continuity

The original `ifvgTradingJournalV1` and recovery cache are retained. Old local data already bound to the signed-in user is copied automatically. Unbound legacy data requires the explicit **Alte Gerätedaten übernehmen** action to avoid assigning another person's journal to a new user.

Cloud legacy records are read in owner-filtered, paginated queries the first time a document is created. All newer journal fields, including account rules, screenshots, profile and privacy settings, are then stored in one atomic document. The server increments a revision and rejects outdated writes. The client retries a three-way merge: independent edits combine; deletion wins against concurrent edits; same-field conflicts keep the local value and preserve alternatives in `syncConflicts` in exported backups.

Pending edits survive reloads in a per-user local cache. They are not guaranteed to survive clearing browser storage or uninstalling the app before sync completes. An authenticated user switching accounts cannot carry pending writes into the next user's journal. Public registration creates a separate private journal; coach sharing is disabled until its own verified authorization model is implemented.

## Security boundaries

The publishable key is a public browser key. Never put service-role keys or database passwords into this repository. The new table permits owner-scoped reads through RLS. Writes are permitted only via an authenticated, owner-bound, size-limited compare-and-swap function. The service worker caches only application assets, never Supabase/API responses. It fetches updated app assets before falling back to offline copies.
