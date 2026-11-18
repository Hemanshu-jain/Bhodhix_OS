# Bhodhix OS — PostgreSQL and hosting handoff

Prepared 18 November 2026 for the next Codex chat.

## Purpose and working agreement

The next chat should continue the PostgreSQL/runtime and hosting work from the current repository state without treating the migration branch as deploy-ready. The user wants to complete this backend/hosting phase in the other chat, then return here to continue UI/UX work.

- Product: Bhodhix OS / Bhodhix Command Center, currently a Windows desktop app with a React UI and a Node/Express server.
- Repository: `https://github.com/Hemanshu-jain/Bhodhix_OS` (currently public).
- Local checkout: `D:\Hemanshu\PERSNOAL\ALL Planner`.
- User wants to preserve all existing data. Backups were made before migration preparation; do not overwrite or remove them.
- User selected PostgreSQL after initially considering MySQL. Render has been discussed as an option, but no hosting provider or production domain configuration has been finalized.
- Previous UX scope remains: do not change the board. No UI changes are part of the current backend handoff.
- Continue to keep actual secrets out of Git and out of chat. Ask the user to enter secrets directly in the chosen host when that step is reached.

## Current repository state (verified)

Working tree was clean when this handoff was prepared.

| Branch | Commit | State |
|---|---|---|
| `main` | `a75ba2d` | Initial source snapshot; do not deploy this as the PostgreSQL cutover. |
| `feature/postgresql-backend` | `3e2bdc5` | Current work branch, pushed to `origin`; contains schema, migration/preflight/import tooling. |

Recent feature-branch commits:

1. `d45568f` — PostgreSQL schema and migration tooling.
2. `55b9c1d` — offline legacy data preflight.
3. `3e2bdc5` — normalized legacy importer and archive verification.

The branch URL is `https://github.com/Hemanshu-jain/Bhodhix_OS/tree/feature/postgresql-backend`.

## Critical status: do not host this as production yet

The app's live runtime still uses local files. Setting `DATABASE_URL` does **not** switch reads/writes to PostgreSQL. The `pg` package is present, and `server/src/postgres.js` is used by the schema/import scripts, but the Express app does not yet use PostgreSQL as its runtime store.

The current runtime has synchronous file-backed paths in `server/src/auth.js`, `server/src/vaultManager.js`, and auxiliary stores for billing, secrets, field work, integrations, notifications, and monitoring. `server/src/server.js` creates per-organization `VaultManager` instances pointing at local directories. A partial database switch or a deploy with an empty container filesystem could make data appear missing or fail to persist. Do not deploy the current branch to serve real users until runtime storage is converted and verified.

The runtime conversion is larger than supplying a connection string: API handlers and their callers need to use an asynchronous, organization-scoped database layer, with transactions and safe concurrency. Preserve the local desktop mode while adding hosted PostgreSQL mode. Avoid an in-memory/file-cache shim that merely mirrors writes to the DB; it is not a safe multi-user source of truth.

## What is implemented

- `server/migrations/001_initial_schema.sql`: initial PostgreSQL schema for organizations, users, memberships, invites, sessions, projects, features, tasks/activity/trash, documents, billing, finance, monitors, field work, encrypted workspace data, settings, MCP OAuth records, archive records, and migration runs.
- `server/src/postgres.js`: PostgreSQL pool validation and versioned SQL migration runner with an advisory lock and checksum guard.
- `server/scripts/db-migrate.js`: runs schema migrations.
- `server/scripts/db-prepare-legacy.js`: offline count/fingerprint preflight, avoiding printing user content.
- `server/scripts/db-archive-legacy.js`: archives source file bytes and SHA-256 checksums when connected to PostgreSQL; it does not delete source files and verifies archived hashes.
- `server/scripts/db-import-legacy.js`: offline dry-run plus normalized import for supported auth/workspace records. The actual import archives original files, then imports normalized records transactionally. Raw source files remain archived for recovery.
- `server/migrations/README.md`: current procedure and warning that runtime adapters/cutover are not done.
- Dockerfile builds the React client and Node server using Node 22, but the server in that image is still file-backed at runtime.

Commands from `server/`:

```powershell
npm run db:prepare-legacy
npm run db:archive-legacy -- --dry-run
npm run db:import-legacy -- --dry-run
```

The first two dry-runs and importer dry-run were run successfully during preparation. `node --check` passed for the new importer and archive script. No live PostgreSQL was available, so schema application and actual SQL import have not been exercised. No test suite was run.

## Existing data and backups

The active installed app profile is the canonical import source when it exists. The preflight found:

- 1 organization, 1 user, 1 membership; the current preflight showed no active sessions. The importer preview includes 2 stored sessions, which may be expired.
- 3 projects, 48 features, 79 tasks, 18 task activity entries.
- 1 billing client, 1 quotation, no invoices.
- 13 finance entries, 5 monitoring endpoints.
- No current field routes, shifts, trips, claims, or field photos.
- 82 files / 1,027,814 bytes in the raw archive preview across auth, the active vault, tenant copies, and two recovery sources.

`db:prepare-legacy` counts project markdown documents differently from the importer, which counts all markdown files: its preflight showed 4 project documents; the importer preview showed 35 markdown documents across the workspace.

Backup copies exist at:

- `D:\Hemanshu\PERSNOAL\ALL Planner\_backups\pre-mysql-20261116`
- `C:\Users\DELL\Documents\Bhodhix_OS_Backups\pre-mysql-20261116`

Earlier verification recorded matching hashes for critical source/auth/vault files in both copies. A locked Chromium `Network\Cookies` file was omitted from the snapshot because the desktop host held it open; it is not app workspace data. Do not treat the snapshots as a substitute for a fresh backup immediately before hosting/import.

The importer intentionally does not move master encryption/host keys into PostgreSQL. Existing connector/field-work encryption keys and Web Push private keys must be preserved/configured securely at the host so encrypted records remain readable. Never commit `.env`, credentials, vaults, app profiles, backups, or build artifacts.

## Recommended execution path for the next chat

### Phase 1 — finish runtime storage locally

1. Start from `feature/postgresql-backend`; check `git status` and read this document plus `server/migrations/README.md`.
2. Map every storage caller before edits. At minimum cover auth/setup/signup/login/session and team membership; project/task/document APIs and SSE; billing; secrets vault; field routes/photos/claims; integrations and tokens; notification subscriptions/deliveries; scheduled AI; monitoring; MCP OAuth; backup/restore.
3. Define one clear storage boundary with PostgreSQL as the hosted source of truth and preserve the current local desktop behavior. No silent fallback to local disk in hosted mode.
4. Make all organization-scoped reads/writes enforce tenant and role checks. Use transactions for related changes and explicit optimistic-concurrency or locking where concurrent edits can collide.
5. Keep secret payloads encrypted. The database importer must not make existing encrypted vault entries decryptable only on the old machine; document required persistent host keys and test the decryption flow.
6. Add an explicit startup/configuration failure for an incomplete hosted configuration rather than starting a file-backed hosted app under the impression it is database-backed.
7. Check source and migrations statically; do not claim cutover or hosted readiness from build success alone. The repository's normal API needs behavior verification against PostgreSQL before deploy.

### Phase 2 — prepare a safe staging migration

1. Before any live import, create a fresh, independent backup of the current installed profile and workspace; verify it can be read and compare hashes/counts.
2. Provision an empty **staging** PostgreSQL database. Do not use production data for the first SQL exercise.
3. Put `DATABASE_URL` and the needed encryption/email/provider keys directly into host secret settings, never into Git or chat.
4. Run migrations, then the importer dry-run; review organization and record counts against the latest source. Do not rely on the November preview because records may have changed.
5. Run the importer only after counts and backups are confirmed. Check both normalized rows and archived-file checksums. Keep the source and backups unchanged.
6. Deploy the branch to a staging URL only after the runtime PostgreSQL adapter is implemented.
7. Verify sign-in, workspace association, project/task CRUD, quotations/invoices, vault encryption/decryption, team roles/invites, notifications, field-work records, and tenant isolation with separate test accounts. Confirm restarts preserve data and verify a database backup/restore procedure.

### Phase 3 — production hosting

1. Confirm provider (Render was discussed, not finalized), service region, PostgreSQL plan, app subdomain/domain, and expected user count with the owner.
2. Create production DB and app service only after staging passes. Use separate production secrets and a fresh final backup.
3. Import and verify production data before routing users. Do not point DNS at an unverified deployment.
4. Configure the domain and HTTPS after the staging endpoint is healthy; update allowed hosts/origins and OAuth callback URLs to the final origin.
5. Merge the verified feature branch to `main` only with the owner's go-ahead. Keep a rollback plan and the pre-cutover backups until post-launch verification is complete.

## Owner input will be needed later

Do not ask for these until the code is genuinely ready for hosted verification:

- Final hosting provider and account/service access; Render is a candidate, not a confirmed choice.
- Production domain or subdomain and DNS access.
- Email sending provider/settings for required hosted email verification.
- Secure entry of database and encryption secrets into provider settings.
- Explicit approval before production DNS cutover or merging/deploying to production.

The owner should enter secrets into the provider dashboard. Do not request secret values in this chat.

## Ready-to-paste prompt for the next Codex chat

```text
Continue the Bhodhix OS PostgreSQL and hosting work. Read POSTGRES_DEPLOYMENT_HANDOFF.md and server/migrations/README.md first, then inspect the current branch, working tree, and relevant source before editing.

Current branch is feature/postgresql-backend at 3e2bdc5. The schema, migration runner, offline preflight, archive verification, and normalized legacy importer exist. The current app runtime is still file-backed; DATABASE_URL only serves migration/import scripts. Do not deploy this branch to real users or claim that PostgreSQL cutover is complete.

The owner explicitly wants existing data preserved and asked that independent work proceed without asking for routine choices. Keep desktop/local storage working, implement a real organization-scoped PostgreSQL runtime path across auth and workspace APIs/stores, preserve encryption, and fail clearly instead of silently using local files in hosted mode. Make changes on the existing feature branch, keep secrets/backups/vault data out of Git, and verify real database behavior before staging deployment.

Do not request credentials in chat. First finish and review the runtime code locally. When hosted verification genuinely requires owner input, ask for the provider/domain/account actions needed and have the owner enter secrets directly in the provider dashboard. Start with staging; production DNS and production merge/deploy require explicit owner approval. After hosting is stable, the owner plans to return to UI/UX work.
```
