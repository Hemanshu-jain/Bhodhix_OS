# CLAUDE.md — Instructions for Claude AI Assistant

## System Identity & Workspace Overview
You are assisting **Hemanshu / Bhodhix Softwares (Bhodhix Softwares LLP)**.
This workspace is **Bhodhix OS (Command Center)**: a local planner, live server-health monitor and finance tracker for Bhodhix's software projects. Current projects:
1. **Handoff** — vehicle-recovery platform connecting vehicle finance companies with field recovery agents (live pilot).
2. **LOS-LMS** — core Loan Origination & Loan Management Suite for NBFC financiers.

Each project's own `project.md` is the authority on what it is; if this summary disagrees with it, trust `project.md` (the head sessions maintain it).

More projects will be added over time. Target commercial launch: see `target_launch_date` in `vault/company.md` (all countdowns are computed from it — never hardcode dates or day counts in code).

The vault starts **empty on purpose**: no demo or placeholder data. Real data is entered by the project head sessions. Never invent example numbers, clients or tasks.

## Roles
- **You (this session, the maintainer)** own the app code (`client/`, `server/`, `electron/`), `vault/company.md`, `vault/finances/`, `vault/monitoring/` and shared docs. Code and functionality changes happen here.
- **Head sessions** ("Handoff main head developer", "LMS main head developer") read everything but only **write data inside their own `vault/projects/<project>/` folder**. They never change code. Full data-entry rules for them: `vault/docs/claude-ai-operations-guide.md` (keep that file in sync when the data format changes).

## Markdown-First Vault (`./vault`)
All state is Markdown with YAML frontmatter. A local Node engine watches `vault/` and pushes changes to the app in real time (SSE). Editing the files *is* updating the tracker.

| Data | File |
|---|---|
| Company, launch date, milestones | `vault/company.md` |
| Project overview/metadata | `vault/projects/{id}/project.md` |
| Features | `vault/projects/{id}/features.md` |
| Tasks | `vault/projects/{id}/tasks.md` |
| Project revenue & expenses | `vault/projects/{id}/finances.md` |
| Project docs | `vault/projects/{id}/docs/*.md` |
| Consolidated ledger (derived + overheads + cash flow) | `vault/finances/bhodix-ledger.md` |
| Monitored endpoints / incidents | `vault/monitoring/endpoints.md`, `incidents.md` |
| Company-wide docs | `vault/docs/*.md` |

### Formats (the parser depends on these exactly — details in the operations guide)
- **Task**: `### TSK-NNN: Title` block with `- **status**:` (`upcoming|todo|in_progress|review|done|hold`; `hold` requires a `- **note**:` line saying why; `todo` is the queue the AI picks from next, no asking; `upcoming` = ideas, not started; legacy `backlog` reads as `hold`; done tasks leave the board after 7 days but stay in the Sheet), `priority` (`urgent|high|medium|low`), assignee, due_date, tags, description, subtasks (`- [ ]` / `- [x]`). IDs are **global and sequential across projects**.
- Task discussion, status history, time logs, and links are Markdown tables in `projects/<id>/docs/task-activity/<TSK-NNN>.md`. Shared task templates are stored in `docs/task-templates.md` frontmatter.
- Project milestones, goals, and health check-ins are stored in each `projects/<id>/project.md` frontmatter. Team announcements and availability are stored in `docs/team-updates.md` frontmatter.
- **Feature / revenue / expense / endpoint**: rows in the existing Markdown tables (keep header rows).
- **Incident**: `### INC-NN: Title` block with `Date`, `Status` (`open|resolved`), `Severity`, `Root Cause`, `Resolution`, optional `Repair Runbook` code fence.
- **Derived values are never hand-edited**: project finance totals, the consolidated ledger totals/contribution table, feature counts and incident counts are recomputed by the engine (`VaultManager.syncDerived`) whenever source tables change.

## Engine
- Desktop app: **Bhodhix OS** shortcut (Desktop / Start Menu), `run-bhodix.bat` or `npm run desktop`. The engine runs *inside* the Electron process (`electron/main.js` requires `server/src/server.js`); single instance; if an engine is already on port 4000 (e.g. `npm start`) the app just attaches to it. Server only: `npm start` (listens on **127.0.0.1:4000 only**). Re-create shortcuts with `npm run shortcuts`.
- After code changes: `npm run build` (UI) and restart the app (server/electron changes).
- Health monitor: local/TCP endpoints probed every 20s; public http(s) endpoints every 5 min (30s timeout, down only after 2 failed probes) so free Render/Aiven are not hammered. Manual "Sweep" probes everything.
- Build the client after UI changes: `npm run build` (the server serves `client/dist`).
- Tests: `npm test` (`server/test/*.test.js`: vault parser/writer and health monitor).
- Multi-company auth: users are global identities with organization-scoped memberships and roles. Workspace sign-in requires the workspace slug, email, and password. New companies get separate Markdown vaults under `TENANT_DATA_DIR`; the existing `vault/` is reserved for organization id `bhodhix`. Owner/admin accounts create single-use, seven-day invitations scoped to the current organization. Sessions last 12 hours. Account hashes, memberships, sessions, and invite hashes live in `AUTH_STORE_FILE` (default `server/.team.json`); never commit that file. `/api/setup/status`, `/api/setup/owner`, `/api/signup`, `/api/login`, and `/api/join` are public. All authenticated API and SSE traffic is scoped to the session organization. Local defaults bind to `127.0.0.1`; cloud hosting must configure `BIND_HOST`, `ALLOWED_HOSTS`, `ALLOWED_ORIGINS`, and durable storage for both the auth store and tenant data. This file-backed implementation is single-instance only; do not scale it across replicas.
- AI connections: `/mcp` is a stateless Streamable HTTP endpoint protected by OAuth 2.1 authorization code + PKCE. It grants the signed-in user's active workspace membership read access to projects, tasks, and workspace documents only. Access can be revoked from **AI Connections**; removing a membership also invalidates its grants. The OAuth client/grant store defaults to `server/.mcp-oauth.json`; keep it private and durable. A remote deployment must set `PUBLIC_BASE_URL` to its public HTTPS origin, bind the service for the reverse proxy, and allow the public host. Both OAuth state and vault data remain local files, so this is a single-instance pilot, not a horizontally scalable SaaS deployment. No server/database management tools are exposed.
- Server code: `server/src/{server,auth,vaultManager,markdown,healthMonitor}.js`. Soft-deleted projects go to `vault/.trash/`.

## Planner UI notes
- Sidebar is an icon rail: hover opens it (pushes the page), clicking a page closes it. Board columns auto-size from measured card heights (`layoutFor` in `PlannerView.jsx`) so the page never scrolls; header refresh = `POST /api/vault/reload` + health sweep.
- `vault/.done-seen.json` (hidden, engine-written) records when each task was first seen as done.
- Finance quick entry can book company-level expenses (no project) into the ledger's shared-overhead table via `POST /api/finances/overhead`.

## Conventions
- Keep Markdown tidy and tables aligned. Preserve frontmatter.
- Never hardcode project ids, names, dates or sample numbers in the client; everything comes from the vault state (`useVault()`).
- `_demo-vault-backup/` is a snapshot of the original demo vault, kept only for reference — safe to delete.
