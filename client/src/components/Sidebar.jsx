import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  FolderKanban,
  ListTodo,
  Activity,
  CircleDollarSign,
  Receipt,
  FileText,
  KeyRound,
  Users,
  Bot,
  Layers,
  User,
  LogOut,
  Sun,
  Moon,
  Search,
  Settings2,
  PanelLeftClose,
  PanelLeftOpen,
  Command
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

  // Text labels fade out cleanly in collapsed mode
  const lbl = `min-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 ${open ? 'opacity-100 max-w-[200px]' : 'w-0 max-w-0 opacity-0'}`;

  const openCommandPalette = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  };

  const manager = user && ['owner', 'admin'].includes(user.role);

  const navGroups = [
    {
      label: 'Workspace',
      items: [
        { id: 'executive', label: 'Executive Cockpit', icon: LayoutDashboard },
        { id: 'projects', label: 'Projects & Features', icon: FolderKanban, badge: `${projectKeys.length} ${projectKeys.length === 1 ? 'App' : 'Apps'}` },
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
      label: 'Settings',
      items: [
        { id: 'team', label: 'Team & Access', icon: Users },
        ...(manager ? [{ id: 'secrets', label: 'Secrets Vault', icon: KeyRound }] : []),
        { id: 'ai', label: 'Integrations', icon: Bot }
      ]
    }
  ];

  const userInitial = (user?.name || companyName || 'U').charAt(0).toUpperCase();

  return (
    <aside className={`${open ? 'w-[260px]' : 'w-[68px]'} h-full min-h-0 shrink-0 overflow-hidden bg-bhodix-surface border-r border-bhodix-border select-none transition-[width] duration-200 ease-in-out`}>
      <div className={`${open ? 'w-[260px]' : 'w-[68px]'} h-full min-h-0 flex flex-col transition-[width] duration-200 ease-in-out`}>

        {/* ═══ Brand Header ═══ */}
        <div className="shrink-0 px-4 pt-4 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br from-indigo-600/20 to-indigo-500/10 border border-indigo-500/25 flex items-center justify-center">
              <Layers className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
            </div>
            <div className={lbl} aria-hidden={!open}>
              <div className="font-bold text-sm tracking-tight text-bhodix-text flex items-center gap-2">
                Bhodhix OS
                <span className="text-[9px] px-1.5 py-px font-mono font-semibold bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border border-indigo-500/20 rounded-md leading-tight">
                  PRO
                </span>
              </div>
              <div className="text-[10px] text-bhodix-textSubtle tracking-tight truncate mt-0.5">
                {legalName || companyName}
              </div>
            </div>
            {open && (
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="ml-auto shrink-0 rounded-lg p-1.5 text-bhodix-textSubtle hover:bg-bhodix-hover hover:text-bhodix-text transition-colors"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )}
          </div>
          {!open && (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="mt-3 flex w-full justify-center rounded-lg p-1.5 text-bhodix-textSubtle hover:bg-bhodix-hover hover:text-bhodix-text transition-colors"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* ═══ Search / Command Palette Trigger ═══ */}
        <div className="shrink-0 px-3 pb-3">
          {open ? (
            <button
              type="button"
              onClick={openCommandPalette}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border border-bhodix-border bg-bhodix-card/50 text-xs text-bhodix-textSubtle hover:bg-bhodix-hover hover:border-bhodix-borderSubtle transition-colors group"
            >
              <Search className="w-3.5 h-3.5 shrink-0 text-bhodix-textSubtle group-hover:text-indigo-400 transition-colors" />
              <span className="flex-1 text-left">Search…</span>
              <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded-md border border-bhodix-border bg-bhodix-surface px-1.5 py-0.5 text-[10px] font-mono text-bhodix-textSubtle">
                <Command className="w-2.5 h-2.5" />K
              </kbd>
            </button>
          ) : (
            <button
              type="button"
              onClick={openCommandPalette}
              title="Search (Ctrl+K)"
              className="w-full flex justify-center rounded-xl border border-bhodix-border bg-bhodix-card/50 p-2 text-bhodix-textSubtle hover:bg-bhodix-hover hover:text-indigo-400 transition-colors"
            >
              <Search className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ═══ Navigation Groups ═══ */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 space-y-1">
          {navGroups.map((group, groupIndex) => (
            <div key={group.label}>
              {/* Group Divider */}
              {open ? (
                <div className={`flex items-center gap-2 px-2 ${groupIndex === 0 ? 'pt-0.5 pb-1.5' : 'pt-4 pb-1.5'}`}>
                  <span className="text-[9px] font-mono font-semibold uppercase tracking-[0.15em] text-bhodix-textSubtle/70">
                    {group.label}
                  </span>
                  <div className="flex-1 h-px bg-bhodix-border/50" />
                </div>
              ) : (
                groupIndex > 0 && (
                  <div className="flex justify-center py-2">
                    <div className="w-5 h-px bg-bhodix-border/60 rounded-full" />
                  </div>
                )
              )}

              {/* Nav Items */}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = currentView === item.id;
                  return (
                    <button
                      key={item.id}
                      title={!open ? item.label : undefined}
                      aria-label={item.label}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => setCurrentView(item.id)}
                      className={`relative w-full flex items-center ${open ? 'justify-between' : 'justify-center'} px-2.5 py-2 rounded-xl text-xs font-medium transition-all duration-150 group ${
                        active
                          ? 'bg-indigo-500/10 text-bhodix-text'
                          : 'text-bhodix-textMuted hover:text-bhodix-text hover:bg-bhodix-hover/70'
                      }`}
                    >
                      {/* Active indicator bar */}
                      {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.4)]" />
                      )}

                      <div className={`flex min-w-0 items-center gap-2.5 ${open ? '' : 'justify-center'}`}>
                        <Icon className={`w-[18px] h-[18px] shrink-0 transition-colors duration-150 ${
                          active
                            ? 'text-indigo-500 dark:text-indigo-400'
                            : 'text-bhodix-textSubtle group-hover:text-bhodix-text'
                        }`} />
                        <span aria-hidden={!open} className={`${lbl} ${active ? 'font-semibold' : ''}`}>
                          {item.label}
                        </span>
                      </div>

                      {/* Badge */}
                      {open && item.badge && (
                        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-md font-mono tabular-nums ${
                          active
                            ? 'bg-indigo-500/15 text-indigo-500 dark:text-indigo-300'
                            : 'bg-bhodix-surface text-bhodix-textSubtle border border-bhodix-borderSubtle'
                        }`}>
                          {item.badge}
                        </span>
                      )}

                      {/* Monitoring pulse */}
                      {item.pulse && (
                        <span aria-label="Monitoring active" className={`relative flex h-2 w-2 ${open ? '' : 'absolute top-1.5 right-1.5'}`}>
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ═══ Footer ═══ */}
        <div className="shrink-0 border-t border-bhodix-border p-3 space-y-2.5">

          {/* Sync Status — single compact line */}
          <div className={`flex items-center ${open ? 'justify-between' : 'justify-center'} px-2 py-1.5 rounded-lg`}>
            <div className="flex items-center gap-2 text-[11px]">
              <span className={`w-2 h-2 shrink-0 rounded-full ${
                connected
                  ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]'
                  : 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]'
              }`} />
              <span className={`font-mono font-medium ${connected ? 'text-emerald-500 dark:text-emerald-400' : 'text-amber-500'} ${lbl}`}>
                {connected ? 'LIVE' : 'OFFLINE'}
              </span>
            </div>
            {open && (
              <span className="text-[10px] text-bhodix-textSubtle font-mono tabular-nums">
                {lastSyncTime || 'Pending'}
              </span>
            )}
          </div>

          {/* Display Preferences (expandable) */}
          {open && (
            <button
              onClick={() => setShowPreferences((v) => !v)}
              className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-[10px] text-bhodix-textSubtle hover:bg-bhodix-hover hover:text-bhodix-text transition-colors"
            >
              <Settings2 className="w-3 h-3 shrink-0" />
              <span>{showPreferences ? 'Hide preferences' : 'Display & accessibility'}</span>
            </button>
          )}
          {showPreferences && open && (
            <div className="space-y-1.5 rounded-xl border border-bhodix-borderSubtle bg-bhodix-card/60 p-2.5 text-[10px] text-bhodix-textMuted">
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span>Compact spacing</span>
                <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} className="accent-indigo-500 rounded" />
              </label>
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span>Reduce motion</span>
                <input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.target.checked)} className="accent-indigo-500 rounded" />
              </label>
              <span className="block text-[9px] text-bhodix-textSubtle leading-relaxed">
                Compact mode applies to all views except the planner board.
              </span>
            </div>
          )}

          {/* User Profile Row */}
          {user && (
            <div className={`flex items-center ${open ? 'gap-2.5' : 'flex-col gap-2'} rounded-xl bg-bhodix-card/40 border border-bhodix-borderSubtle p-2`}>
              {/* Avatar */}
              <div className="w-8 h-8 shrink-0 rounded-lg bg-gradient-to-br from-indigo-500/20 to-indigo-600/10 border border-indigo-500/25 flex items-center justify-center text-sm font-bold text-indigo-500 dark:text-indigo-400">
                {userInitial}
              </div>

              {open && (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold text-bhodix-text truncate">{user.name || companyName}</div>
                    <div className="text-[9px] text-bhodix-textSubtle font-mono truncate">{user.organization?.slug || user.email}</div>
                  </div>

                  {/* Inline actions */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={toggleTheme}
                      className="rounded-lg p-1.5 text-bhodix-textSubtle hover:bg-bhodix-hover hover:text-bhodix-text transition-colors"
                      title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
                    >
                      {theme === 'dark'
                        ? <Sun className="w-3.5 h-3.5 text-amber-400" />
                        : <Moon className="w-3.5 h-3.5 text-indigo-500" />
                      }
                    </button>
                    <button
                      onClick={logout}
                      className="rounded-lg p-1.5 text-bhodix-textSubtle hover:bg-rose-500/10 hover:text-rose-500 transition-colors"
                      title="Sign out"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              )}

              {/* Collapsed: just show theme toggle below avatar */}
              {!open && (
                <button
                  onClick={toggleTheme}
                  className="rounded-lg p-1.5 text-bhodix-textSubtle hover:bg-bhodix-hover hover:text-bhodix-text transition-colors"
                  title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
                >
                  {theme === 'dark'
                    ? <Sun className="w-3.5 h-3.5 text-amber-400" />
                    : <Moon className="w-3.5 h-3.5 text-indigo-500" />
                  }
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
