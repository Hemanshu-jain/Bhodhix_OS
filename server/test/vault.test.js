// Run: npm test   (self-contained: builds blank vault templates in a temp dir, never reads the real vault)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const VaultManager = require('../src/vaultManager');

const LEDGER = `---
consolidated_mrr: 0
---

### App Contribution Breakdown

| Product / App | Inflow (MRR) | Direct Infra Burn | Net Contribution | Margin % |
|---|---|---|---|---|

---

### Bhodix Central Infrastructure & Shared SaaS Overhead

| Service | Provider | Cost (INR) | Purpose |
|---|---|---|---|
`;
const ENDPOINTS = `---
check_interval_seconds: 20
---

### Monitored Services

| ID | Name | Project | URL | Method | Expected Status |
|---|---|---|---|---|---|
`;
const INCIDENTS = `---
last_incident_date: ""
---

# Incident History
`;

function freshVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bhodix-vault-'));
  fs.mkdirSync(path.join(dir, 'finances'));
  fs.mkdirSync(path.join(dir, 'monitoring'));
  fs.writeFileSync(path.join(dir, 'finances', 'bhodix-ledger.md'), LEDGER);
  fs.writeFileSync(path.join(dir, 'monitoring', 'endpoints.md'), ENDPOINTS);
  fs.writeFileSync(path.join(dir, 'monitoring', 'incidents.md'), INCIDENTS);
  fs.writeFileSync(path.join(dir, 'company.md'), '---\ncompany: Test\n---\n');
  fs.mkdirSync(path.join(dir, 'projects'));
  const vm = new VaultManager(dir);
  vm.loadAll();
  return { vm, dir };
}

test('new project is blank and task ids are sequential across projects', () => {
  const { vm } = freshVault();
  vm.createProject({ name: 'Alpha' });
  vm.createProject({ name: 'Beta' });
  assert.deepEqual(vm.state.projects.alpha.tasks, []);
  assert.deepEqual(vm.state.projects.alpha.features, []);

  assert.equal(vm.createTask('alpha', { title: 'one' }), 'TSK-001');
  assert.equal(vm.createTask('beta', { title: 'two' }), 'TSK-002');
  assert.equal(vm.createTask('alpha', { title: 'three | with\nnewline' }), 'TSK-003');
  assert.equal(vm.state.projects.alpha.tasks.length, 2);
  assert.equal(vm.state.projects.alpha.tasks[1].title, 'three | with newline');
});

test('status and subtask edits stay inside their own task', () => {
  const { vm } = freshVault();
  vm.createProject({ name: 'Alpha' });
  vm.createTask('alpha', { title: 'A', subtasks: [{ text: 'same', completed: false }] });
  vm.createTask('alpha', { title: 'B', subtasks: [{ text: 'same', completed: false }] });

  assert.ok(vm.toggleSubtask('alpha', 'TSK-002', 'same', true));
  const [a, b] = vm.state.projects.alpha.tasks;
  assert.equal(a.subtasks[0].completed, false);
  assert.equal(b.subtasks[0].completed, true);

  assert.ok(vm.updateTaskStatus('alpha', 'TSK-001', 'done'));
  assert.equal(vm.state.projects.alpha.tasks[0].status, 'done');
  assert.equal(vm.state.projects.alpha.tasks[1].status, 'todo');
  assert.equal(vm.updateTaskStatus('alpha', 'TSK-001', 'bogus'), false);
});

test('finance totals are derived and roll up to the consolidated ledger', () => {
  const { vm } = freshVault();
  vm.createProject({ name: 'Alpha' });
  vm.addRevenueStream('alpha', { client: 'Acme', amount: 100000 });
  vm.addExpense('alpha', { item: 'Server', cost: 25000 });
  vm.addRevenueStream('alpha', { client: 'Beta Co', amount: 50000 }); // must not wipe expenses

  const fin = vm.state.projects.alpha.finances;
  assert.equal(fin.tables.revenueStreams.length, 2);
  assert.equal(fin.tables.expenses.length, 1);
  assert.equal(fin.meta.monthly_gross_revenue, 150000);
  assert.equal(fin.meta.monthly_total_expenses, 25000);

  const ledger = vm.state.finances.meta;
  assert.equal(ledger.consolidated_mrr, 150000);
  assert.equal(ledger.consolidated_arr, 1800000);
  assert.equal(ledger.net_monthly_profit, 125000);
  assert.equal(vm.state.finances.tables.contributions.length, 3); // alpha + overhead + total
});

test('delete is a soft delete and path traversal is refused', () => {
  const { vm, dir } = freshVault();
  vm.createProject({ name: 'Alpha' });
  vm.deleteProject('alpha');
  assert.equal(vm.state.projects.alpha, undefined);
  assert.equal(fs.readdirSync(path.join(dir, '.trash')).length, 1);

  assert.throws(() => vm.saveFile('../outside.md', 'x'), /Access denied/);
  assert.throws(() => vm.saveFile('company.txt', 'x'), /Only .md/);
  assert.equal(vm.getFile('../../package.json'), null);
  assert.throws(() => vm.createTask('../x', { title: 't' }), /Invalid project id/);
});

test('endpoints and incidents get sequential ids and derived counts', () => {
  const { vm } = freshVault();
  assert.equal(vm.addEndpoint({ name: 'Web', project: 'alpha', url: 'https://example.com' }).id, 'EP-01');
  assert.equal(vm.addEndpoint({ name: 'DB', project: 'alpha', url: 'postgresql://db:5432' }).id, 'EP-02');
  assert.equal(vm.state.monitoring.endpoints.length, 2);

  assert.equal(vm.addIncident({ title: 'Down', rootCause: 'disk full', runbook: 'df -h\nrm tmp' }).id, 'INC-01');
  assert.equal(vm.addIncident({ title: 'Fixed', resolution: 'restarted' }).id, 'INC-02');
  const { incidents, incidentsMeta } = vm.state.monitoring;
  assert.equal(incidentsMeta.total_incidents_recorded, 2);
  assert.equal(incidentsMeta.open_incidents, 1);
  assert.equal(incidents[1].status, 'resolved');
  assert.equal(incidents[0].rootCause, 'disk full');
  assert.equal(incidents[0].runbook, 'df -h\nrm tmp');
});

test('statuses: backlog is read as hold, hold keeps a note, todo is the default', () => {
  const { vm, dir } = freshVault();
  vm.createProject({ name: 'Alpha' });
  assert.equal(vm.createTask('alpha', { title: 'default' }), 'TSK-001');
  assert.equal(vm.state.projects.alpha.tasks[0].status, 'todo');

  // legacy file written by a head session before the rename
  const file = path.join(dir, 'projects/alpha/tasks.md');
  fs.appendFileSync(file, '\n---\n\n### TSK-050: legacy\n- **status**: backlog\n- **priority**: low\n');
  vm.loadAll();
  assert.equal(vm.state.projects.alpha.tasks[1].status, 'hold');

  assert.ok(vm.updateTaskStatus('alpha', 'TSK-001', 'hold', 'waiting on $& vendor'));
  assert.ok(vm.updateTaskStatus('alpha', 'TSK-001', 'hold', 'second note')); // replaces, no duplicate line
  const t = vm.state.projects.alpha.tasks[0];
  assert.equal(t.status, 'hold');
  assert.equal(t.note, 'second note');
  assert.equal((fs.readFileSync(file, 'utf8').match(/\*\*note\*\*/g) || []).length, 1);
  assert.equal(vm.updateTaskStatus('alpha', 'TSK-001', 'nonsense'), false);

  assert.ok(vm.updateTaskStatus('alpha', 'TSK-001', 'upcoming'));
  assert.equal(vm.state.projects.alpha.tasks[0].status, 'upcoming');
});

test('done tasks get a first-seen date that is dropped if they are reopened', () => {
  const { vm } = freshVault();
  vm.createProject({ name: 'Alpha' });
  vm.createTask('alpha', { title: 'finish me' });
  assert.equal(vm.state.projects.alpha.tasks[0].doneAt, undefined);

  vm.updateTaskStatus('alpha', 'TSK-001', 'done');
  assert.match(vm.state.projects.alpha.tasks[0].doneAt, /^\d{4}-\d{2}-\d{2}$/);

  vm.updateTaskStatus('alpha', 'TSK-001', 'todo');
  assert.equal(vm.state.projects.alpha.tasks[0].doneAt, undefined);
});

test('company-level expense lands in the overhead table and the consolidated burn', () => {
  const { vm } = freshVault();
  vm.addOverhead({ service: 'Domain renewal', provider: 'GoDaddy', cost: '1200' });
  assert.equal(vm.state.finances.tables.overheads.length, 1);
  assert.equal(vm.state.finances.meta.total_monthly_expenses, 1200);
});
