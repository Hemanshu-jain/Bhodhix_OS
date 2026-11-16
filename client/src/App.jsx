import React, { useEffect, useState } from 'react';
import { VaultProvider, useVault } from './context/VaultContext';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import LoginView from './components/LoginView';
import ExecutiveView from './views/ExecutiveView';
import ProjectsView from './views/ProjectsView';
import PlannerView from './views/PlannerView';
import MonitorView from './views/MonitorView';
import FinanceView from './views/FinanceView';
import VaultDocsView from './views/VaultDocsView';
import { ToastProvider } from './components/ToastProvider';
import HealthToastListener from './components/HealthToastListener';
import CommandPalette from './components/CommandPalette';
import QuickAdd from './components/QuickAdd';
import CreateProjectModal from './components/CreateProjectModal';
import TeamView from './views/TeamView';
import AIConnectionsView from './views/AIConnectionsView';
import MobileNavigation from './components/MobileNavigation';
import SecretsVaultView from './views/SecretsVaultView';
import BillingView from './views/BillingView';

function AuthedQuickAdd() {
  const { isAuthenticated, user } = useVault();
  return isAuthenticated && user?.role !== 'viewer' ? <QuickAdd /> : null;
}

function FieldActivityMonitor() {
  const { isAuthenticated, user, apiFetch } = useVault();
  useEffect(() => {
    if (!isAuthenticated || user?.role === 'viewer') return undefined;
    let workStatus = '';
    let lastInteraction = 0;
    let lastSent = 0;
    let alive = true;
    const refresh = async () => {
      try {
        const response = await apiFetch('/api/team/field-work/shift');
        const result = await response.json();
        workStatus = response.ok && result.success && !result.shift?.checkedOutAt ? result.shift?.activityStatus || '' : '';
      } catch { workStatus = ''; }
    };
    const markInteraction = () => { lastInteraction = Date.now(); };
    const sendHeartbeat = async () => {
      const now = Date.now();
      if (!alive || workStatus !== 'working' || document.visibilityState !== 'visible' || !document.hasFocus() || now - lastInteraction > 75_000 || now - lastSent < 25_000) return;
      lastSent = now;
      try { await apiFetch('/api/team/field-work/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* the next active interval retries */ }
    };
    refresh();
    const poll = setInterval(refresh, 60_000);
    const heartbeat = setInterval(sendHeartbeat, 30_000);
    const refreshEvent = () => refresh();
    window.addEventListener('pointermove', markInteraction, { passive: true });
    window.addEventListener('pointerdown', markInteraction, { passive: true });
    window.addEventListener('keydown', markInteraction);
    window.addEventListener('scroll', markInteraction, { passive: true });
    window.addEventListener('touchstart', markInteraction, { passive: true });
    window.addEventListener('bhodhix:field-shift-updated', refreshEvent);
    return () => { alive = false; clearInterval(poll); clearInterval(heartbeat); window.removeEventListener('pointermove', markInteraction); window.removeEventListener('pointerdown', markInteraction); window.removeEventListener('keydown', markInteraction); window.removeEventListener('scroll', markInteraction); window.removeEventListener('touchstart', markInteraction); window.removeEventListener('bhodhix:field-shift-updated', refreshEvent); };
  }, [isAuthenticated, user?.token, user?.role]);
  return null;
}

function MainLayout() {
  const [currentView, setCurrentView] = useState(() => {
    const saved = localStorage.getItem('bhodix_view');
    return ['executive', 'projects', 'planner', 'monitor', 'finance', 'billing', 'vault', 'secrets', 'team', 'ai'].includes(saved) ? saved : 'executive';
  });
  const { loading, isAuthenticated, user, setSelectedProject, hasUnsavedDocChanges, setHasUnsavedDocChanges, isCreateProjectOpen, setIsCreateProjectOpen } = useVault();

  const navigate = (view) => {
    if (view === currentView) return true;
    if (hasUnsavedDocChanges && !window.confirm('You have unsaved document changes. Leave this page and discard them?')) return false;
    if (hasUnsavedDocChanges) setHasUnsavedDocChanges(false);
    setCurrentView(view);
    try {
      localStorage.setItem('bhodix_view', view);
      const recent = JSON.parse(localStorage.getItem('bhodix_recent_views') || '[]');
      localStorage.setItem('bhodix_recent_views', JSON.stringify([view, ...recent.filter((item) => item !== view)].slice(0, 4)));
    } catch { /* storage unavailable */ }
    return true;
  };

  useEffect(() => {
    try { localStorage.setItem('bhodix_view', currentView); } catch { /* storage unavailable */ }
  }, [currentView]);

  useEffect(() => {
    const openTask = (event) => {
      const { projectId, taskId } = event.detail || {};
      if (!projectId || !taskId) return;
      try { localStorage.setItem('bhodix_task_to_open', JSON.stringify({ projectId, taskId })); } catch { /* storage unavailable */ }
      setSelectedProject(projectId);
      navigate('planner');
    };
    window.addEventListener('bhodhix:open-task', openTask);
    return () => window.removeEventListener('bhodhix:open-task', openTask);
  }, [setSelectedProject, currentView, hasUnsavedDocChanges, setHasUnsavedDocChanges]);

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-bhodix-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <div className="text-xs font-mono text-bhodix-textSubtle tracking-wide">
            Mounting Bhodhix Markdown Vault...
          </div>
        </div>
      </div>
    );
  }

  // Enforce authentication gate
  if (!isAuthenticated) {
    return <LoginView />;
  }

  return (
    <div className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-bhodix-bg text-bhodix-text transition-colors md:flex-row">
      <CommandPalette setCurrentView={navigate} setSelectedProject={setSelectedProject} />
      <CreateProjectModal isOpen={isCreateProjectOpen} onClose={() => setIsCreateProjectOpen(false)} />
      {/* Sleek Vertical Navigation */}
      <div className="hidden h-full md:block"><Sidebar currentView={currentView} setCurrentView={navigate} /></div>

      {/* Main Content Workspace */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Header currentView={currentView} />

        <main data-view={currentView} className="min-h-0 flex-1 overflow-y-auto bg-bhodix-bg pb-2 md:pb-0">
          {currentView === 'executive' && <ExecutiveView setCurrentView={navigate} />}
          {currentView === 'projects' && <ProjectsView setCurrentView={navigate} />}
          {currentView === 'planner' && <PlannerView />}
          {currentView === 'monitor' && <MonitorView />}
          {currentView === 'finance' && <FinanceView />}
          {currentView === 'billing' && <BillingView />}
          {currentView === 'vault' && <VaultDocsView />}
          {currentView === 'secrets' && <SecretsVaultView />}
          {currentView === 'team' && <TeamView />}
          {currentView === 'ai' && <AIConnectionsView />}
        </main>
      </div>
      <MobileNavigation currentView={currentView} setCurrentView={navigate} user={user} />
    </div>
  );
}

export default function App() {
  return (
    <VaultProvider>
      <ToastProvider>
        <FieldActivityMonitor />
        <HealthToastListener />
        <MainLayout />
        <AuthedQuickAdd />
      </ToastProvider>
    </VaultProvider>
  );
}
