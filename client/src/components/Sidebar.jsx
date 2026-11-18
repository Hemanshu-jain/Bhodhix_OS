import React, { useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  CircleDollarSign,
  Command,
  FileText,
  FolderKanban,
  KeyRound,
  Layers,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Search,
  Settings2,
  Sun,
  Users
} from 'lucide-react';
import { useVault } from '../context/VaultContext';

export default function Sidebar({ currentView, setCurrentView }) {
  const {
    connected,
    lastSyncTime,
    user,
    logout,
    theme,
    toggleTheme,
    projectKeys,
    companyName,
    legalName
  } = useVault();

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('bhodix_sidebar_collapsed') === 'true');
  const [showPreferences, setShowPreferences] = useState(false);
  const [compact, setCompact] = useState(() => localStorage.getItem('bhodix_density') === 'compact');
  const [reducedMotion, setReducedMotion] = useState(() => localStorage.getItem('bhodix_reduced_motion') === 'true');
  const open = !collapsed;

  useEffect(() => {
    try { localStorage.setItem('bhodix_sidebar_collapsed', String(collapsed)); } catch { /* storage unavailable */ }
  }, [collapsed]);

  useEffect(() => {
    document.documentElement.dataset.density = compact ? 'compact' : 'comfortable';
    document.documentElement.dataset.motion = reducedMotion ? 'reduced' : 'full';
    try {
      localStorage.setItem('bhodix_density', compact ? 'compact' : 'comfortable');
      localStorage.setItem('bhodix_reduced_motion', String(reducedMotion));
    } catch { /* storage unavailable */ }
  }, [compact, reducedMotion]);

  const manager = user && ['owner', 'admin'].includes(user.role);
  const navGroups = [
    {
      label: 'Workspace',
      items: [
        { id: 'executive', label: 'Executive Cockpit', icon: LayoutDashboard },
        { id: 'projects', label: 'Projects & Features', icon: FolderKanban, badge: `${projectKeys.length} ${projectKeys.length === 1 ? 'app' : 'apps'}` },
        { id: 'planner', label: 'Planner & Sprints', icon: ListTodo },
        { id: 'monitor', label: 'Server & Health', icon: Activity, pulse: true }
      ]
    },
    {
      label: 'Business',
      items: [
        { id: 'finance', label: 'Finance & Economics', icon: CircleDollarSign },
        ...(manager ? [{ id: 'billing', label: 'Quotations & Invoices', icon: Receipt }] : []),
        { id: 'vault', label: 'Documents & Vault', icon: FileText }
      ]
    },
    {
      label: 'Administration',
      items: [
        { id: 'team', label: 'Team & Access', icon: Users },
        ...(manager ? [{ id: 'secrets', label: 'Secrets Vault', icon: KeyRound }] : []),
        { id: 'ai', label: 'Integrations', icon: Bot }
      ]
    }
  ];

  const userInitial = (user?.name || companyName || 'U').charAt(0).toUpperCase();
  const search = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  const iconButton = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-bhodix-textMuted transition-colors hover:bg-bhodix-hover hover:text-bhodix-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400';

  return (
    <aside className={`${open ? 'w-[272px]' : 'w-[76px]'} flex h-full min-h-0 shrink-0 flex-col border-r border-bhodix-border bg-bhodix-surface text-bhodix-text transition-[width] duration-200 ease-out`}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={`shrink-0 border-b border-bhodix-borderSubtle ${open ? 'px-4 pb-4 pt-5' : 'px-3 pb-4 pt-5'}`}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-950/15">
              <Layers className="h-5 w-5" strokeWidth={2.1} />
            </div>
            {open && (
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold tracking-tight">Bhodhix OS</span>
                  <span className="rounded-md border border-indigo-400/20 bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-indigo-500 dark:text-indigo-300">PRO</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-bhodix-textSubtle">Command Center</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
              aria-expanded={open}
              title={open ? 'Collapse sidebar' : 'Expand sidebar'}
              className={`${iconButton} ${open ? '-mr-1' : 'ml-auto'}`}
            >
              {open ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </button>
          </div>

          {open && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-bhodix-border bg-bhodix-card px-3 py-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bhodix-hover text-xs font-semibold text-bhodix-textMuted">
                {(companyName || 'W').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.11em] text-bhodix-textSubtle">Workspace</p>
                <p className="mt-0.5 truncate text-xs font-semibold text-bhodix-text" title={legalName || companyName}>{companyName || legalName || 'Your workspace'}</p>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={search}
            title="Search workspace (Ctrl+K)"
            aria-label="Search workspace, Ctrl+K"
            className={`mt-3 flex h-10 w-full items-center rounded-xl border border-bhodix-border bg-bhodix-bg text-xs text-bhodix-textMuted transition-colors hover:border-bhodix-borderHover hover:bg-bhodix-hover ${open ? 'gap-2.5 px-3' : 'justify-center'}`}
          >
            <Search className="h-4 w-4 shrink-0" />
            {open && <><span className="flex-1 text-left">Search workspace</span><kbd className="flex items-center gap-0.5 rounded-md border border-bhodix-border bg-bhodix-surface px-1.5 py-1 font-mono text-[10px] text-bhodix-textSubtle"><Command className="h-2.5 w-2.5" />K</kbd></>}
          </button>
        </div>

        <nav aria-label="Main navigation" className={`min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden py-4 ${open ? 'px-3' : 'px-2'}`}>
          {navGroups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              {open ? (
                <h2 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-bhodix-textSubtle">{group.label}</h2>
              ) : (
                <div className="mx-auto mb-2 h-px w-7 bg-bhodix-border" aria-hidden="true" />
              )}
              <div className="space-y-1">
                {group.items.map(({ id, label, icon: Icon, badge, pulse }) => {
                  const active = currentView === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      title={open ? undefined : label}
                      aria-label={label}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => setCurrentView(id)}
                      className={`group relative flex min-h-10 w-full items-center rounded-xl px-3 text-left text-[13px] transition-colors ${open ? 'gap-3' : 'justify-center'} ${active ? 'bg-indigo-500/10 font-semibold text-indigo-600 dark:text-indigo-300' : 'font-medium text-bhodix-textMuted hover:bg-bhodix-hover hover:text-bhodix-text'}`}
                    >
                      {active && <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full bg-indigo-500" aria-hidden="true" />}
                      <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-indigo-600 dark:text-indigo-300' : 'text-bhodix-textSubtle group-hover:text-bhodix-textMuted'}`} strokeWidth={active ? 2.1 : 1.8} />
                      {open && <span className="min-w-0 flex-1 truncate">{label}</span>}
                      {open && badge && <span className={`rounded-md px-1.5 py-1 text-[10px] tabular-nums ${active ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300' : 'bg-bhodix-hover text-bhodix-textSubtle'}`}>{badge}</span>}
                      {pulse && <span className={`h-2 w-2 shrink-0 rounded-full bg-emerald-500 ${open ? 'ml-auto' : 'absolute right-2 top-2'}`} title="Monitoring active" />}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        <footer className={`shrink-0 border-t border-bhodix-borderSubtle py-3 ${open ? 'px-3' : 'px-2'}`}>
          <div className={`mb-2 flex min-h-9 items-center rounded-xl bg-bhodix-bg px-3 ${open ? 'justify-between' : 'justify-center'}`}>
            <span className="flex items-center gap-2 text-[11px] font-medium text-bhodix-textMuted">
            <span aria-label={connected ? 'Connected' : 'Offline'} title={connected ? 'Connected' : 'Offline'} className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.10)]' : 'bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.10)]'}`} />
              {open && (connected ? 'Connected' : 'Offline')}
            </span>
            {open && <span className="truncate pl-2 text-[10px] text-bhodix-textSubtle" title={lastSyncTime || ''}>{lastSyncTime || 'Sync pending'}</span>}
          </div>

          {showPreferences && open && (
            <div className="mb-2 space-y-2 rounded-xl border border-bhodix-border bg-bhodix-card p-3 text-xs text-bhodix-textMuted">
              <label className="flex cursor-pointer items-center justify-between gap-3"><span>Compact spacing</span><input type="checkbox" checked={compact} onChange={(event) => setCompact(event.target.checked)} className="accent-indigo-500" /></label>
              <label className="flex cursor-pointer items-center justify-between gap-3"><span>Reduce motion</span><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} className="accent-indigo-500" /></label>
              <p className="text-[10px] leading-relaxed text-bhodix-textSubtle">Compact spacing applies to all views except the planner.</p>
            </div>
          )}

          <div className={`flex items-center rounded-xl border border-bhodix-border bg-bhodix-card p-2 ${open ? 'gap-2' : 'flex-col gap-1'}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-sm font-semibold text-indigo-600 dark:text-indigo-300">{userInitial}</div>
            {open && <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-bhodix-text">{user?.name || companyName}</p><p className="mt-0.5 truncate text-[10px] text-bhodix-textSubtle">{user?.organization?.slug || user?.email}</p></div>}
            <div className={`flex shrink-0 ${open ? 'items-center gap-0.5' : 'flex-col gap-0.5'}`}>
              <button type="button" onClick={() => setShowPreferences((value) => !value)} aria-label="Display preferences" aria-expanded={showPreferences} title="Display preferences" className={iconButton}><Settings2 className="h-4 w-4" /></button>
              <button type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`} className={iconButton}>{theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-indigo-500" />}</button>
              <button type="button" onClick={logout} aria-label="Sign out" title="Sign out" className={`${iconButton} hover:bg-rose-500/10 hover:text-rose-500`}><LogOut className="h-4 w-4" /></button>
            </div>
          </div>
        </footer>
      </div>
    </aside>
  );
}
