import React, { useState } from 'react';
import {
  RefreshCw,
  Bell,
  Plus
} from 'lucide-react';
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
    health
  } = useVault();
  const [refreshing, setRefreshing] = useState(false);
  const { showToast } = useToast();

  const handleRefresh = async () => {
    setRefreshing(true);
    const ok = await refreshAll();
    setRefreshing(false);
    showToast(ok ? 'Refreshed from disk' : 'Refresh failed', ok ? 'success' : 'error');
  };

  // Context-aware view meta
  const viewMeta = {
    executive: { title: 'Executive Cockpit', subtitle: 'Real-time workspace overview & key metrics' },
    projects: { title: 'Projects & Features', subtitle: `${projectList.length} registered ${projectList.length === 1 ? 'project' : 'projects'}` },
    planner: { title: 'Planner & Sprints', subtitle: (() => { try { const t = getAllTasks(); return `${t.length} task${t.length === 1 ? '' : 's'} · synced with vault`; } catch { return 'Task management'; } })() },
    monitor: { title: 'Server & Health', subtitle: (() => { try { return `${health?.endpoints?.length || 0} endpoint${(health?.endpoints?.length || 0) === 1 ? '' : 's'} monitored`; } catch { return 'Live uptime monitor'; } })() },
    finance: { title: 'Finance & Economics', subtitle: 'Revenue, burn rate & unit economics' },
    billing: { title: 'Quotations & Invoices', subtitle: 'Client billing & document management' },
    vault: { title: 'Documents & Vault', subtitle: 'Markdown workspace files' },
    secrets: { title: 'Secrets Vault', subtitle: 'Encrypted credential storage' },
    team: { title: 'Team & Access', subtitle: 'Members, roles & workspace permissions' },
    ai: { title: 'Integrations', subtitle: 'AI assistants, Slack & external connectors' }
  };

  const current = viewMeta[currentView] || { title: 'Overview', subtitle: '' };

  // Views where project selector is relevant
  const showProjectSelector = !['ai', 'secrets', 'billing', 'team'].includes(currentView);

  return (
    <header className="z-10 flex h-[52px] shrink-0 select-none items-center justify-between border-b border-bhodix-border bg-bhodix-bg px-4 md:px-6">

      {/* Left: Title & Context */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-bold tracking-tight text-bhodix-text leading-tight">
            {current.title}
          </h1>
          {current.subtitle && (
            <p className="truncate text-[10px] text-bhodix-textSubtle font-mono leading-tight mt-px">
              {current.subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Right: Controls */}
      <div className="flex min-w-0 items-center gap-2 md:gap-2.5">

        {/* Project Selector — pill-style */}
        {showProjectSelector && (
          <>
            <div className="hidden items-center rounded-xl border border-bhodix-border bg-bhodix-card/60 p-0.5 text-[11px] font-medium lg:flex">
              {[{ id: 'all', name: 'All Apps' }, ...projectList].map((proj) => (
                <button
                  key={proj.id}
                  onClick={() => setSelectedProject(proj.id)}
                  className={`px-3 py-1.5 rounded-[10px] transition-all duration-150 ${
                    selectedProject === proj.id
                      ? 'bg-indigo-600 text-white font-semibold shadow-sm shadow-indigo-600/20'
                      : 'text-bhodix-textMuted hover:text-bhodix-text hover:bg-bhodix-hover/50'
                  }`}
                >
                  {proj.name}
                </button>
              ))}
              <button
                onClick={() => setIsCreateProjectOpen(true)}
                className="px-1.5 py-1.5 rounded-lg text-bhodix-textSubtle hover:text-indigo-500 hover:bg-indigo-500/10 transition-colors"
                title="New project"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Mobile project selector */}
            <select
              aria-label="Choose project"
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="max-w-28 rounded-xl border border-bhodix-border bg-bhodix-card px-2 py-1.5 text-[10px] text-bhodix-text lg:hidden"
            >
              {[{ id: 'all', name: 'All Apps' }, ...projectList].map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </>
        )}

        {/* Refresh */}
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="rounded-xl p-2 text-bhodix-textMuted transition-colors hover:bg-bhodix-hover hover:text-bhodix-text disabled:opacity-40"
          title="Reload from disk"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>

        {/* Notification Bell */}
        <button
          className="relative rounded-xl p-2 text-bhodix-textMuted transition-colors hover:bg-bhodix-hover hover:text-bhodix-text"
          title="Notifications"
          onClick={() => showToast('No new notifications', 'info')}
        >
          <Bell className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
