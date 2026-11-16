const fsPromises = require('fs').promises;
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const chokidar = require('chokidar');
const { EventEmitter } = require('events');
const md = require('./markdown');

const { cell, oneLine, inr, isSafeId, pad, toNumber } = md;

const STATUSES = ['todo', 'in_progress', 'review', 'done', 'hold', 'upcoming'];
const normStatus = (s) => (s === 'backlog' ? 'hold' : s); // 'backlog' was renamed 'hold'
const OVERHEAD_HEADING = /^###\s+.*(Central|Overhead)/i;
const OVERHEAD_TABLE_HEADER = '| Service | Provider | Cost (INR) | Purpose |\n|---|---|---|---|';
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const WATCH_DEBOUNCE_MS = 120;
const TASK_TRASH_MS = 7 * 24 * 60 * 60 * 1000;

const FINANCE_REVENUE_HEADING = /^###\s+Revenue/i;
const FINANCE_EXPENSE_HEADING = /^###\s+(Infrastructure|Operational|.*Expense)/i;
const REVENUE_TABLE_HEADER =
  '| Client / Partner | Type | Amount (INR) | Billing Cycle | Status | Next Invoice |\n|---|---|---|---|---|---|';
const EXPENSE_TABLE_HEADER =
  '| Item / Service | Provider | Cost (INR) | Purpose | Auto-Debit |\n|---|---|---|---|---|';
const FEATURE_TABLE_HEADER =
  '| ID | Feature Name | Description | Status | Readiness | Owner |\n|---|---|---|---|---|---|';
const ENDPOINT_TABLE_HEADER =
  '| ID | Name | Project | URL | Method | Expected Status |\n|---|---|---|---|---|---|';

const today = () => new Date().toISOString().split('T')[0];
const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16);
const atomicWrite = (file, content) => {
  const temporary = `${file}.${require('crypto').randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, 'utf8');
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* temporary file may not exist */ }
    throw error;
  }
};

class VaultManager extends EventEmitter {
  constructor(vaultDir) {
    super();
    this.vaultDir = path.resolve(vaultDir);
    this.state = {
      company: null,
      projects: {},
      finances: null,
      monitoring: { endpoints: [], incidents: [] },
      docs: [],
      lastUpdated: new Date().toISOString()
    };
    this.watcher = null;
    this.debounce = null;
  }

  // ---------- lifecycle ----------

  init() {
    this.syncDerived();
    this.loadAll();
    this.purgeExpiredTasks();
    const interrupted = Object.values(this.state.projects).flatMap((project) => project.tasks.filter((task) => task.aiRunStatus === 'running').map((task) => ({ project: project.id, id: task.id })));
    for (const task of interrupted) this.setAiRunStatus(task.project, task.id, 'failed');
    // shortcut: the existing single-instance file store purges hourly; use a durable scheduler when scaling to multiple app instances.
    this.trashTimer = setInterval(() => this.purgeExpiredTasks(), 60 * 60 * 1000);
    this.trashTimer.unref();
    this.startWatcher();
  }

  loadAll() {
    try {
      this.state.company = this.loadCompany();
      this.state.projects = this.loadProjects();
      this.trackDone();
      this.state.finances = this.loadFinances();
      this.state.monitoring = this.loadMonitoring();
      this.state.docs = this.loadGlobalDocs();
      this.state.lastUpdated = new Date().toISOString();
      this.emit('change', this.state);
    } catch (err) {
      console.error('[VaultManager] Error loading vault:', err);
    }
  }

  startWatcher() {
    if (this.watcher) return;
    this.watcher = chokidar.watch(this.vaultDir, {
      ignored: /(^|[/\\])\../,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
    });

    this.watcher.on('all', () => {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.syncDerived();
        this.loadAll();
      }, WATCH_DEBOUNCE_MS);
    });
  }

  // ---------- fs helpers ----------

  projectsDir() { return path.join(this.vaultDir, 'projects'); }

  projectPath(id, ...parts) {
    if (!isSafeId(id)) throw new Error(`Invalid project id "${id}"`);
    return path.join(this.projectsDir(), id, ...parts);
  }

  listProjectIds() {
    if (!fs.existsSync(this.projectsDir())) return [];
    return fs.readdirSync(this.projectsDir(), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  }

  readMatter(file) {
    return fs.existsSync(file) ? matter(fs.readFileSync(file, 'utf8')) : null;
  }

  // ---------- loading ----------

  loadCompany() {
    const file = path.join(this.vaultDir, 'company.md');
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = matter(raw);
    return { metadata: parsed.data, content: parsed.content, raw, filePath: 'company.md' };
  }

  loadProjects() {
    const projects = {};
    for (const id of this.listProjectIds()) projects[id] = this.loadSingleProject(id);
    return projects;
  }

  loadSingleProject(id) {
    const dir = this.projectPath(id);
    const project = { id, meta: {}, overview: '', features: [], tasks: [], finances: {}, docs: [] };

    const overview = this.readMatter(path.join(dir, 'project.md'));
    if (overview) { project.meta = overview.data; project.overview = overview.content; }

    const features = this.readMatter(path.join(dir, 'features.md'));
    if (features) {
      project.features = md.parseMarkdownTable(features.content);
      const statusOf = (f) => (f.status || '').toLowerCase();
      project.featuresMeta = {
        ...features.data,
        total_features: project.features.length,
        completed_features: project.features.filter((f) => statusOf(f) === 'live').length,
        testing_features: project.features.filter((f) => statusOf(f).includes('testing')).length
      };
    }

    const tasksFile = path.join(dir, 'tasks.md');
    if (fs.existsSync(tasksFile)) {
      const content = fs.readFileSync(tasksFile, 'utf8');
      project.tasksMeta = matter(content).data;
      project.tasks = md.parseTasks(content, id);
    }

    const fin = this.readMatter(path.join(dir, 'finances.md'));
    if (fin) {
      const tables = md.parseFinanceTables(fin.content);
      project.finances = { meta: { ...fin.data, ...md.summarizeFinance(tables) }, content: fin.content, tables };
    }

    const docsDir = path.join(dir, 'docs');
    if (fs.existsSync(docsDir)) {
      project.docs = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).map((fileName) => {
        const parsed = matter(fs.readFileSync(path.join(docsDir, fileName), 'utf8'));
        return {
          id: fileName.replace('.md', ''),
          fileName,
          relativePath: `projects/${id}/docs/${fileName}`,
          meta: parsed.data,
          content: parsed.content
        };
      });
    }
    return project;
  }

  ledgerFile() { return path.join(this.vaultDir, 'finances', 'bhodix-ledger.md'); }

  projectFinanceRows() {
    return this.listProjectIds().map((id) => {
      const fin = this.readMatter(this.projectPath(id, 'finances.md'));
      const proj = this.readMatter(this.projectPath(id, 'project.md'));
      const summary = fin ? md.summarizeFinance(md.parseFinanceTables(fin.content)) : md.summarizeFinance({ revenueStreams: [], expenses: [] });
      return { id, name: proj?.data?.name || id, ...summary };
    });
  }

  // Consolidated numbers are always derived from the per-project ledgers + the overhead table.
  computeLedger(ledgerContent) {
    const rows = this.projectFinanceRows();
    const overheadSection = md.sectionsByHeading(ledgerContent)
      .find((s) => /central|overhead/i.test(s.heading));
    const overhead = overheadSection
      ? md.parseMarkdownTable(overheadSection.body).reduce((s, r) => s + toNumber(r.cost__inr_ ?? r.cost), 0)
      : 0;

    const mrr = rows.reduce((s, r) => s + r.monthly_gross_revenue, 0);
    const burn = rows.reduce((s, r) => s + r.monthly_total_expenses, 0);
    const expenses = burn + overhead;
    const net = mrr - expenses;
    return {
      rows,
      overhead,
      meta: {
        consolidated_mrr: mrr,
        consolidated_arr: mrr * 12,
        total_monthly_expenses: expenses,
        net_monthly_profit: net,
        net_margin_percentage: mrr > 0 ? Number(((net / mrr) * 100).toFixed(2)) : 0
      }
    };
  }

  loadFinances() {
    const parsed = this.readMatter(this.ledgerFile());
    if (!parsed) return null;

    const tables = {};
    for (const { heading, body } of md.sectionsByHeading(parsed.content)) {
      if (heading.includes('App Contribution')) tables.contributions = md.parseMarkdownTable(body);
      else if (/cash flow|projections/i.test(heading)) tables.cashFlowHistory = md.parseMarkdownTable(body);
      else if (/central|overhead/i.test(heading)) tables.overheads = md.parseMarkdownTable(body);
    }
    return {
      meta: { ...parsed.data, ...this.computeLedger(parsed.content).meta },
      content: parsed.content,
      tables
    };
  }

  loadMonitoring() {
    const endpointsFile = this.readMatter(path.join(this.vaultDir, 'monitoring', 'endpoints.md'));
    const incidentsFile = this.readMatter(path.join(this.vaultDir, 'monitoring', 'incidents.md'));

    const incidents = [];
    if (incidentsFile) {
      const sections = incidentsFile.content.split(/^###\s+(INC-\d+:[^\n]+)/gm);
      for (let i = 1; i < sections.length; i += 2) {
        const content = sections[i + 1] || '';
        const resolution = md.blockField(content, 'Resolution');
        incidents.push({
          title: sections[i].trim(),
          content,
          date: md.blockField(content, 'Date'),
          severity: md.blockField(content, 'Severity'),
          rootCause: md.blockField(content, 'Root Cause'),
          resolution,
          runbook: (content.split('```')[1] || '').replace(/^\s*bash\r?\n/, '').replace(/^ {2}/gm, '').trim(),
          status: (md.blockField(content, 'Status') || (resolution ? 'resolved' : 'open')).toLowerCase()
        });
      }
    }

    return {
      meta: endpointsFile?.data || {},
      endpoints: endpointsFile ? md.parseMarkdownTable(endpointsFile.content) : [],
      incidentsMeta: {
        ...(incidentsFile?.data || {}),
        total_incidents_recorded: incidents.length,
        open_incidents: incidents.filter((i) => i.status !== 'resolved').length
      },
      incidents
    };
  }

  loadGlobalDocs() {
    const docsDir = path.join(this.vaultDir, 'docs');
    if (!fs.existsSync(docsDir)) return [];
    return fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).map((fileName) => {
      const parsed = matter(fs.readFileSync(path.join(docsDir, fileName), 'utf8'));
      return {
        id: fileName.replace('.md', ''),
        fileName,
        relativePath: `docs/${fileName}`,
        meta: parsed.data,
        content: parsed.content
      };
    });
  }

  // ---------- derived totals written back to disk (idempotent: only writes on change) ----------

  syncDerived() {
    try {
      for (const id of this.listProjectIds()) this.recalculateProjectFinance(id);
      this.recalculateConsolidatedLedger();
    } catch (err) {
      console.error('[VaultManager] syncDerived failed:', err);
    }
  }

  recalculateProjectFinance(projectId) {
    const file = this.projectPath(projectId, 'finances.md');
    const parsed = this.readMatter(file);
    if (!parsed) return null;
    const derived = md.summarizeFinance(md.parseFinanceTables(parsed.content));
    if (Object.keys(derived).some((k) => parsed.data[k] !== derived[k])) {
      fs.writeFileSync(file, matter.stringify(parsed.content, { ...parsed.data, ...derived }), 'utf8');
    }
    return derived;
  }

  recalculateConsolidatedLedger() {
    const parsed = this.readMatter(this.ledgerFile());
    if (!parsed) return;

    const { rows, overhead, meta } = this.computeLedger(parsed.content);
    const totalRow = `| **Consolidated Total** | **${inr(meta.consolidated_mrr)}** | **${inr(meta.total_monthly_expenses)}** | **${inr(meta.net_monthly_profit)}** | **${meta.net_margin_percentage}%** |`;
    const table = [
      '| Product / App | Inflow (MRR) | Direct Infra Burn | Net Contribution | Margin % |',
      '|---|---|---|---|---|',
      ...rows.map((r) => `| ${cell(r.name)} | ${inr(r.monthly_gross_revenue)} | ${inr(r.monthly_total_expenses)} | ${inr(r.net_monthly_margin)} | ${r.monthly_gross_revenue > 0 ? `${r.net_margin_percentage}%` : '-'} |`),
      `| Bhodhix Central Overheads | ₹0 | ${inr(overhead)} | ${inr(-overhead)} | - |`,
      totalRow
    ];

    const body = this.replaceFirstTable(parsed.content, /^###\s+App Contribution/i, table);
    const metaChanged = Object.keys(meta).some((k) => parsed.data[k] !== meta[k]);
    if (!metaChanged && body.trim() === parsed.content.trim()) return;

    fs.writeFileSync(
      this.ledgerFile(),
      matter.stringify(body, { ...parsed.data, ...meta, updated_at: today() }),
      'utf8'
    );
  }

  replaceFirstTable(content, headingRe, tableLines) {
    const lines = content.split('\n');
    const h = lines.findIndex((l) => headingRe.test(l));
    if (h === -1) return content;

    let start = -1;
    for (let i = h + 1; i < lines.length && !/^###\s/.test(lines[i]); i++) {
      if (lines[i].trim().startsWith('|')) { start = i; break; }
    }
    if (start === -1) {
      lines.splice(h + 1, 0, '', ...tableLines);
      return lines.join('\n');
    }
    let end = start;
    while (end + 1 < lines.length && lines[end + 1].trim().startsWith('|')) end++;
    lines.splice(start, end - start + 1, ...tableLines);
    return lines.join('\n');
  }

  // ---------- tasks ----------

  nextTaskId() {
    let max = 0;
    for (const id of this.listProjectIds()) {
      const file = this.projectPath(id, 'tasks.md');
      if (fs.existsSync(file)) max = Math.max(max, md.maxNumber(fs.readFileSync(file, 'utf8'), /^###\s+TSK-(\d+):/gm));
    }
    for (const file of this.taskTrashFiles()) max = Math.max(max, Number(path.basename(file).match(/^(TSK-\d+)-/)?.[1]?.slice(4) || 0));
    const sequenceFile = path.join(this.vaultDir, '.task-sequence.json');
    if (fs.existsSync(sequenceFile)) {
      const lastId = Number(JSON.parse(fs.readFileSync(sequenceFile, 'utf8')).lastId);
      if (!Number.isSafeInteger(lastId) || lastId < 0) throw new Error('Task sequence data is invalid');
      max = Math.max(max, lastId);
    }
    return `TSK-${pad(max + 1, 3)}`;
  }

  rememberTaskId(taskId) {
    const number = Number(String(taskId).match(/^TSK-(\d+)$/)?.[1]);
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid task ID');
    const file = path.join(this.vaultDir, '.task-sequence.json');
    const lastId = fs.existsSync(file) ? Number(JSON.parse(fs.readFileSync(file, 'utf8')).lastId) : 0;
    if (!Number.isSafeInteger(lastId) || lastId < 0) throw new Error('Task sequence data is invalid');
    if (number > lastId) atomicWrite(file, `${JSON.stringify({ lastId: number })}\n`);
  }

  taskTrashFiles() {
    const root = path.join(this.vaultDir, '.trash', 'tasks');
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isSafeId(entry.name))
      .flatMap((project) => fs.readdirSync(path.join(root, project.name), { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^TSK-\d+-\d+\.json$/.test(entry.name))
        .map((entry) => path.join(root, project.name, entry.name)));
  }

  purgeExpiredTasks(now = Date.now()) {
    for (const file of this.taskTrashFiles()) {
      try {
        const deletedAt = Date.parse(JSON.parse(fs.readFileSync(file, 'utf8')).deletedAt);
        if (Number.isFinite(deletedAt) && now - deletedAt >= TASK_TRASH_MS) fs.unlinkSync(file);
      } catch { /* keep unreadable trash entries rather than risk deleting recoverable data */ }
    }
  }

  getDeletedTasks() {
    this.purgeExpiredTasks();
    return this.taskTrashFiles().flatMap((file) => {
      try {
        const item = JSON.parse(fs.readFileSync(file, 'utf8'));
        return [{ project: item.project, projectName: this.state.projects[item.project]?.meta?.name || item.project, id: item.id, title: item.title, reason: item.reason, deletedAt: item.deletedAt, deletedBy: item.deletedBy, expiresAt: new Date(Date.parse(item.deletedAt) + TASK_TRASH_MS).toISOString() }];
      } catch { return []; }
    }).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  deleteTask(projectId, taskId, reason, deletedBy) {
    const why = String(reason || '').trim();
    if (why.length < 5 || why.length > 1000) throw new Error('A deletion reason between 5 and 1000 characters is required');
    if (!isSafeId(taskId)) throw new Error('Invalid task ID');
    const file = this.projectPath(projectId, 'tasks.md');
    const task = this.state.projects[projectId]?.tasks?.find((item) => item.id === taskId);
    if (!task) return false;
    this.rememberTaskId(taskId);
    const content = fs.readFileSync(file, 'utf8');
    const range = md.taskBlockRange(content, taskId);
    if (!range) return false;
    const activityFile = this.projectPath(projectId, 'docs', 'task-activity', `${taskId}.md`);
    const deletedAt = new Date().toISOString();
    const trashFile = path.join(this.vaultDir, '.trash', 'tasks', projectId, `${taskId}-${Date.parse(deletedAt)}.json`);
    const record = { project: projectId, id: taskId, title: task.title, reason: why, deletedAt, deletedBy: oneLine(deletedBy), block: content.slice(range[0], range[1]).trimEnd(), activity: fs.existsSync(activityFile) ? fs.readFileSync(activityFile, 'utf8') : '' };
    fs.mkdirSync(path.dirname(trashFile), { recursive: true });
    atomicWrite(trashFile, `${JSON.stringify(record)}\n`);
    try { atomicWrite(file, content.slice(0, range[0]) + content.slice(range[1])); }
    catch (error) { try { fs.unlinkSync(trashFile); } catch { /* retain the recovery copy if cleanup fails */ } throw error; }
    if (record.activity) { try { fs.unlinkSync(activityFile); } catch { /* activity copy remains safely in task trash */ } }
    this.loadAll();
    return true;
  }

  restoreTask(projectId, taskId) {
    if (!isSafeId(projectId) || !isSafeId(taskId)) throw new Error('Invalid project or task ID');
    this.purgeExpiredTasks();
    const file = this.taskTrashFiles().find((item) => path.dirname(item) === path.join(this.vaultDir, '.trash', 'tasks', projectId) && path.basename(item).startsWith(`${taskId}-`));
    if (!file || !fs.existsSync(this.projectPath(projectId, 'tasks.md'))) return false;
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (this.state.projects[projectId]?.tasks.some((task) => task.id === taskId)) return false;
    const tasksFile = this.projectPath(projectId, 'tasks.md');
    const content = fs.readFileSync(tasksFile, 'utf8');
    atomicWrite(tasksFile, `${content.trimEnd()}\n\n---\n\n${record.block}\n`);
    if (record.activity) {
      const activityFile = this.projectPath(projectId, 'docs', 'task-activity', `${taskId}.md`);
      fs.mkdirSync(path.dirname(activityFile), { recursive: true });
      atomicWrite(activityFile, record.activity);
    }
    fs.unlinkSync(file);
    this.loadAll();
    return true;
  }

  // First date each task was seen as done (kept in vault/.done-seen.json, hidden from the vault UI/watcher).
  // The board hides tasks done for over a week; the sheet keeps them as a list.
  trackDone() {
    const file = path.join(this.vaultDir, '.done-seen.json');
    let seen = {};
    try { seen = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
    const next = {};
    for (const p of Object.values(this.state.projects)) {
      for (const t of p.tasks) {
        if (t.status !== 'done') continue;
        next[t.id] = seen[t.id] || today();
        t.doneAt = next[t.id];
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(seen)) fs.writeFileSync(file, JSON.stringify(next));
  }

  updateTaskStatus(projectId, taskId, status, note) {
    const newStatus = normStatus(status);
    if (!STATUSES.includes(newStatus)) return false;
    const file = this.projectPath(projectId, 'tasks.md');
    if (!fs.existsSync(file)) return false;

    const content = fs.readFileSync(file, 'utf8');
    const range = md.taskBlockRange(content, taskId);
    if (!range) return false;

    const block = content.slice(range[0], range[1]);
    const previousTask = this.state.projects[projectId]?.tasks.find((task) => task.id === taskId);
    let updated = block.replace(/^(- \*\*status\*\*:).*$/m, (_, k) => `${k} ${newStatus}`);
    if (typeof note === 'string') {
      const text = oneLine(note);
      updated = /^- \*\*note\*\*:/m.test(updated)
        ? updated.replace(/^(- \*\*note\*\*:).*$/m, (_, k) => `${k} ${text}`)
        : updated.replace(/^(- \*\*status\*\*:.*)$/m, (_, line) => `${line}\n- **note**: ${text}`);
    }

    fs.writeFileSync(file, content.slice(0, range[0]) + updated + content.slice(range[1]), 'utf8');
    this.loadAll();
    if (newStatus === 'done' && previousTask?.status !== 'done' && ['weekly', 'monthly'].includes(previousTask?.recurrence)) {
      const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(previousTask.dueDate || '') ? previousTask.dueDate : today();
      const nextDate = new Date(`${dueDate}T00:00:00Z`);
      if (Number.isNaN(nextDate.getTime())) nextDate.setTime(Date.parse(`${today()}T00:00:00Z`));
      if (previousTask.recurrence === 'weekly') nextDate.setUTCDate(nextDate.getUTCDate() + 7);
      else {
        const day = nextDate.getUTCDate();
        nextDate.setUTCDate(1);
        nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
        nextDate.setUTCDate(Math.min(day, new Date(Date.UTC(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, 0)).getUTCDate()));
      }
      this.createTask(projectId, { ...previousTask, status: 'todo', note: '', dueDate: nextDate.toISOString().slice(0, 10) });
    }
    return true;
  }

  toggleSubtask(projectId, taskId, subtaskText, completed) {
    const file = this.projectPath(projectId, 'tasks.md');
    if (!fs.existsSync(file)) return false;

    const content = fs.readFileSync(file, 'utf8');
    const range = md.taskBlockRange(content, taskId);
    if (!range) return false;

    const from = completed ? '- [ ]' : '- [x]';
    const to = completed ? '- [x]' : '- [ ]';
    let hit = false;
    const lines = content.slice(range[0], range[1]).split('\n').map((line) => {
      if (!hit && line.trim() === `${from} ${subtaskText}`) {
        hit = true;
        return line.replace(from, to);
      }
      return line;
    });
    if (!hit) return false;

    fs.writeFileSync(file, content.slice(0, range[0]) + lines.join('\n') + content.slice(range[1]), 'utf8');
    this.loadAll();
    return true;
  }

  createTask(projectId, data) {
    const file = this.projectPath(projectId, 'tasks.md');
    if (!fs.existsSync(file)) return null;

    const id = this.nextTaskId();
    const title = oneLine(data.title);
    const wanted = normStatus(data.status);
    const status = STATUSES.includes(wanted) ? wanted : 'todo';
    const priority = PRIORITIES.includes(data.priority) ? data.priority : 'medium';
    const startAt = oneLine(data.startAt);
    if (startAt && (Number.isNaN(Date.parse(startAt)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(startAt))) throw new Error('Start date and time must be a valid ISO timestamp');
    const reminderAt = oneLine(data.reminderAt);
    if (reminderAt && (Number.isNaN(Date.parse(reminderAt)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(reminderAt))) throw new Error('Reminder date and time must be a valid ISO timestamp');
    const aiProvider = oneLine(data.aiProvider);
    const aiInstructions = String(data.aiInstructions || '').trim();
    if (aiProvider && (!['openai', 'anthropic'].includes(aiProvider) || !startAt || aiInstructions.length < 5 || aiInstructions.length > 4000)) throw new Error('Scheduled AI tasks need a valid provider, start date and time, and instructions between 5 and 4000 characters');
    if (aiProvider && data.recurrence) throw new Error('Scheduled AI reports currently run once and cannot repeat');
    if (!aiProvider && aiInstructions) throw new Error('Choose an AI provider to schedule AI instructions');
    const recurrence = ['weekly', 'monthly'].includes(data.recurrence) ? data.recurrence : '';
    const blockedBy = oneLine(data.blockedBy || data.blocked_by);
    if (blockedBy && !Object.values(this.state.projects).some((project) => project.tasks.some((task) => task.id === blockedBy))) throw new Error('Dependency task not found');
    if (data.recurrence && !recurrence) throw new Error('Recurrence must be weekly or monthly');
    const customFields = data.customFields ?? data.custom_fields ?? {};
    if (!customFields || typeof customFields !== 'object' || Array.isArray(customFields) || Object.keys(customFields).length > 10) throw new Error('Invalid custom fields');
    const safeCustomFields = Object.fromEntries(Object.entries(customFields).map(([key, value]) => {
      const safeKey = oneLine(key).slice(0, 40);
      if (!safeKey || typeof value !== 'string' || oneLine(value).length > 120) throw new Error('Custom fields need a name and a value under 120 characters');
      return [safeKey, oneLine(value)];
    }));
    const subtasks = (data.subtasks || [])
      .map((s) => `  - [${s.completed ? 'x' : ' '}] ${oneLine(s.text)}`)
      .join('\n');

    const block = `

---

### ${id}: ${title}
- **id**: ${id}
- **title**: ${title}
- **project**: ${projectId}
- **status**: ${status}${data.note ? `
- **note**: ${oneLine(data.note)}` : ''}
- **priority**: ${priority}
- **assignee**: ${oneLine(data.assignee) || 'Unassigned'}
${startAt ? `- **start_at**: ${startAt}\n` : ''}${reminderAt ? `- **reminder_at**: ${reminderAt}\n` : ''}${aiProvider ? `- **ai_provider**: ${aiProvider}\n- **ai_instructions**: ${oneLine(aiInstructions)}\n- **ai_run_status**: queued\n- **ai_run_at**: ${startAt}\n` : ''}- **due_date**: ${oneLine(data.dueDate) || today()}
- **tags**: [${(data.tags || []).map(oneLine).join(', ')}]
${blockedBy ? `- **blocked_by**: ${blockedBy}\n` : ''}${recurrence ? `- **recurrence**: ${recurrence}\n` : ''}${Object.keys(safeCustomFields).length ? `- **custom_fields**: ${JSON.stringify(safeCustomFields)}\n` : ''}- **description**: ${oneLine(data.description)}
- **subtasks**:
${subtasks}
`;
    this.rememberTaskId(id);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').trimEnd() + block, 'utf8');
    this.loadAll();
    return id;
  }

  setAiRunStatus(projectId, taskId, status, runAt) {
    if (!['queued', 'running', 'completed', 'failed'].includes(status)) throw new Error('Invalid scheduled AI status');
    const task = this.state.projects[projectId]?.tasks.find((item) => item.id === taskId);
    if (!task?.aiProvider) return false;
    if (runAt && Number.isNaN(Date.parse(runAt))) throw new Error('Invalid scheduled AI run time');
    const file = this.projectPath(projectId, 'tasks.md');
    const content = fs.readFileSync(file, 'utf8');
    const range = md.taskBlockRange(content, taskId);
    if (!range) return false;
    let block = content.slice(range[0], range[1]);
    const replaceField = (name, value) => {
      const pattern = new RegExp(`^- \\*\\*${name}\\*\\*:.*$`, 'm');
      block = pattern.test(block) ? block.replace(pattern, `- **${name}**: ${value}`) : `${block.trimEnd()}\n- **${name}**: ${value}\n`;
    };
    replaceField('ai_run_status', status);
    if (runAt) replaceField('ai_run_at', new Date(runAt).toISOString());
    fs.writeFileSync(file, content.slice(0, range[0]) + block + content.slice(range[1]), 'utf8');
    this.loadAll();
    return true;
  }

  updateTaskReminder(projectId, taskId, reminderAt) {
    if (!isSafeId(projectId) || !isSafeId(taskId)) throw new Error('Invalid project or task ID');
    const task = this.state.projects[projectId]?.tasks.find((item) => item.id === taskId);
    if (!task) return false;
    const value = oneLine(reminderAt);
    if (value && (Number.isNaN(Date.parse(value)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))) throw new Error('Reminder date and time must be a valid ISO timestamp');
    const file = this.projectPath(projectId, 'tasks.md');
    const content = fs.readFileSync(file, 'utf8');
    const range = md.taskBlockRange(content, taskId);
    if (!range) return false;
    let block = content.slice(range[0], range[1]);
    if (value) {
      const line = `- **reminder_at**: ${value}`;
      block = /^- \*\*reminder_at\*\*:/m.test(block) ? block.replace(/^- \*\*reminder_at\*\*:.*$/m, line) : `${block.trimEnd()}\n${line}\n`;
    } else {
      block = block.replace(/^- \*\*reminder_at\*\*:.*\n?/gm, '');
    }
    fs.writeFileSync(file, content.slice(0, range[0]) + block + content.slice(range[1]), 'utf8');
    this.loadAll();
    return true;
  }

  taskActivityFile(projectId, taskId) {
    if (!isSafeId(taskId) || !this.state.projects[projectId]?.tasks.some((task) => task.id === taskId)) throw new Error('Task not found');
    return this.projectPath(projectId, 'docs', 'task-activity', `${taskId}.md`);
  }

  getTaskActivity(projectId, taskId) {
    const file = this.taskActivityFile(projectId, taskId);
    if (!fs.existsSync(file)) return [];
    return md.parseMarkdownTable(fs.readFileSync(file, 'utf8'))
      .map((row) => ({ type: row.type, createdAt: row.created_at, author: row.author, content: row.type === 'ai_report' ? Buffer.from(row.value, 'base64').toString('utf8') : row.content, value: row.value }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  addTaskActivity(projectId, taskId, { type, author, content, value = '' }) {
    if (!['comment', 'time', 'link', 'status', 'ai_report'].includes(type)) throw new Error('Invalid activity type');
    const file = this.taskActivityFile(projectId, taskId);
    const createdAt = new Date().toISOString();
    const fields = [type, createdAt, author, type === 'ai_report' ? 'Scheduled AI report' : content, type === 'ai_report' ? Buffer.from(String(content), 'utf8').toString('base64') : value].map(md.cell);
    const row = `| ${fields.join(' | ')} |`;
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `# Task activity: ${taskId}\n\n| Type | Created At | Author | Content | Value |\n|---|---|---|---|---|\n${row}\n`, 'utf8');
    } else {
      fs.appendFileSync(file, `${row}\n`, 'utf8');
    }
    this.emit('task_activity', { projectId, taskId });
    return { type, createdAt, author: md.oneLine(author), content: type === 'ai_report' ? String(content) : md.oneLine(content), value: type === 'ai_report' ? '' : md.oneLine(value) };
  }

  getTaskTemplates() {
    const parsed = this.readMatter(path.join(this.vaultDir, 'docs', 'task-templates.md'));
    return Array.isArray(parsed?.data?.templates) ? parsed.data.templates : [];
  }

  saveTaskTemplates(templates) {
    if (!Array.isArray(templates) || templates.length > 100) throw new Error('Invalid task templates');
    const clean = templates.map((template) => {
      const name = oneLine(template?.name);
      const title = oneLine(template?.title);
      if (!name || !title) throw new Error('Each template needs a name and task title');
      return {
        name, title,
        project: isSafeId(template.project) && this.state.projects[template.project] ? template.project : '',
        priority: PRIORITIES.includes(template.priority) ? template.priority : 'medium',
        status: STATUSES.includes(normStatus(template.status)) ? normStatus(template.status) : 'todo',
        note: oneLine(template.note), assignee: oneLine(template.assignee), description: oneLine(template.description),
        tags: Array.isArray(template.tags) ? template.tags.slice(0, 20).map(oneLine).filter(Boolean) : [],
        subtasks: Array.isArray(template.subtasks) ? template.subtasks.slice(0, 30).map(oneLine).filter(Boolean) : [],
        recurrence: ['weekly', 'monthly'].includes(template.recurrence) ? template.recurrence : '',
        customFields: template.customFields && typeof template.customFields === 'object' && !Array.isArray(template.customFields) ? template.customFields : {}
      };
    });
    if (new Set(clean.map((template) => template.name.toLowerCase())).size !== clean.length) throw new Error('Template names must be unique');
    const file = path.join(this.vaultDir, 'docs', 'task-templates.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, matter.stringify('# Shared task templates\n', { templates: clean }), 'utf8');
    return clean;
  }

  getTeamUpdates() {
    const parsed = this.readMatter(path.join(this.vaultDir, 'docs', 'team-updates.md'));
    return { announcements: parsed?.data?.announcements || [], availability: parsed?.data?.availability || [] };
  }

  saveTeamUpdates(updates) {
    const file = path.join(this.vaultDir, 'docs', 'team-updates.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, matter.stringify('# Team updates\n', updates), 'utf8');
  }

  addAnnouncement({ message, author }) {
    const text = oneLine(message);
    if (!text || text.length > 500) throw new Error('Announcement must be between 1 and 500 characters');
    const updates = this.getTeamUpdates();
    const item = { id: Date.now().toString(36), message: text, author: oneLine(author), createdAt: new Date().toISOString() };
    updates.announcements = [...updates.announcements, item].slice(-30);
    this.saveTeamUpdates(updates);
    return item;
  }

  setAvailability(user, { status, note = '', until = '' }) {
    if (!['available', 'focus', 'away'].includes(status)) throw new Error('Invalid availability status');
    const updates = this.getTeamUpdates();
    const item = { userId: user.id, name: oneLine(user.name), status, note: oneLine(note).slice(0, 120), until: /^\d{4}-\d{2}-\d{2}$/.test(until) ? until : '', updatedAt: new Date().toISOString() };
    updates.availability = [...updates.availability.filter((entry) => entry.userId !== user.id), item];
    this.saveTeamUpdates(updates);
    return item;
  }

  // ---------- projects ----------

  createProject(data) {
    const raw = oneLine(data.id || data.name).toLowerCase();
    const id = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id) throw new Error('Invalid project ID or name');

    const dir = this.projectPath(id);
    if (fs.existsSync(dir)) throw new Error(`Project "${id}" already exists`);

    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });

    const name = oneLine(data.name) || id;
    const shortName = (oneLine(data.shortName) || id.slice(0, 4)).toUpperCase();
    const str = (v) => oneLine(v);

    const overview = {
      id,
      name,
      short_name: shortName,
      category: str(data.category),
      tagline: str(data.tagline),
      stage: str(data.stage),
      target_live_date: str(data.targetLiveDate),
      current_version: str(data.currentVersion),
      repo: str(data.repo),
      tech_stack: {
        frontend: str(data.frontend),
        backend: str(data.backend),
        caching: str(data.caching),
        hosting: str(data.hosting)
      },
      live_url: str(data.liveUrl),
      api_health_url: str(data.apiHealthUrl),
      primary_client: str(data.primaryClient)
    };
    fs.writeFileSync(path.join(dir, 'project.md'),
      matter.stringify(`\n# ${name} — Platform Overview\n\n${str(data.description || data.tagline)}\n`, overview), 'utf8');

    fs.writeFileSync(path.join(dir, 'features.md'),
      matter.stringify(`\n# ${name} Feature Inventory\n\n${FEATURE_TABLE_HEADER}\n`, { project: id, updated_at: today() }), 'utf8');

    fs.writeFileSync(path.join(dir, 'tasks.md'),
      matter.stringify('\n## Sprint Tasks\n', { project: id, current_sprint: '', sprint_deadline: '' }), 'utf8');

    fs.writeFileSync(path.join(dir, 'finances.md'),
      matter.stringify(`
# ${name} — Unit Economics & Financial Ledger

### Revenue Inflows (Monthly Recurring & Transactional)

${REVENUE_TABLE_HEADER}

---

### Infrastructure & Operational Expenses (Monthly Burn)

${EXPENSE_TABLE_HEADER}
`, {
        project: id, currency: 'INR', monthly_gross_revenue: 0, monthly_total_expenses: 0,
        net_monthly_margin: 0, net_margin_percentage: 0
      }), 'utf8');

    if (data.apiHealthUrl || data.liveUrl) {
      this.addEndpoint({ name: `${name} Web/API`, project: id, url: data.apiHealthUrl || data.liveUrl });
    }

    this.syncDerived();
    this.loadAll();
    return { success: true, id, name };
  }

  updateProjectMetadata(projectId, { milestone, checkin, goal, author }) {
    const file = this.projectPath(projectId, 'project.md');
    const parsed = this.readMatter(file);
    if (!parsed) throw new Error('Project not found');
    const meta = { ...parsed.data };
    if (milestone) {
      const name = oneLine(milestone.name);
      if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(milestone.date || '')) throw new Error('Milestones need a name and date');
      meta.milestones = [...(Array.isArray(meta.milestones) ? meta.milestones : []), { name, date: milestone.date, status: 'planned' }].slice(-50);
    }
    if (goal) {
      const name = oneLine(goal.name);
      if (!name) throw new Error('Goal name is required');
      const goals = Array.isArray(meta.goals) ? meta.goals : [];
      if (goals.some((item) => item.name?.toLowerCase() === name.toLowerCase())) throw new Error('That goal already exists');
      meta.goals = [...goals, { name, status: 'active' }].slice(-50);
    }
    if (checkin) {
      if (!['on_track', 'at_risk', 'blocked'].includes(checkin.status)) throw new Error('Invalid project health status');
      const summary = oneLine(checkin.summary);
      if (!summary) throw new Error('Health update needs a short summary');
      meta.health_checkins = [...(Array.isArray(meta.health_checkins) ? meta.health_checkins : []), { status: checkin.status, summary, author: oneLine(author), date: istNow() }].slice(-30);
    }
    fs.writeFileSync(file, matter.stringify(parsed.content, meta), 'utf8');
    this.loadAll();
    return meta;
  }

  // Soft delete: the folder moves to vault/.trash so nothing is ever lost.
  deleteProject(projectId) {
    const dir = this.projectPath(projectId);
    if (!fs.existsSync(dir)) throw new Error(`Project "${projectId}" not found`);

    const trash = path.join(this.vaultDir, '.trash');
    fs.mkdirSync(trash, { recursive: true });
    fs.renameSync(dir, path.join(trash, `${projectId}-${Date.now()}`));

    this.syncDerived();
    this.loadAll();
    return true;
  }

  // ---------- features ----------

  addFeature(projectId, feat) {
    const file = this.projectPath(projectId, 'features.md');
    const parsed = this.readMatter(file);
    if (!parsed) throw new Error('Project features.md not found');

    const prefix = this.readMatter(this.projectPath(projectId, 'project.md'))?.data?.short_name
      || projectId.slice(0, 4).toUpperCase();
    const next = md.maxNumber(parsed.content, /-F(\d+)/g) + 1;
    const id = `${prefix}-F${pad(next, 2)}`;

    const row = `| ${id} | ${cell(feat.name) || 'New Feature'} | ${cell(feat.description)} | ${cell(feat.status) || 'Planned'} | ${cell(feat.readiness) || '0%'} | ${cell(feat.owner) || 'Unassigned'} |`;
    const body = md.appendTableRow(parsed.content, /^#\s|^###\s/, FEATURE_TABLE_HEADER, row, '### Features');

    fs.writeFileSync(file, matter.stringify(body, { ...parsed.data, updated_at: today() }), 'utf8');
    this.loadAll();
    return { success: true, id };
  }

  // ---------- finance rows ----------

  addFinanceRow(projectId, headingRe, header, row, newHeading) {
    const file = this.projectPath(projectId, 'finances.md');
    const parsed = this.readMatter(file);
    if (!parsed) throw new Error('Project finances.md not found');

    const body = md.appendTableRow(parsed.content, headingRe, header, row, newHeading);
    fs.writeFileSync(file, matter.stringify(body, parsed.data), 'utf8');

    const summary = this.recalculateProjectFinance(projectId);
    this.recalculateConsolidatedLedger();
    this.loadAll();
    return summary;
  }

  addRevenueStream(projectId, rev) {
    const row = `| ${cell(rev.client) || 'New Client'} | ${cell(rev.type) || '-'} | ${toNumber(rev.amount)} | ${cell(rev.billingCycle) || 'Monthly'} | ${cell(rev.status) || '-'} | ${cell(rev.nextInvoice) || '-'} |`;
    const s = this.addFinanceRow(projectId, FINANCE_REVENUE_HEADING, REVENUE_TABLE_HEADER, row,
      '### Revenue Inflows (Monthly Recurring & Transactional)');
    return { success: true, monthlyGrossRevenue: s.monthly_gross_revenue };
  }

  addExpense(projectId, exp) {
    const row = `| ${cell(exp.item) || 'New Expense'} | ${cell(exp.provider) || '-'} | ${toNumber(exp.cost)} | ${cell(exp.purpose) || '-'} | ${cell(exp.autoDebit) || '-'} |`;
    const s = this.addFinanceRow(projectId, FINANCE_EXPENSE_HEADING, EXPENSE_TABLE_HEADER, row,
      '### Infrastructure & Operational Expenses (Monthly Burn)');
    return { success: true, monthlyTotalExpenses: s.monthly_total_expenses };
  }

  // Company-level (non-project) expense -> the shared overhead table in the consolidated ledger.
  addOverhead(exp) {
    const parsed = this.readMatter(this.ledgerFile());
    if (!parsed) throw new Error('bhodix-ledger.md not found');

    const row = `| ${cell(exp.service) || 'Expense'} | ${cell(exp.provider) || '-'} | ${toNumber(exp.cost)} | ${cell(exp.purpose) || '-'} |`;
    const body = md.appendTableRow(parsed.content, OVERHEAD_HEADING, OVERHEAD_TABLE_HEADER, row,
      '### Bhodhix Central Infrastructure & Shared SaaS Overhead');
    fs.writeFileSync(this.ledgerFile(), matter.stringify(body, parsed.data), 'utf8');

    this.recalculateConsolidatedLedger();
    this.loadAll();
    return { success: true };
  }

  // ---------- monitoring ----------

  addEndpoint(ep) {
    const file = path.join(this.vaultDir, 'monitoring', 'endpoints.md');
    const parsed = this.readMatter(file);
    if (!parsed) throw new Error('endpoints.md not found');

    const id = ep.id || `EP-${pad(md.maxNumber(parsed.content, /\|\s*EP-(\d+)\s*\|/g) + 1, 2)}`;
    const row = `| ${cell(id)} | ${cell(ep.name) || 'Endpoint'} | ${cell(ep.project) || 'core'} | ${cell(ep.url)} | ${cell(ep.method) || 'GET'} | ${cell(ep.expectedStatus) || '200'} |`;
    const body = md.appendTableRow(parsed.content, /^###\s/, ENDPOINT_TABLE_HEADER, row, '### Monitored Services');

    fs.writeFileSync(file, matter.stringify(body, parsed.data), 'utf8');
    this.loadAll();
    return { success: true, id };
  }

  addIncident(inc) {
    const file = path.join(this.vaultDir, 'monitoring', 'incidents.md');
    const parsed = this.readMatter(file);
    if (!parsed) throw new Error('incidents.md not found');

    const id = `INC-${pad(md.maxNumber(parsed.content, /^###\s+INC-(\d+):/gm) + 1, 2)}`;
    const runbook = (inc.runbook || '').trim();
    const block = `

---

### ${id}: ${oneLine(inc.title) || 'Untitled incident'}
- **Date**: ${istNow()} IST
- **Status**: ${oneLine(inc.status) || (inc.resolution ? 'resolved' : 'open')}
- **Duration**: ${oneLine(inc.duration) || '-'}
- **Impacted Systems**: ${oneLine(inc.impactedSystems) || '-'}
- **Severity**: ${oneLine(inc.severity) || '-'}
- **Root Cause**: ${oneLine(inc.rootCause) || '-'}
- **Resolution**: ${oneLine(inc.resolution)}${runbook ? `
- **Repair Runbook**:
  \`\`\`bash
  ${runbook.replace(/```/g, "'''").split('\n').join('\n  ')}
  \`\`\`` : ''}
`;
    fs.writeFileSync(file,
      matter.stringify(parsed.content.trimEnd() + block, { ...parsed.data, last_incident_date: today() }), 'utf8');
    this.loadAll();
    return { success: true, id };
  }

  // ---------- raw file access (document editor) ----------

  resolveInVault(relativePath) {
    const full = path.resolve(this.vaultDir, String(relativePath || ''));
    const rel = path.relative(this.vaultDir, full);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some((p) => p.startsWith('.'))) {
      throw new Error('Access denied: path outside vault');
    }
    if (!full.endsWith('.md')) throw new Error('Only .md files can be accessed');
    return full;
  }

  saveFile(relativePath, rawContent) {
    const full = this.resolveInVault(relativePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, rawContent, 'utf8');
    this.syncDerived();
    this.loadAll();
    return true;
  }

  getFile(relativePath) {
    try {
      const full = this.resolveInVault(relativePath);
      return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
    } catch {
      return null;
    }
  }
}

module.exports = VaultManager;
