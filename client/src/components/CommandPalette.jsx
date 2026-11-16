import React, { useEffect, useMemo, useState } from 'react';
import { Search, X, ArrowRight, FileText, FolderKanban, LayoutDashboard, ListTodo, Layers, Plus, Activity, RefreshCw, CalendarDays, Users, Receipt } from 'lucide-react';
import { useVault } from '../context/VaultContext';
import useDialogFocus from '../lib/useDialogFocus';

export default function CommandPalette({ setCurrentView, setSelectedProject }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { vault, user, setIsCreateProjectOpen, triggerHealthCheck, refreshAll } = useVault();
  const dialogRef = useDialogFocus(isOpen);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const results = useMemo(() => {
    const quickActions = [
      { id: 'task', label: 'New task', detail: 'Alt+N', icon: Plus, action: () => { setCurrentView('planner'); window.dispatchEvent(new Event('bhodix:open-quick-add')); setIsOpen(false); } },
      { id: 'project', label: 'New project', detail: 'Create a project', icon: FolderKanban, action: () => { setIsCreateProjectOpen(true); setIsOpen(false); } },
      { id: 'health', label: 'Run health sweep', detail: 'Check monitored endpoints', icon: Activity, action: () => { setCurrentView('monitor'); triggerHealthCheck(); setIsOpen(false); } },
      { id: 'refresh', label: 'Refresh from disk', detail: 'Reload vault data', icon: RefreshCw, action: () => { refreshAll(); setIsOpen(false); } },
      ...[['calendar', 'Task calendar', CalendarDays], ['timeline', 'Task timeline', ArrowRight], ['workload', 'Assignee workload', Users]].map(([mode, label, icon]) => ({ id: `planner-${mode}`, label, detail: 'Planner view', icon, action: () => { localStorage.setItem('bhodix_planner_mode', mode); setCurrentView('planner'); setTimeout(() => window.dispatchEvent(new CustomEvent('bhodix:planner-mode', { detail: mode })), 0); setIsOpen(false); } }))
    ];
    if (!query.trim()) {
      const viewLabels = { executive: 'Executive Cockpit', projects: 'Projects & Features', planner: 'Planner & Sprints', monitor: 'Server & Health', finance: 'Finance & Economics', ...( ['owner', 'admin'].includes(user?.role) ? { billing: 'Quotations & Invoices' } : {}), vault: 'Document & Test Vault', team: 'Team', ai: 'Integrations' };
      let recent = [];
      try { recent = JSON.parse(localStorage.getItem('bhodix_recent_views') || '[]'); } catch { /* invalid preference */ }
      const recentActions = recent.filter((view) => viewLabels[view]).map((view) => ({ id: view, label: `Continue: ${viewLabels[view]}`, detail: 'Recently opened', icon: LayoutDashboard, action: () => { setCurrentView(view); setIsOpen(false); } }));
      return [...quickActions, ...recentActions].map((item) => ({ ...item, type: 'action' }));
    }
    const q = query.toLowerCase();
    const matches = [];
    const add = (type, id, label, detail, icon, action) => matches.push({ type, id, label, detail, icon, action });
    const docMatches = (doc, group, projectId) => {
      const path = doc.relativePath;
      if (!path || !`${doc.fileName || ''} ${doc.meta?.title || ''} ${doc.content || ''} ${path}`.toLowerCase().includes(q)) return;
      add('document', path, doc.meta?.title || doc.fileName || path, group, FileText, () => {
        localStorage.setItem('bhodix_doc_to_open', path);
        setCurrentView('vault');
        window.dispatchEvent(new CustomEvent('bhodix:open-document', { detail: path }));
        setIsOpen(false);
      });
    };

    Object.entries(vault?.projects || {}).forEach(([id, project]) => {
      const projectName = project.meta?.name || id;
      if (`${projectName} ${id}`.toLowerCase().includes(q)) {
        add('project', id, projectName, 'Open project', FolderKanban, () => {
          if (setCurrentView('projects') !== false) setSelectedProject(id);
          setIsOpen(false);
        });
      }
      (project.docs || []).forEach((doc) => docMatches(doc, projectName, id));
      (project.tasks || []).forEach((task) => {
        if (`${task.id} ${task.title} ${task.description || ''} ${task.status || ''}`.toLowerCase().includes(q)) {
          add('task', task.id, task.title, `${projectName} · ${task.id}`, ListTodo, () => {
            const target = { projectId: id, taskId: task.id };
            if (setCurrentView('planner') !== false) {
              localStorage.setItem('bhodix_task_to_open', JSON.stringify(target));
              setSelectedProject(id);
              window.dispatchEvent(new CustomEvent('bhodix:open-task', { detail: target }));
            }
            setIsOpen(false);
          });
        }
      });
      (project.features || []).forEach((feature) => {
        if (`${feature.id || ''} ${feature.feature_name || ''} ${feature.description || ''}`.toLowerCase().includes(q)) {
          add('feature', `${id}-${feature.id}`, feature.feature_name || feature.id, `${projectName} · ${feature.id || ''}`, Layers, () => {
            if (setCurrentView('projects') !== false) {
              localStorage.setItem('bhodix_feature_to_open', feature.id || '');
              setSelectedProject(id);
              window.dispatchEvent(new CustomEvent('bhodix:open-feature', { detail: feature.id || '' }));
            }
            setIsOpen(false);
          });
        }
      });
    });

    (vault?.docs || []).forEach((doc) => docMatches(doc, 'Company documents'));

    const views = [
      { id: 'executive', label: 'Executive Cockpit', icon: LayoutDashboard },
      { id: 'projects', label: 'Projects & Features', icon: FolderKanban },
      { id: 'planner', label: 'Planner & Sprints', icon: ListTodo },
      { id: 'monitor', label: 'Server & Health', icon: LayoutDashboard },
      { id: 'finance', label: 'Finance & Economics', icon: LayoutDashboard },
      ...(['owner', 'admin'].includes(user?.role) ? [{ id: 'billing', label: 'Quotations & Invoices', icon: Receipt }] : []),
      { id: 'vault', label: 'Document & Test Vault', icon: FileText },
      { id: 'team', label: 'Team', icon: Users },
      { id: 'ai', label: 'Integrations', icon: Layers }
    ];
    views.forEach((view) => {
      if (view.label.toLowerCase().includes(q)) {
        add('view', view.id, view.label, 'Go to view', view.icon, () => {
          setCurrentView(view.id);
          setIsOpen(false);
        });
      }
    });
    return matches.slice(0, 40);
  }, [query, vault, user?.role, setCurrentView, setSelectedProject, setIsCreateProjectOpen, triggerHealthCheck, refreshAll]);

  useEffect(() => setSelectedIndex(0), [query]);

  if (!isOpen) return null;
  const run = (index) => results[index]?.action();

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-20 bg-bhodix-bg/60 backdrop-blur-sm p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setIsOpen(false); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Search and navigate" className="w-full max-w-xl bg-bhodix-surface border border-bhodix-border rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-bhodix-border">
          <Search className="w-4 h-4 text-bhodix-textSubtle" />
          <input
            autoFocus
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={results[selectedIndex] ? `command-result-${selectedIndex}` : undefined}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && results.length) { e.preventDefault(); setSelectedIndex((i) => (i + 1) % results.length); }
              if (e.key === 'ArrowUp' && results.length) { e.preventDefault(); setSelectedIndex((i) => (i - 1 + results.length) % results.length); }
              if (e.key === 'Enter') { e.preventDefault(); run(selectedIndex); }
            }}
            className="flex-1 bg-transparent border-none outline-none text-sm text-bhodix-text placeholder-bhodix-textSubtle"
            placeholder="Search projects, tasks, features, documents, or views…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button onClick={() => setIsOpen(false)} aria-label="Close search" className="p-1 hover:bg-bhodix-hover rounded transition-colors">
            <X className="w-4 h-4 text-bhodix-textSubtle" />
          </button>
        </div>

        <div id="command-results" role="listbox" className="max-h-[400px] overflow-y-auto p-2 space-y-1">
          {results.length > 0 ? results.map((res, idx) => {
            const Icon = res.icon;
            return (
              <button
                id={`command-result-${idx}`}
                key={`${res.type}-${res.id}`}
                role="option"
                aria-selected={selectedIndex === idx}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={res.action}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-bhodix-text transition-colors group ${selectedIndex === idx ? 'bg-bhodix-hover' : ''}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon className="w-4 h-4 text-bhodix-textSubtle group-hover:text-indigo-500 shrink-0" />
                  <span className="truncate">{res.label}</span>
                  {res.detail && <span className="text-[10px] text-bhodix-textSubtle truncate">{res.detail}</span>}
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-bhodix-card text-bhodix-textSubtle font-mono uppercase">{res.type}</span>
                </div>
                <ArrowRight className="w-3 h-3 shrink-0 text-bhodix-textSubtle" />
              </button>
            );
          }) : (
            <div className="py-8 text-center text-xs text-bhodix-textSubtle">
              {query ? 'No matches found' : 'Start typing to find something…'}
            </div>
          )}
        </div>
        <div className="border-t border-bhodix-border px-4 py-2 text-[10px] text-bhodix-textSubtle font-mono">↑↓ move · Enter open · Esc close</div>
      </div>
    </div>
  );
}
