# IFVG Trading Journal

Existing teal layout, private user journals, offline cache and revision-checked cloud sync for phone and desktop. No build step; serve these files over HTTPS.

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
