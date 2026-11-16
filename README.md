# Bhodhix Softwares Command Center (Bhodhix OS)

A command center for company workspaces: project/feature tracking, sprint planning, a live server-health monitor and a finance tracker. Project and operations data uses Markdown; the optional Secrets Vault is stored separately as client-encrypted ciphertext. The original Bhodhix workspace remains in `./vault`.

## Quick start (Windows)
For a free local workspace, choose **Create a free workspace** on the sign-in screen, enter your company and account details, then invite teammates from **Team** with the generated invite link. If SMTP is configured, Bhodhix also emails the invite; otherwise copy and share the link. No payment details are requested. Each downloaded desktop install currently stores its workspaces on that computer; invites join the same server only when users can reach that server.

Open **Bhodhix OS** from the Desktop or Start Menu (create the shortcuts once with `npm run shortcuts`). The desktop app starts its local engine automatically and keeps it running in the system tray when the window closes. Reopen it from the tray; choose **Quit Bhodhix** to stop the engine. `run-bhodix.bat` does the same. The app reuses a saved loopback port when available and chooses another if that port is occupied. For a browser-only engine, run `npm start` and open **http://127.0.0.1:4000**.

To build a Windows x64 installer from source, run `npm run package:win`; the installer is written to `release/`. The packaged app stores its account, workspace, and connector data in the current Windows user's app-data folder and does not include this checkout's `vault/` data. This produces an installer locally; publishing it for public download and shared cloud workspaces still requires hosting and deployment setup.

## Mobile access
The React client is an installable PWA on an HTTPS deployment. Open the hosted URL on a phone and use **Install app** in the browser menu, or **Share → Add to Home Screen** in Safari. The service worker can receive task, mail, and meeting Web Push while the PWA is closed when push is enabled and VAPID keys are configured. Electron desktop builds stay available in the system tray and show native and in-app notifications. Web/PWA background delivery requires HTTPS, browser notification permission, and an active server; a desktop install can generate local VAPID keys automatically. This remains a PWA, not a native iOS/Android store release.

## Scheduled AI reports
Workspace owners and admins can attach a one-time AI report to a task's start date and time. At that time, Bhodhix sends the task instructions and basic task details to the selected provider's API. The returned report appears in task activity and the task moves to **Review** for human approval. Scheduled AI runs do not have access to the Secrets Vault or tools that can change files, servers, or databases. Do not include passwords, API keys, or other secrets in task fields or instructions.

To enable a provider, set its API key and model in the server environment: `OPENAI_API_KEY` with `OPENAI_MODEL`, or `ANTHROPIC_API_KEY` with `ANTHROPIC_MODEL`. Provider keys stay on the server and are never sent to the browser; API usage is billed by the provider account configured by the workspace operator. Failed or interrupted runs can be retried by an owner or admin. The in-process scheduler requires one running app instance; it is not a durable multi-instance job queue.

## Slack connection
Workspace owners and admins can connect one Slack workspace from **Integrations**. Register a Slack app with bot scopes `chat:write` and `channels:read`, and set its OAuth redirect URL to `<PUBLIC_BASE_URL>/api/slack/oauth/callback`. Configure `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and a persistent 32-byte hex `SLACK_TOKEN_ENCRYPTION_KEY` in the server environment. Generate the encryption key with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and keep the same value across restarts and backups. OAuth requires the app's public HTTPS URL. The connection token is AES-256-GCM encrypted per workspace; Bhodhix can list public channels only after its bot has been invited. Configured event routing sends selected task and incident updates to the default or project-specific channel.

## Mail, calendar, database, and push connections

In **Integrations**, connect Google or Microsoft accounts for read-only email headers and calendar events. Local desktop installs use a loopback OAuth callback (shown in the app); configure a Google **Desktop app** OAuth client and a Microsoft app registration with public client flow enabled. The desktop app saves its callback port so it normally remains stable. Hosted deployments must set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, and `MICROSOFT_CLIENT_SECRET`, then register `<PUBLIC_BASE_URL>/api/integrations/oauth/callback` with both providers. Keep `CONNECTOR_TOKEN_ENCRYPTION_KEY` stable across restarts and backups; account tokens are encrypted per user and workspace. Mail/calendar events are checked by the running server every minute; provider-native Gmail/Graph webhook subscriptions are not configured.

Workspace owners and admins can add PostgreSQL monitors under **Server & Health**. Bhodhix stores the connection string encrypted and periodically runs only `SELECT 1`; use a dedicated database account with the least possible privileges and require TLS for remote database connections. The check runs from the Bhodhix server, so its network must be allowed by the database firewall. Hosted deployments should restrict outbound database access at the network layer to known customer database hosts.

For hosted PWA push, generate VAPID keys with `node -e "console.log(JSON.stringify(require('./server/src/pushNotifications').generateVapidKeys()))"`, set `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, and `WEB_PUSH_SUBJECT`, and restart the server. Push subscriptions are encrypted with `CONNECTOR_TOKEN_ENCRYPTION_KEY`. The packaged desktop app creates persistent local keys automatically.

## Provider-neutral hosted pilot
The Docker files provide a single-instance deployment path with a persistent volume for accounts, workspaces, and AI grants. Copy `.env.example` to `.env`, set the public HTTPS origin, exact host/origin allowlists, SMTP server URL, and sender address, then run `docker compose up --build -d`. Hosted signup requires email verification and TLS-protected SMTP; local installs keep verification optional. Password reset links use the configured SMTP service. The container binds its published port to localhost so a TLS reverse proxy can sit in front. Keep the `bhodhix-data` volume backed up and run one app instance only; this file-backed storage is not ready for horizontal scaling. Do not expose the pilot publicly until rate limiting, recovery, abuse controls, and production operations are reviewed.

- The desktop engine listens on `127.0.0.1` by default.
- The first owner of the existing Bhodhix workspace uses the setup PIN in `server/.pin` (auto-generated on first run; set `BHODIX_PIN` to override). Companies can create separate workspaces, then invite teammates from **Team**.
- Sign in with your email and password. Bhodhix selects your workspace membership automatically; accounts belonging to multiple workspaces can choose one after sign-in. New tenant Markdown data is stored under `data/tenants/<workspace-id>`; the shared account, membership, and invite store is configured with `AUTH_STORE_FILE`.
- A cloud pilot needs HTTPS at the edge, `BIND_HOST=0.0.0.0`, an exact `ALLOWED_HOSTS` list, an `ALLOWED_ORIGINS` list, and durable storage for both `AUTH_STORE_FILE` and `TENANT_DATA_DIR`. This file-backed version runs as a single server instance; do not run multiple replicas against separate local disks. Active health probes are disabled in hosted mode because customer-supplied targets need SSRF-safe validation first.
- AI clients connect through the MCP endpoint shown in **Integrations**. Every grant includes read access; task changes require the separate `bhodhix:task.write` scope at consent. A user can choose read-only access, and viewer accounts cannot grant writes. Write-enabled assistants can create tasks, add task comments, and change task status; only owner/admin grants can mark tasks done. Existing grants remain read-only until revoked and reconnected with write access. The connector has no Secrets Vault, finance, or server-management tools. For cloud clients, set `PUBLIC_BASE_URL` to the public HTTPS origin and `BIND_HOST=0.0.0.0`; allow the host through `ALLOWED_HOSTS`, persist `MCP_OAUTH_STORE_FILE` with `AUTH_STORE_FILE`, and keep all tenant files on durable storage. ChatGPT custom MCP connections depend on the plan and workspace permissions; Claude remote MCP connectors are available on supported paid plans and may require an organization owner. See the linked provider setup guides in **Integrations**.
- The **Secrets Vault** is restricted to workspace owners and admins. Entries are encrypted in the browser with AES-GCM before they reach the server, and its API stores only ciphertext in each workspace's `.secrets-vault.json`; secret values are not included in Markdown or MCP responses. All admins use the same vault passphrase. Losing it makes the entries unrecoverable, so keep a secure independent copy. This first version has no passphrase recovery or per-entry permissions.
- After UI changes run `npm run build`. Run the tests with `npm test`.

## What it does
| View | Source of truth |
|---|---|
| **Executive Cockpit** — launch countdown, MRR/burn/profit, per-project cards, milestones | `company.md`, ledger, project folders |
| **Projects & Features** — overview, stack, feature inventory with status/readiness | `projects/*/project.md`, `features.md` |
| **Planner & Sprints** — Kanban + sheet, subtask checkboxes, new tasks | `projects/*/tasks.md` |
| **Server & Health** — real HTTP and TCP probes every 20s, latency history, uptime, incidents & runbooks | `monitoring/endpoints.md`, `incidents.md` |
| **Finance & Economics** — per-project revenue/expense ledgers, consolidated P&L, cash-flow chart | `projects/*/finances.md`, `finances/bhodix-ledger.md` |
| **Document & Test Vault** — browse and edit any vault document | the whole vault |
| **Secrets Vault** — store project passwords, one-time codes, client credentials, API keys, and webhooks | encrypted `.secrets-vault.json` per workspace |
| **Team** — invite members, set on-ground/office/hybrid work type, assign routes, record photo check-ins and odometer trips, and review expense claims | organization memberships plus each tenant's `docs/field-work.json` |
| **Integrations** — connect ChatGPT, Claude, and other MCP clients; connect Slack, choose a public channel, and send a test message | MCP OAuth grants plus encrypted Slack bot token and channel settings per workspace |

The vault starts empty; real data is entered by the project head sessions (see `vault/docs/claude-ai-operations-guide.md`). Totals (project finances, consolidated ledger, feature and incident counts) are **derived automatically** from the tables — edit the tables, not the totals.

## Layout
```
vault/                      all data (Markdown + YAML frontmatter)
server/src/                 engine: vault parser/writer, health monitor, auth, API
client/src/                 React UI (Vite + Tailwind)
electron/                   desktop shell
server/test/                node:test checks for the vault logic
```

Adding a project: use **+** next to the project selector in the header, or create a folder under `vault/projects/`. Removing a project moves it to `vault/.trash/`.
# Employee desktop connection to a company server

The desktop app can use its private local workspace or connect to a shared Bhodhix server. Run the server on an always-on company machine, place it behind an HTTPS reverse proxy, and keep the Node server bound to the private network. The proxy must preserve the `Host` header and support long-lived Server-Sent Events connections.

Example server environment (replace the host and secrets with company values):

```powershell
$env:BIND_HOST = '0.0.0.0'
$env:PORT = '4000'
$env:PUBLIC_BASE_URL = 'https://planner.company.example'
$env:ALLOWED_HOSTS = 'planner.company.example'
$env:CONNECTOR_TOKEN_ENCRYPTION_KEY = '<persistent-random-32-byte-hex-key>'
npm start
```

Use a trusted certificate on the HTTPS address. Employees open Bhodhix OS, choose **Connect to a company server** on the sign-in screen, and enter that HTTPS origin. The desktop remembers the address for that Windows user; **Use this device** returns to its local workspace. Do not expose port 4000 directly to the public internet. Keep the server encryption key and tenant data directory in persistent storage and include them in the server’s protected backup procedure.

Field-work routes, shifts, mileage, and claims are stored under each organization’s tenant vault. Submitted photos are AES-GCM encrypted at rest; the encryption key is kept outside the workspace backup. Photo retention defaults to 90 days and workspace administrators can set 30 days through 10 years. The inactivity grace defaults to 30 minutes and can be set to 20, 30, 45, or 60 minutes. Heartbeats contain only an activity timestamp and are sent while the app is visible, focused, and used; no keystrokes, screen content, or location are recorded. Break and Travel pause alerts, and closing the app is never blocked. Odometer values are entered by the employee and compared with the submitted photos; automatic image reading is not enabled.
