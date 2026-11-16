import React, { useState, useEffect } from 'react';
import {
  Activity,
  RefreshCw,
  Terminal,
  Copy,
  Check,
  Radio,
  Cpu,
  Database,
  ArrowUpRight,
  AlertTriangle,
  Trash2
} from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { useToast } from '../components/ToastProvider';
import useDialogFocus from '../lib/useDialogFocus';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';

const SWEEP_SECONDS = 20;
const MAX_CHART_SERIES = 6;
const SERIES_COLORS = ['#6366f1', '#10b981', '#3b82f6', '#14b8a6', '#f59e0b', '#ec4899'];

const isHttp = (url = '') => /^https?:\/\//i.test(url);

const protocolOf = (url = '') => {
  if (isHttp(url)) return url.toLowerCase().startsWith('https') ? 'HTTPS' : 'HTTP';
  const scheme = url.split('://')[0];
  return scheme ? `TCP / ${scheme.toUpperCase()}` : '—';
};

const STATUS_STYLES = {
  operational: 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20',
  degraded: 'bg-amber-500/10 text-amber-500 dark:text-amber-300 border border-amber-500/20',
  down: 'bg-rose-500/10 text-rose-500 border border-rose-500/20',
  unknown: 'bg-slate-500/10 text-slate-500 border border-slate-500/20'
};

export default function MonitorView() {
  const { vault, health, connected, triggerHealthCheck, selectedProject, addIncident, apiFetch, projectList, user } = useVault();
  const [refreshing, setRefreshing] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [selectedEndpointForDiag, setSelectedEndpointForDiag] = useState(null);
  const [filterType, setFilterType] = useState('all'); // 'all', 'http', 'tcp'
  const [countdown, setCountdown] = useState(SWEEP_SECONDS);
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortServices, setSortServices] = useState('status');
  const [selectedSeriesIds, setSelectedSeriesIds] = useState([]);
  const [incidentEndpoint, setIncidentEndpoint] = useState(null);
  const [incidentDraft, setIncidentDraft] = useState({ title: '', severity: 'High', rootCause: '' });
  const [incidentFilter, setIncidentFilter] = useState('all');
  const [incidentSearch, setIncidentSearch] = useState('');
  const [alertsEnabled, setAlertsEnabled] = useState(() => localStorage.getItem('bhodix_health_alerts') !== 'false');
  const [savingIncident, setSavingIncident] = useState(false);
  const [databaseDraft, setDatabaseDraft] = useState({ name: '', project: '', connectionString: '' });
  const [savingDatabase, setSavingDatabase] = useState(false);
  const [checkingDatabases, setCheckingDatabases] = useState(false);
  const { showToast } = useToast();
  const endpointDialogRef = useDialogFocus(!!selectedEndpointForDiag);
  const incidentDialogRef = useDialogFocus(!!incidentEndpoint);
  const [terminalLog, setTerminalLog] = useState(['[*] Health daemon connected. Local/TCP targets are probed every 20s, public web endpoints every 5 min.']);

  const endpoints = vault?.monitoring?.endpoints || [];
  const databaseChecks = (health?.databases || []).filter((item) => selectedProject === 'all' || item.project === selectedProject);
  const canManageDatabases = ['owner', 'admin'].includes(user?.role);
  const metrics = health?.metrics || {};
  const incidents = vault?.monitoring?.incidents || [];
  const openIncidents = vault?.monitoring?.incidentsMeta?.open_incidents || 0;

  const metricFor = (ep) => metrics[ep.id || ep.name];

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? SWEEP_SECONDS : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!databaseDraft.project && projectList.length) setDatabaseDraft((draft) => ({ ...draft, project: projectList[0].id }));
  }, [databaseDraft.project, projectList]);

  const refreshDatabaseChecks = async () => {
    const response = await apiFetch('/api/monitoring/status');
    const data = await response.json();
    if (response.ok && data.success) window.dispatchEvent(new CustomEvent('bhodhix:database-status', { detail: data.data }));
  };

  const saveDatabaseMonitor = async (event) => {
    event.preventDefault(); setSavingDatabase(true);
    try {
      const response = await apiFetch('/api/monitoring/databases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(databaseDraft) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not add database monitor');
      setDatabaseDraft((draft) => ({ ...draft, name: '', connectionString: '' }));
      showToast('Database monitor added; checking connection', 'success');
      await refreshDatabaseChecks();
    } catch (error) { showToast(error.message || 'Could not add database monitor', 'error'); }
    finally { setSavingDatabase(false); }
  };

  const checkDatabases = async () => {
    setCheckingDatabases(true);
    try {
      const response = await apiFetch('/api/monitoring/databases/check-now', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not check database connections');
      window.dispatchEvent(new CustomEvent('bhodhix:database-status', { detail: { databases: data.results } }));
    } catch (error) { showToast(error.message || 'Could not check databases', 'error'); }
    finally { setCheckingDatabases(false); }
  };

  const removeDatabaseMonitor = async (item) => {
    if (!window.confirm(`Remove monitoring for ${item.name}?`)) return;
    const response = await apiFetch(`/api/monitoring/databases/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok || !data.success) return showToast(data.error || 'Could not remove monitor', 'error');
    await refreshDatabaseChecks(); showToast('Database monitor removed', 'success');
  };

  useEffect(() => {
    const closeDialogs = (e) => {
      if (e.key === 'Escape') { setSelectedEndpointForDiag(null); setIncidentEndpoint(null); }
    };
    window.addEventListener('keydown', closeDialogs);
    return () => window.removeEventListener('keydown', closeDialogs);
  }, []);

  const log = (line) =>
    setTerminalLog((prev) => [`[${new Date().toLocaleTimeString()}] ${line}`, ...prev.slice(0, 40)]);

  const describe = (m) =>
    `${m.name}: ${m.currentStatus.toUpperCase()} ${m.statusCode ? `HTTP ${m.statusCode} ` : ''}${m.lastLatency}ms${m.error ? ` — ${m.error}` : ''}`;

  const handleSweep = async () => {
    setRefreshing(true);
    log(`Sweeping ${endpoints.length} endpoint(s)...`);
    const data = await triggerHealthCheck();
    setCountdown(SWEEP_SECONDS);
    (data?.results || []).forEach((m) => log(describe(m)));
    setRefreshing(false);
  };

  const copyToClipboard = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const filteredEndpoints = endpoints.filter((ep) => {
    const matchesProject = selectedProject === 'all' || ep.project?.toLowerCase() === selectedProject.toLowerCase();
    const matchesType = filterType === 'all' || (filterType === 'http' ? isHttp(ep.url) : !isHttp(ep.url));
    const metric = metricFor(ep);
    const matchesStatus = filterStatus === 'all' || (metric?.currentStatus || 'unknown') === filterStatus;
    return matchesProject && matchesType && matchesStatus;
  }).sort((a, b) => {
    const ma = metricFor(a);
    const mb = metricFor(b);
    if (sortServices === 'latency') return (mb?.lastLatency ?? -1) - (ma?.lastLatency ?? -1);
    if (sortServices === 'name') return a.name.localeCompare(b.name);
    const order = { down: 0, degraded: 1, unknown: 2, operational: 3 };
    return (order[ma?.currentStatus || 'unknown'] ?? 2) - (order[mb?.currentStatus || 'unknown'] ?? 2) || a.name.localeCompare(b.name);
  });

  // Live aggregates from real probe results
  const checked = endpoints.map(metricFor).filter((m) => m && m.checks > 0);
  const operationalCount = checked.filter((m) => m.currentStatus === 'operational').length;
  const downCount = checked.filter((m) => m.currentStatus === 'down').length;
  const degradedCount = checked.filter((m) => m.currentStatus === 'degraded').length;
  const avgLatency = checked.length ? Math.round(checked.reduce((s, m) => s + m.lastLatency, 0) / checked.length) : null;
  const availability = checked.length ? checked.reduce((s, m) => s + m.uptimePct, 0) / checked.length : null;

  let banner = { label: 'NO ENDPOINTS MONITORED', dot: 'bg-slate-400' };
  if (endpoints.length > 0 && checked.length === 0) banner = { label: 'WAITING FOR FIRST SWEEP', dot: 'bg-slate-400' };
  else if (downCount > 0) banner = { label: `${downCount} SERVICE${downCount > 1 ? 'S' : ''} DOWN`, dot: 'bg-rose-500' };
  else if (degradedCount > 0) banner = { label: `${degradedCount} SERVICE${degradedCount > 1 ? 'S' : ''} DEGRADED`, dot: 'bg-amber-500' };
  else if (checked.length > 0) banner = { label: 'ALL SERVICES OPERATIONAL', dot: 'bg-emerald-500' };

  // Latency timeline: one line per endpoint, built from the daemon's rolling history.
  const chartCandidates = filteredEndpoints.map(metricFor).filter((m) => m?.history?.length);
  const series = (selectedSeriesIds.length ? chartCandidates.filter((m) => selectedSeriesIds.includes(m.id)) : chartCandidates.slice(0, MAX_CHART_SERIES));
  const longest = series.reduce((n, m) => Math.max(n, m.history.length), 0);
  const timelineData = Array.from({ length: longest }, (_, i) => {
    const point = {};
    series.forEach((m) => {
      const h = m.history[m.history.length - longest + i];
      if (h) {
        point.time = point.time || h.time;
        point[m.id] = h.latency;
      }
    });
    return point;
  });

  const submitIncident = async (e) => {
    e.preventDefault();
    if (!incidentDraft.title.trim() || !incidentDraft.rootCause.trim()) return;
    setSavingIncident(true);
    const ok = await addIncident({ ...incidentDraft, status: 'open' });
    setSavingIncident(false);
    showToast(ok ? 'Incident logged' : 'Could not log incident', ok ? 'success' : 'error');
    if (ok) setIncidentEndpoint(null);
    log(ok ? `Incident logged: ${incidentDraft.title}` : `Could not log incident: ${incidentDraft.title}`);
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto transition-colors">
      {/* 1. Fleet status */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-bhodix-card via-bhodix-surface to-bhodix-card border border-bhodix-border p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className={`inline-flex rounded-full h-3 w-3 ${banner.dot}`} />
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-bhodix-surface text-bhodix-text border border-bhodix-border">
                {banner.label}
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-bhodix-text">Server Health & Uptime</h1>
            <p className="text-xs text-bhodix-textMuted max-w-2xl leading-relaxed">
              The local health daemon probes every service listed in{' '}
              <code className="text-indigo-500 font-mono">vault/monitoring/endpoints.md</code> every {SWEEP_SECONDS} seconds; public web endpoints (free-tier hosting) only every 5 minutes, and need two failed probes in a row before showing down.
              HTTP(S) targets are checked by status code; TCP targets (redis, postgresql, sftp) by port reachability.
            </p>
            <div className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[10px] font-mono ${connected ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-500' : 'border-amber-500/20 bg-amber-500/5 text-amber-500'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {connected ? 'Live health updates connected' : 'Live updates disconnected · showing last received status'}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="px-3 py-2 rounded-xl bg-bhodix-surface border border-bhodix-borderSubtle text-right">
              <span className="text-[10px] font-mono text-bhodix-textSubtle block uppercase">Next Automated Sweep</span>
              <span className="text-sm font-bold font-mono text-indigo-500 dark:text-indigo-400">{countdown}s</span>
            </div>
            <button
              onClick={handleSweep}
              disabled={refreshing || endpoints.length === 0}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-md shadow-indigo-600/20 flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? 'Sweeping...' : 'Sweep All Endpoints'}</span>
            </button>
            <button aria-pressed={alertsEnabled} onClick={() => { const next = !alertsEnabled; setAlertsEnabled(next); try { localStorage.setItem('bhodix_health_alerts', String(next)); } catch { /* storage unavailable */ } }} className="rounded-xl border border-bhodix-border bg-bhodix-surface px-3 py-2 text-[10px] text-bhodix-textMuted">Alerts {alertsEnabled ? 'on' : 'off'}</button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-bhodix-borderSubtle">
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-bhodix-textSubtle uppercase">Availability</span>
            <div className="text-lg font-bold font-mono text-bhodix-text">{availability === null ? '—' : `${availability.toFixed(2)}%`}</div>
            <div className="text-[10px] text-bhodix-textSubtle">Since the engine started</div>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-bhodix-textSubtle uppercase">Average Latency</span>
            <div className="text-lg font-bold font-mono text-bhodix-text">{avgLatency === null ? '—' : `${avgLatency} ms`}</div>
            <div className="text-[10px] text-bhodix-textSubtle">Last sweep</div>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-bhodix-textSubtle uppercase">Nodes Online</span>
            <div className="text-lg font-bold font-mono text-bhodix-text">{operationalCount} / {endpoints.length}</div>
            <div className="text-[10px] text-bhodix-textSubtle">{downCount} down · {degradedCount} degraded</div>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-bhodix-textSubtle uppercase">Open Incidents</span>
            <div className="text-lg font-bold font-mono text-bhodix-text">{openIncidents}</div>
            <div className="text-[10px] text-bhodix-textSubtle">{incidents.length} recorded in total</div>
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-bhodix-border bg-bhodix-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-semibold text-bhodix-text"><Database className="h-4 w-4 text-indigo-400" />PostgreSQL database checks</h2><p className="mt-1 text-xs text-bhodix-textSubtle">Periodic read-only `SELECT 1` checks. Connection strings are encrypted on the server and never shown again.</p></div>{canManageDatabases && <button onClick={checkDatabases} disabled={checkingDatabases || !databaseChecks.length} className="rounded-lg border border-bhodix-border px-3 py-2 text-xs text-bhodix-textMuted disabled:opacity-50">{checkingDatabases ? 'Checking…' : 'Check now'}</button>}</div>
        {canManageDatabases && <form onSubmit={saveDatabaseMonitor} className="grid gap-2 lg:grid-cols-[1fr_1fr_2fr_auto]"><input required maxLength={100} value={databaseDraft.name} onChange={(event) => setDatabaseDraft({ ...databaseDraft, name: event.target.value })} placeholder="Database name" className="rounded-lg border border-bhodix-border bg-bhodix-surface px-3 py-2 text-xs text-bhodix-text" /><select required value={databaseDraft.project} onChange={(event) => setDatabaseDraft({ ...databaseDraft, project: event.target.value })} className="rounded-lg border border-bhodix-border bg-bhodix-surface px-3 py-2 text-xs text-bhodix-text"><option value="">Choose project</option>{projectList.map((project) => <option key={project.id} value={project.id}>{project.name || project.id}</option>)}</select><input required type="password" autoComplete="new-password" value={databaseDraft.connectionString} onChange={(event) => setDatabaseDraft({ ...databaseDraft, connectionString: event.target.value })} placeholder="postgresql://user:password@host:5432/database?sslmode=require" className="min-w-0 rounded-lg border border-bhodix-border bg-bhodix-surface px-3 py-2 font-mono text-xs text-bhodix-text" /><button disabled={savingDatabase || !projectList.length} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{savingDatabase ? 'Adding…' : 'Add database'}</button></form>}
        {health.databaseMonitoringConfigured === false && canManageDatabases && <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-[11px] text-amber-200">Database monitoring needs a server encryption key. Restart Bhodhix after configuring `CONNECTOR_TOKEN_ENCRYPTION_KEY` (the desktop app creates a local key automatically).</p>}
        <div className="grid gap-2 md:grid-cols-2">{databaseChecks.map((item) => <article key={item.id} className="flex items-center gap-3 rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-3"><Database className="h-4 w-4 shrink-0 text-indigo-400" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-bhodix-text">{item.name} <span className="font-normal text-bhodix-textSubtle">· {item.project}</span></p><p className="mt-1 text-[10px] text-bhodix-textSubtle">{item.message} · {item.latencyMs || 0} ms{item.checkedAt ? ` · ${new Date(item.checkedAt).toLocaleTimeString()}` : ''}</p></div><span className={`rounded-full px-2 py-1 text-[9px] uppercase ${STATUS_STYLES[item.status] || STATUS_STYLES.unknown}`}>{item.status}</span>{canManageDatabases && <button onClick={() => removeDatabaseMonitor(item)} aria-label={`Remove ${item.name}`} className="rounded p-1.5 text-rose-400 hover:bg-rose-500/10"><Trash2 className="h-3.5 w-3.5" /></button>}</article>)}</div>
        {!databaseChecks.length && <p className="text-xs text-bhodix-textSubtle">No database monitors are configured for this project.</p>}
      </section>

      {/* 2. Latency chart (real history) */}
      <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-6 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-bhodix-text tracking-tight flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-500" />
              Response Latency (ms, last {longest || 0} sweeps)
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
            {series.map((m, i) => (
              <span key={m.id} className="flex items-center gap-1.5" style={{ color: SERIES_COLORS[i] }}>
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: SERIES_COLORS[i] }} /> {m.name}
              </span>
            ))}
          </div>
        </div>
        {chartCandidates.length > MAX_CHART_SERIES && (
          <div className="flex flex-wrap items-center gap-2 border-t border-bhodix-borderSubtle pt-3">
            <span className="text-[10px] text-bhodix-textSubtle">Chart endpoints:</span>
            {chartCandidates.map((m) => {
              const selected = selectedSeriesIds.length ? selectedSeriesIds.includes(m.id) : chartCandidates.slice(0, MAX_CHART_SERIES).some((candidate) => candidate.id === m.id);
              return <button key={m.id} aria-pressed={selected} onClick={() => setSelectedSeriesIds((prev) => {
                const current = prev.length ? prev : chartCandidates.slice(0, MAX_CHART_SERIES).map((item) => item.id);
                if (current.includes(m.id)) return current.filter((id) => id !== m.id);
                return current.length < MAX_CHART_SERIES ? [...current, m.id] : current;
              })} className={`rounded-md border px-2 py-1 text-[10px] ${selected ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-500' : 'border-bhodix-border text-bhodix-textSubtle'}`}>{m.name}</button>;
            })}
          </div>
        )}

        {timelineData.length === 0 ? (
          <div className="py-10 text-center text-xs text-bhodix-textSubtle font-mono">
            {endpoints.length === 0
              ? 'Add endpoints to vault/monitoring/endpoints.md to start monitoring.'
              : 'Waiting for the first sweep to complete...'}
          </div>
        ) : (
          <div className="h-56 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timelineData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--bhodix-border)" vertical={false} />
                <XAxis dataKey="time" stroke="var(--bhodix-text-subtle)" fontSize={11} tickLine={false} />
                <YAxis stroke="var(--bhodix-text-subtle)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}ms`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bhodix-surface)',
                    borderColor: 'var(--bhodix-border)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: 'var(--bhodix-text)'
                  }}
                  formatter={(val) => [`${val} ms`, '']}
                />
                {series.map((m, i) => (
                  <Line key={m.id} type="monotone" dataKey={m.id} name={m.name} stroke={SERIES_COLORS[i]} strokeWidth={2} dot={false} connectNulls={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* 3. Service cards */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-sm font-bold text-bhodix-text tracking-tight uppercase font-mono">
            Monitored Services ({filteredEndpoints.length})
          </h2>

          <div className="flex items-center bg-bhodix-card border border-bhodix-border rounded-lg p-0.5 text-xs font-medium">
            {[['all', 'All'], ['http', 'Web & APIs'], ['tcp', 'TCP / DB']].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilterType(key)}
                className={`px-3 py-1 rounded-md transition-all ${filterType === key ? 'bg-indigo-600 text-white font-medium shadow-sm' : 'text-bhodix-textMuted hover:text-bhodix-text'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} aria-label="Filter services by status" className="rounded-lg border border-bhodix-border bg-bhodix-card px-2 py-1.5 text-xs text-bhodix-text"><option value="all">All statuses</option><option value="operational">Operational</option><option value="degraded">Degraded</option><option value="down">Down</option><option value="unknown">Not checked</option></select>
            <select value={sortServices} onChange={(e) => setSortServices(e.target.value)} aria-label="Sort services" className="rounded-lg border border-bhodix-border bg-bhodix-card px-2 py-1.5 text-xs text-bhodix-text"><option value="status">Issues first</option><option value="latency">Latency</option><option value="name">Name</option></select>
          </div>
        </div>

        {filteredEndpoints.length === 0 && (
          <div className="py-10 text-center text-xs text-bhodix-textSubtle font-mono">No services to show.</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {filteredEndpoints.map((ep) => {
            const id = ep.id || ep.name;
            const m = metricFor(ep);
            const status = m?.currentStatus || 'unknown';
            const isPinging = refreshing;
            const lastChecked = m?.lastChecked ? new Date(m.lastChecked) : null;
            const lastAge = lastChecked ? Date.now() - lastChecked.getTime() : Infinity;
            const isRemoteWeb = isHttp(ep.url) && !/localhost|127\.0\.0\.1|\[::1\]/i.test(ep.url);
            const isStale = lastAge > (isRemoteWeb ? 10 * 60 * 1000 : 60 * 1000);

            return (
              <div key={id} className="bg-bhodix-card border border-bhodix-border hover:border-bhodix-borderHover rounded-xl p-5 space-y-3.5 shadow-sm transition-all">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono px-1.5 rounded bg-bhodix-surface text-indigo-500 font-semibold border border-bhodix-borderSubtle uppercase">
                        {ep.project}
                      </span>
                      <span className="text-[10px] font-mono text-bhodix-textSubtle">{ep.id}</span>
                    </div>
                    <div className="text-xs font-bold text-bhodix-text truncate max-w-[170px]" title={ep.name}>{ep.name}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wider ${STATUS_STYLES[status]}`}>
                    {status}
                  </span>
                </div>

                <div className="text-[11px] font-mono text-bhodix-textSubtle truncate bg-bhodix-surface px-2.5 py-1.5 rounded-lg border border-bhodix-borderSubtle" title={ep.url}>
                  {ep.url}
                </div>

                <div className="flex items-baseline justify-between pt-1">
                  <div>
                    <span className="text-[10px] font-mono text-bhodix-textSubtle uppercase block">Latency</span>
                    <div className="text-xl font-bold font-mono text-bhodix-text flex items-baseline gap-1 mt-0.5">
                      {m ? m.lastLatency : '—'} <span className="text-xs text-bhodix-textSubtle font-normal">ms</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-mono text-bhodix-textSubtle uppercase block">Protocol</span>
                    <span className="text-[11px] font-mono font-semibold text-bhodix-text mt-0.5 block">{protocolOf(ep.url)}</span>
                  </div>
                </div>

                {/* Recent checks: one bar per real probe */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-[10px] font-mono text-bhodix-textSubtle">
                    <span>Uptime: <strong className="text-bhodix-text">{m ? `${m.uptimePct}%` : '—'}</strong></span>
                    <span>{!m ? 'Not checked yet' : !lastChecked ? 'Check time unavailable' : isStale ? `Stale · ${lastChecked.toLocaleTimeString()}` : `Updated ${lastChecked.toLocaleTimeString()}`}</span>
                  </div>
                  <div className="flex items-center gap-[2px] w-full h-4">
                    {(m?.history || []).map((h, i) => (
                      <div
                        key={i}
                        className={`flex-1 h-full rounded-[1.5px] ${h.latency === null ? 'bg-rose-500' : 'bg-emerald-500/80'}`}
                        title={`${h.time}: ${h.latency === null ? 'failed' : `${h.latency}ms`}`}
                      />
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-bhodix-borderSubtle flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSweep}
                      disabled={isPinging}
                      title="Run a health sweep for all monitored services"
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-bhodix-surface hover:bg-bhodix-hover border border-bhodix-border text-[11px] font-mono text-bhodix-text transition-colors disabled:opacity-50"
                    >
                      <Radio className={`w-3 h-3 text-indigo-500 ${isPinging ? 'animate-pulse' : ''}`} />
                      <span>{isPinging ? 'Sweeping…' : 'Sweep all'}</span>
                    </button>
                    {status === 'down' && (
                      <button
                        onClick={() => { setIncidentDraft({ title: `Incident: ${ep.name} is DOWN`, severity: 'High', rootCause: '' }); setIncidentEndpoint(ep); }}
                        className="flex items-center gap-1 px-2 py-1 rounded-md bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-500 text-[11px] font-mono transition-colors"
                      >
                        <AlertTriangle className="w-3 h-3" />
                        <span>Log Incident</span>
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => setSelectedEndpointForDiag(ep)}
                    className="text-[11px] font-mono text-indigo-500 hover:text-indigo-400 flex items-center gap-1"
                  >
                    <span>Details</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Probe log & incidents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-6 space-y-4 shadow-sm">
          <div className="flex items-center gap-2 border-b border-bhodix-border pb-3">
            <Terminal className="w-4 h-4 text-emerald-500" />
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-bhodix-text">Probe Log</h2>
          </div>
          <div className="bg-black/80 rounded-xl p-4 font-mono text-xs text-emerald-400 space-y-1.5 h-64 overflow-y-auto border border-emerald-950/40 select-text">
            {terminalLog.map((line, idx) => (
              <div key={idx} className="leading-relaxed">{line}</div>
            ))}
          </div>
        </div>

        <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-bhodix-border pb-3">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-indigo-500" />
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-bhodix-text">Incidents & Runbooks</h2>
            </div>
            <span className="text-[10px] font-mono text-bhodix-textSubtle">{incidents.length} recorded</span>
          </div>

          <div className="flex flex-wrap gap-2"><input value={incidentSearch} onChange={(e) => setIncidentSearch(e.target.value)} placeholder="Search incidents…" aria-label="Search incidents" className="min-w-0 flex-1 rounded-lg border border-bhodix-border bg-bhodix-surface px-2 py-1.5 text-[10px] text-bhodix-text" /><select value={incidentFilter} onChange={(e) => setIncidentFilter(e.target.value)} aria-label="Filter incidents" className="rounded-lg border border-bhodix-border bg-bhodix-surface px-2 py-1.5 text-[10px] text-bhodix-text"><option value="all">All incidents</option><option value="open">Open</option><option value="resolved">Resolved</option></select></div>

          <div className="space-y-3 h-64 overflow-y-auto pr-1">
            {incidents.length === 0 && (
              <div className="py-10 text-center text-xs text-bhodix-textSubtle font-mono">No incidents recorded.</div>
            )}
            {[...incidents].reverse().filter((inc) => (incidentFilter === 'all' || inc.status === incidentFilter) && `${inc.title} ${inc.rootCause} ${inc.resolution}`.toLowerCase().includes(incidentSearch.toLowerCase())).map((inc, idx) => {
              const code = inc.content.split('```')[1]?.replace(/^bash\n/, '');
              const resolved = inc.status === 'resolved';
              return (
                <div key={inc.title} className="bg-bhodix-surface border border-bhodix-borderSubtle rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-xs text-bhodix-text">{inc.title}</span>
                    <span className={`text-[9px] font-mono px-1.5 rounded uppercase ${resolved ? STATUS_STYLES.operational : STATUS_STYLES.down}`}>
                      {inc.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-bhodix-textSubtle font-mono">{[inc.date, inc.severity].filter(Boolean).join(' · ')}</div>
                  {inc.rootCause && inc.rootCause !== '-' && (
                    <div className="text-[11px] text-bhodix-textMuted"><strong>Root cause:</strong> {inc.rootCause}</div>
                  )}
                  {inc.resolution && (
                    <div className="text-[11px] text-bhodix-textMuted"><strong>Resolution:</strong> {inc.resolution}</div>
                  )}
                  {code && (
                    <div className="relative">
                      <details className="rounded bg-black/60 p-2"><summary className="cursor-pointer text-[10px] font-mono text-indigo-300">Runbook steps ({code.split(/\r?\n/).filter(Boolean).length})</summary><ol className="mt-2 list-decimal space-y-1 pl-5 text-[10px] font-mono text-indigo-200">{code.split(/\r?\n/).filter(Boolean).map((step, stepIdx) => <li key={stepIdx} className="break-all">{step}</li>)}</ol></details>
                      <button
                        onClick={() => copyToClipboard(code, idx)}
                        className="absolute right-1.5 top-1.5 p-1 rounded bg-bhodix-card hover:bg-bhodix-hover border border-bhodix-border text-bhodix-text"
                        title="Copy runbook command"
                      >
                        {copiedIdx === idx ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 5. Endpoint details */}
      {selectedEndpointForDiag && (() => {
        const ep = selectedEndpointForDiag;
        const m = metricFor(ep);
        const rows = [
          ['Endpoint URI', ep.url],
          ['Method / Expected', `${ep.method || 'GET'} → ${ep.expected_status || '200'}`],
          ['Current status', m ? m.currentStatus : 'not checked yet'],
          ['Last HTTP status', m?.statusCode ?? '—'],
          ['Last latency', m ? `${m.lastLatency} ms` : '—'],
          ['Last checked', m?.lastChecked ? new Date(m.lastChecked).toLocaleString() : '—'],
          ['Last error', m?.error || 'none']
        ];
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div ref={endpointDialogRef} role="dialog" aria-modal="true" aria-labelledby="endpoint-details-title" className="bg-bhodix-card border border-bhodix-border rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl">
              <div className="flex items-start justify-between border-b border-bhodix-border pb-3">
                <div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 uppercase font-bold">
                    {ep.project} • {ep.id}
                  </span>
                  <h2 id="endpoint-details-title" className="text-lg font-bold text-bhodix-text mt-1">{ep.name}</h2>
                </div>
                <button onClick={() => setSelectedEndpointForDiag(null)} aria-label="Close endpoint details" className="text-bhodix-textSubtle hover:text-bhodix-text p-1">✕</button>
              </div>

              <div className="space-y-2 text-xs">
                {rows.map(([label, value]) => (
                  <div key={label} className="p-3 rounded-xl bg-bhodix-surface border border-bhodix-borderSubtle flex items-start justify-between gap-4">
                    <span className="text-[10px] font-mono text-bhodix-textSubtle uppercase shrink-0">{label}</span>
                    <span className="font-mono text-bhodix-text break-all text-right">{String(value)}</span>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-bhodix-border flex justify-end">
                <button
                  onClick={() => setSelectedEndpointForDiag(null)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {incidentEndpoint && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setIncidentEndpoint(null); }}>
          <form ref={incidentDialogRef} role="dialog" aria-modal="true" aria-labelledby="incident-title" onSubmit={submitIncident} className="bg-bhodix-card border border-bhodix-border rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div><h2 id="incident-title" className="text-base font-bold text-bhodix-text">Log incident</h2><p className="text-xs text-bhodix-textSubtle mt-1">For {incidentEndpoint.name}</p></div>
            <label className="block text-xs text-bhodix-textMuted">Title *<input required autoFocus value={incidentDraft.title} onChange={(e) => setIncidentDraft({ ...incidentDraft, title: e.target.value })} className="mt-1 w-full rounded-lg border border-bhodix-border bg-bhodix-surface p-2.5 text-bhodix-text" /></label>
            <label className="block text-xs text-bhodix-textMuted">Severity<select value={incidentDraft.severity} onChange={(e) => setIncidentDraft({ ...incidentDraft, severity: e.target.value })} className="mt-1 w-full rounded-lg border border-bhodix-border bg-bhodix-surface p-2.5 text-bhodix-text">{['Critical', 'High', 'Medium', 'Low'].map((severity) => <option key={severity}>{severity}</option>)}</select></label>
            <label className="block text-xs text-bhodix-textMuted">Root cause or current investigation status *<textarea required rows={3} value={incidentDraft.rootCause} onChange={(e) => setIncidentDraft({ ...incidentDraft, rootCause: e.target.value })} placeholder="What is known so far?" className="mt-1 w-full rounded-lg border border-bhodix-border bg-bhodix-surface p-2.5 text-bhodix-text" /></label>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setIncidentEndpoint(null)} className="px-3 py-2 text-xs text-bhodix-textMuted">Cancel</button><button disabled={savingIncident} className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{savingIncident ? 'Saving…' : 'Save incident'}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
