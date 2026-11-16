import React, { useState } from 'react';
import {
  TrendingUp,
  Server,
  ArrowUpRight,
  DollarSign,
  Activity,
  ChevronRight,
  CheckCircle2,
  Circle
} from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

const formatINR = (val) =>
  val === null || val === undefined || val === '' ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(val) || 0);

// Compact lakh / crore label for the ARR line.
const formatCompact = (val) => {
  if (val === null || val === undefined || val === '') return '—';
  const n = Number(val) || 0;
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return formatINR(n);
};

function Empty({ children }) {
  return <div className="py-10 text-center text-xs text-bhodix-textSubtle font-mono">{children}</div>;
}

export default function ExecutiveView({ setCurrentView }) {
  const { vault, health, setSelectedProject, projectList, daysToLaunch, launchStr, getAllTasks } = useVault();
  const [showCustomize, setShowCustomize] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showWorkPanel, setShowWorkPanel] = useState(() => localStorage.getItem('bhodix_home_work') !== 'false');

  const company = vault?.company?.metadata || {};
  const finances = vault?.finances?.meta || {};
  const endpoints = vault?.monitoring?.endpoints || [];
  const metrics = Object.values(health?.metrics || {});
  const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const today = dateKey(new Date());
  const nextWeek = dateKey(new Date(Date.now() + 7 * 86400000));
  const tasks = getAllTasks();
  const openTasks = tasks.filter((task) => task.status !== 'done');
  const dueTasks = openTasks.filter((task) => task.dueDate && task.dueDate <= nextWeek).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const setupSteps = [
    ['Create a project', projectList.length > 0],
    ['Set a launch target', !!launchStr],
    ['Record feature readiness', projectList.some(({ id }) => (vault?.projects?.[id]?.features || []).some((feature) => feature.readiness))],
    ['Add a task due date', tasks.some((task) => task.dueDate)]
  ];

  const milestones = (vault?.company?.content || '')
    .split('\n')
    .map((l) => l.trim().match(/^- \[( |x)\]\s+(.*)$/))
    .filter(Boolean)
    .map((m) => ({ done: m[1] === 'x', text: m[2] }));
  const milestonesDone = milestones.filter((m) => m.done).length;

  const cashFlowData = (vault?.finances?.tables?.cashFlowHistory || []).map((row) => ({
    month: row.month,
    revenue: parseInt(row.total_revenue__inr_ || '0', 10),
    costs: parseInt(row.total_costs__inr_ || '0', 10),
    profit: parseInt(row.net_profit__inr_ || '0', 10)
  }));

  // Live uptime/latency straight from the health daemon.
  const checked = metrics.filter((m) => m.checks > 0);
  const upCount = metrics.filter((m) => m.currentStatus === 'operational').length;
  const avgUptime = checked.length ? checked.reduce((s, m) => s + m.uptimePct, 0) / checked.length : null;
  const avgLatency = checked.length ? Math.round(checked.reduce((s, m) => s + m.lastLatency, 0) / checked.length) : null;

  const launchBadge =
    daysToLaunch === null ? 'NO LAUNCH DATE SET'
      : daysToLaunch > 0 ? `COUNTDOWN: ${daysToLaunch} ${daysToLaunch === 1 ? 'DAY' : 'DAYS'} TO PRODUCTION`
        : 'LAUNCH DATE REACHED';

  const handleOpenProject = (projId) => {
    if (setCurrentView('projects') !== false) setSelectedProject(projId);
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto transition-colors">
      {/* Launch banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-950/20 via-bhodix-card to-bhodix-card border border-indigo-500/30 p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold tracking-wide bg-amber-500/10 text-amber-500 dark:text-amber-300 border border-amber-500/20">
                {launchBadge}
              </span>
              {launchStr && (
                <span className="text-xs font-mono text-bhodix-textSubtle">Target Date: {launchStr}</span>
              )}
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-bhodix-text tracking-tight">
              {company.company || 'Bhodhix Softwares'}
            </h1>
            <p className="text-xs text-bhodix-textMuted max-w-2xl leading-relaxed">
              {company.current_phase || 'Set current_phase in vault/company.md to show the current phase here.'}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setCurrentView('planner')}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-md flex items-center gap-2"
            >
              <span>View Sprints</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setCurrentView('vault')}
              className="px-4 py-2.5 rounded-xl bg-bhodix-surface hover:bg-bhodix-hover text-bhodix-text text-xs font-medium border border-bhodix-border transition-colors"
            >
              Documents
            </button>
          </div>
        </div>

        {milestones.length > 0 && (
          <div className="mt-5 pt-5 border-t border-bhodix-borderSubtle space-y-2">
            <div className="text-[10px] font-mono uppercase text-bhodix-textSubtle">
              Launch milestones — {milestonesDone} / {milestones.length} done
            </div>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
              {milestones.map((m, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-bhodix-textMuted">
                  {m.done
                    ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-500 shrink-0" />
                    : <Circle className="w-3.5 h-3.5 mt-0.5 text-bhodix-textSubtle shrink-0" />}
                  <span className={m.done ? 'line-through opacity-60' : ''}>{m.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bhodix-border bg-bhodix-card px-4 py-3 shadow-sm">
        <div><div className="text-xs font-semibold text-bhodix-text">Your workspace</div><div className="mt-0.5 text-[10px] text-bhodix-textSubtle">{dueTasks.length} due soon · {openTasks.length} open tasks</div></div>
        <div className="flex gap-2"><button onClick={() => { const next = !showWorkPanel; setShowWorkPanel(next); try { localStorage.setItem('bhodix_home_work', String(next)); } catch { /* storage unavailable */ } }} className="rounded-lg border border-bhodix-border px-3 py-1.5 text-[10px] text-bhodix-textMuted">{showWorkPanel ? 'Hide work panel' : 'Show work panel'}</button><button onClick={() => setShowCustomize((open) => !open)} className="rounded-lg border border-bhodix-border px-3 py-1.5 text-[10px] text-bhodix-textMuted">Customize</button><button onClick={() => setShowHelp((open) => !open)} className="rounded-lg border border-bhodix-border px-3 py-1.5 text-[10px] text-bhodix-textMuted">Help</button></div>
      </div>
      {showCustomize && <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 text-xs text-bhodix-textMuted"><strong className="text-bhodix-text">Home preferences</strong><p className="mt-1">Show or hide the open-work summary. Portfolio and finance cards follow the selected project filter.</p></div>}
      {showHelp && <div className="rounded-xl border border-bhodix-border bg-bhodix-card p-4 text-xs text-bhodix-textMuted"><strong className="text-bhodix-text">Quick help</strong><p className="mt-1">Choose a view from the left rail. Use Ctrl+K to search projects, tasks, features, and documents. The header project selector filters project-specific views.</p></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-bhodix-border bg-bhodix-card p-5 shadow-sm"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold text-bhodix-text">Setup guide</h2><span className="font-mono text-[10px] text-indigo-500">{setupSteps.filter((step) => step[1]).length}/{setupSteps.length} complete</span></div><div className="space-y-2">{setupSteps.map(([label, done]) => <div key={label} className="flex items-center gap-2 text-xs"><span className={done ? 'text-emerald-500' : 'text-bhodix-textSubtle'}>{done ? '✓' : '○'}</span><span className={done ? 'text-bhodix-textMuted' : 'text-bhodix-text'}>{label}</span></div>)}</div><p className="mt-3 text-[10px] text-bhodix-textSubtle">Setup hints use existing vault data and never fill values automatically.</p></section>
        {showWorkPanel && <section className="rounded-2xl border border-bhodix-border bg-bhodix-card p-5 shadow-sm"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold text-bhodix-text">Due soon</h2><button onClick={() => setCurrentView('planner')} className="text-[10px] text-indigo-500">Open planner →</button></div>{dueTasks.length ? <div className="space-y-2">{dueTasks.slice(0, 5).map((task) => <button key={task.id} onClick={() => { localStorage.setItem('bhodix_task_to_open', JSON.stringify({ projectId: task.project, taskId: task.id })); setSelectedProject(task.project); setCurrentView('planner'); }} className="flex w-full items-center justify-between gap-3 rounded-lg bg-bhodix-surface px-3 py-2 text-left"><span className="min-w-0 truncate text-xs text-bhodix-text">{task.title}</span><span className={`shrink-0 font-mono text-[10px] ${task.dueDate < today ? 'text-rose-500' : 'text-amber-500'}`}>{task.dueDate < today ? 'Overdue' : task.dueDate}</span></button>)}</div> : <p className="text-xs text-bhodix-textSubtle">No open tasks due in the next week.</p>}</section>}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-bhodix-card border border-bhodix-border rounded-xl p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-bhodix-textSubtle uppercase tracking-wider">Consolidated MRR</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold font-mono tracking-tight text-bhodix-text">{formatINR(finances.consolidated_mrr)}</div>
          <div className="text-xs text-bhodix-textSubtle flex items-center justify-between">
            <span>Annualised (ARR)</span>
            <span className="font-mono text-emerald-500 dark:text-emerald-400 font-semibold">{formatCompact(finances.consolidated_arr)}</span>
          </div>
        </div>

        <div className="bg-bhodix-card border border-bhodix-border rounded-xl p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-bhodix-textSubtle uppercase tracking-wider">Monthly Burn</span>
            <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500">
              <Server className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold font-mono tracking-tight text-bhodix-text">{formatINR(finances.total_monthly_expenses)}</div>
          <div className="text-xs text-bhodix-textSubtle">App infra + shared overheads</div>
        </div>

        <div className="bg-bhodix-card border border-bhodix-border rounded-xl p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-bhodix-textSubtle uppercase tracking-wider">Net Monthly Profit</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold font-mono tracking-tight text-bhodix-text">{formatINR(finances.net_monthly_profit)}</div>
          <div className="text-xs text-bhodix-textSubtle flex items-center justify-between">
            <span>Operating Margin</span>
            <span className="font-mono text-indigo-500 dark:text-indigo-400 font-semibold">{finances.net_margin_percentage === null || finances.net_margin_percentage === undefined || finances.net_margin_percentage === '' ? '—' : `${finances.net_margin_percentage}%`}</span>
          </div>
        </div>

        <div className="bg-bhodix-card border border-bhodix-border rounded-xl p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-bhodix-textSubtle uppercase tracking-wider">System Uptime</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold font-mono tracking-tight text-bhodix-text">
            {avgUptime === null ? '—' : `${avgUptime.toFixed(2)}%`}
          </div>
          <div className="text-xs text-bhodix-textSubtle flex items-center justify-between">
            <span>{endpoints.length} monitored · {upCount} up</span>
            <span className="font-mono text-bhodix-textMuted font-medium">{avgLatency === null ? '' : `Avg ${avgLatency}ms`}</span>
          </div>
        </div>
      </div>

      {/* Project cards */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-bhodix-textSubtle font-mono">Platforms</h2>

        {projectList.length === 0 ? (
          <Empty>No projects yet — use the + next to the project selector in the header.</Empty>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {projectList.map(({ id, name }) => {
              const proj = vault.projects[id];
              const meta = proj.meta || {};
              const fin = proj.finances?.meta || {};
              const features = proj.features || [];
              const live = features.filter((f) => f.status?.toLowerCase() === 'live').length;
              const tasks = proj.tasks || [];
              const doneTasks = tasks.filter((t) => t.status === 'done').length;
              const pct = features.length ? Math.round((live / features.length) * 100) : 0;

              return (
                <div key={id} className="bg-bhodix-card border border-bhodix-border hover:border-bhodix-borderHover rounded-2xl p-6 transition-all space-y-5 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-bhodix-text tracking-tight">{name}</span>
                        {meta.category && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border border-indigo-500/20 font-mono font-medium uppercase">
                            {meta.category}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-bhodix-textMuted mt-1">{meta.tagline}</p>
                    </div>
                    <button
                      onClick={() => handleOpenProject(id)}
                      className="p-2 rounded-lg bg-bhodix-surface hover:bg-bhodix-hover border border-bhodix-border text-bhodix-text transition-colors"
                      title={`Open ${name}`}
                    >
                      <ArrowUpRight className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-3 p-3 rounded-xl bg-bhodix-surface border border-bhodix-borderSubtle text-center">
                    <div>
                      <div className="text-[10px] font-mono text-bhodix-textSubtle">Monthly Inflow</div>
                      <div className="text-sm font-bold font-mono text-bhodix-text mt-0.5">{formatINR(fin.monthly_gross_revenue)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono text-bhodix-textSubtle">Infra Burn</div>
                      <div className="text-sm font-bold font-mono text-bhodix-textMuted mt-0.5">{formatINR(fin.monthly_total_expenses)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono text-bhodix-textSubtle">Net Margin</div>
                      <div className="text-sm font-bold font-mono text-emerald-500 dark:text-emerald-400 mt-0.5">
                        {fin.monthly_gross_revenue > 0 ? `${fin.net_margin_percentage}%` : '—'}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-bhodix-textMuted">Features Live</span>
                      <span className="font-mono text-bhodix-text font-medium">{live} / {features.length}</span>
                    </div>
                    <div className="w-full bg-bhodix-surface rounded-full h-1.5 overflow-hidden">
                      <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  <div className="pt-3 border-t border-bhodix-border flex items-center justify-between text-xs text-bhodix-textSubtle">
                    <span>Tasks: {doneTasks} / {tasks.length} done</span>
                    <span className="font-mono text-amber-500 dark:text-amber-300">{meta.stage || 'Stage not set'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Revenue chart */}
      <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-6 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-bhodix-text tracking-tight">Financial Trajectory</h2>
            <p className="text-xs text-bhodix-textMuted mt-0.5">
              From the cash-flow table in <code className="font-mono text-indigo-500">finances/bhodix-ledger.md</code>
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono">
            <span className="flex items-center gap-1.5 text-indigo-500 dark:text-indigo-400">
              <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" /> Revenue
            </span>
            <span className="flex items-center gap-1.5 text-emerald-500 dark:text-emerald-400">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Net Profit
            </span>
            <span className="flex items-center gap-1.5 text-rose-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" /> Costs
            </span>
          </div>
        </div>

        {cashFlowData.length === 0 ? (
          <Empty>No cash-flow data yet. Add monthly rows to the ledger to see the trend.</Empty>
        ) : (
          <div className="h-64 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cashFlowData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorProf" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--bhodix-border)" vertical={false} />
                <XAxis dataKey="month" stroke="var(--bhodix-text-subtle)" fontSize={11} tickLine={false} />
                <YAxis
                  stroke="var(--bhodix-text-subtle)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(val) => `₹${val / 1000}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bhodix-surface)',
                    borderColor: 'var(--bhodix-border)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: 'var(--bhodix-text)'
                  }}
                  formatter={(val) => [`₹${Number(val).toLocaleString('en-IN')}`, '']}
                />
                <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorRev)" name="Revenue" />
                <Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorProf)" name="Net Profit" />
                <Area type="monotone" dataKey="costs" stroke="#ef4444" strokeWidth={1.5} fillOpacity={0} name="Costs" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
