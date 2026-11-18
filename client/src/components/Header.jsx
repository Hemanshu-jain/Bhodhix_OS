import React, { useState } from 'react';
import { Activity, Bell, ChevronDown, Layers, Plus, RefreshCw } from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { useToast } from './ToastProvider';

export default function Header({ currentView }) {
  const {
    selectedProject,
    setSelectedProject,
    refreshAll,
    projectList,
    companyName,
    setIsCreateProjectOpen,
    getAllTasks,
    health,
    connected
  } = useVault();
  const [refreshing, setRefreshing] = useState(false);
  const { showToast } = useToast();

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const ok = await refreshAll();
      showToast(ok ? 'Workspace refreshed' : 'Refresh failed', ok ? 'success' : 'error');
    } catch {
      showToast('Refresh failed', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const viewMeta = {
    executive: { title: 'Executive Cockpit', subtitle: 'Workspace overview and key metrics' },
    projects: { title: 'Projects & Features', subtitle: `${projectList.length} registered ${projectList.length === 1 ? 'project' : 'projects'}` },
    planner: { title: 'Planner & Sprints', subtitle: (() => { try { const tasks = getAllTasks(); return `${tasks.length} task${tasks.length === 1 ? '' : 's'} · synced with workspace`; } catch { return 'Task management'; } })() },
    monitor: { title: 'Server & Health', subtitle: `${health?.endpoints?.length || 0} endpoint${(health?.endpoints?.length || 0) === 1 ? '' : 's'} monitored` },
    finance: { title: 'Finance & Economics', subtitle: 'Revenue, burn rate, and unit economics' },
    billing: { title: 'Quotations & Invoices', subtitle: 'Client billing and documents' },
    vault: { title: 'Documents & Vault', subtitle: 'Workspace files and documentation' },
    secrets: { title: 'Secrets Vault', subtitle: 'Encrypted credential storage' },
    team: { title: 'Team & Access', subtitle: 'Members, roles, and permissions' },
    ai: { title: 'Integrations', subtitle: 'AI assistants and connected services' }
  };
  const current = viewMeta[currentView] || { title: 'Overview', subtitle: '' };
  const showProjectSelector = !['ai', 'secrets', 'billing', 'team'].includes(currentView);

  const actionButton = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-bhodix-border bg-bhodix-surface text-bhodix-textMuted transition-colors hover:border-bhodix-borderHover hover:bg-bhodix-hover hover:text-bhodix-text disabled:cursor-wait disabled:opacity-60';

  return (
    <header className="z-20 flex min-h-[72px] shrink-0 items-center justify-between gap-3 border-b border-bhodix-border bg-bhodix-surface/95 px-3 backdrop-blur sm:px-5 lg:px-7">
      <div className="flex min-w-0 items-center gap-3">
        <div className="hidden h-9 w-1 shrink-0 rounded-full bg-indigo-500 sm:block" aria-hidden="true" />
        <div className="min-w-0">
          <div className="mb-1 hidden min-w-0 items-center gap-2 text-[10px] font-medium uppercase tracking-[0.12em] text-bhodix-textSubtle sm:flex">
            <span className="max-w-[180px] truncate">{companyName || 'Workspace'}</span>
            <span className="text-bhodix-borderHover">/</span>
            <span>Command Center</span>
          </div>
          <h1 className="truncate text-[14px] font-semibold leading-tight tracking-tight text-bhodix-text sm:text-[15px]">{current.title}</h1>
          {current.subtitle && <p className="mt-1 hidden truncate text-[11px] leading-tight text-bhodix-textSubtle md:block">{current.subtitle}</p>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <div className={`hidden items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-medium xl:flex ${connected ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-300' : 'border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-300'}`} title={connected ? 'Workspace connection is active' : 'Workspace is offline'}>
          <Activity className="h-3.5 w-3.5" />
          {connected ? 'Connected' : 'Offline'}
        </div>

        {showProjectSelector && (
          <label className="relative flex h-10 min-w-0 items-center rounded-xl border border-bhodix-border bg-bhodix-surface transition-colors hover:border-bhodix-borderHover focus-within:border-indigo-500/60">
            <Layers className="pointer-events-none absolute left-2.5 h-4 w-4 text-bhodix-textSubtle" />
            <span className="sr-only">Choose project</span>
            <select
              aria-label="Choose project"
              value={selectedProject}
              onChange={(event) => setSelectedProject(event.target.value)}
              className="h-full w-[122px] appearance-none truncate bg-transparent py-0 pl-8 pr-7 text-[11px] font-medium text-bhodix-text outline-none sm:w-[150px] lg:w-[190px]"
            >
              {[{ id: 'all', name: 'All Apps' }, ...projectList].map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-bhodix-textSubtle" />
          </label>
        )}

        {showProjectSelector && (
          <button type="button" onClick={() => setIsCreateProjectOpen(true)} aria-label="Create project" title="Create project" className={`${actionButton} hidden sm:inline-flex`}>
            <Plus className="h-4 w-4" />
          </button>
        )}

        <button type="button" onClick={handleRefresh} disabled={refreshing} aria-label="Refresh workspace" title="Refresh workspace" className={actionButton}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>

        <button type="button" aria-label="Notifications" title="Notifications" onClick={() => showToast('No new notifications', 'info')} className={`${actionButton} relative`}>
          <Bell className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
