import React, { useEffect, useState } from 'react';
import { Activity, Bot, CircleDollarSign, FileText, FolderKanban, KeyRound, LayoutDashboard, ListTodo, MoreHorizontal, Receipt, Users, X } from 'lucide-react';

const primaryItems = [
  { id: 'executive', label: 'Home', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'planner', label: 'Planner', icon: ListTodo }
];
const moreItems = [
  { id: 'monitor', label: 'Server & Health', icon: Activity },
  { id: 'finance', label: 'Finance', icon: CircleDollarSign },
  { id: 'billing', label: 'Quotations & Invoices', icon: Receipt },
  { id: 'vault', label: 'Documents', icon: FileText },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'ai', label: 'Integrations', icon: Bot }
];

export default function MobileNavigation({ currentView, setCurrentView, user }) {
  const [showMore, setShowMore] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const installed = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isAppleMobile = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const visibleMoreItems = moreItems.filter((item) => item.id !== 'billing' || ['owner', 'admin'].includes(user?.role));
  useEffect(() => {
    const capturePrompt = (event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener('beforeinstallprompt', capturePrompt);
    return () => window.removeEventListener('beforeinstallprompt', capturePrompt);
  }, []);
  const navigate = (view) => {
    if (setCurrentView(view) !== false) setShowMore(false);
  };

  return (
    <>
      {showMore && <div className="fixed inset-0 z-40 md:hidden">
        <button aria-label="Close more navigation" onClick={() => setShowMore(false)} className="absolute inset-0 bg-black/50" />
        <section role="dialog" aria-modal="true" aria-label="More sections" className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-bhodix-border bg-bhodix-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-bhodix-text">More sections</h2><button aria-label="Close" onClick={() => setShowMore(false)} className="rounded-lg p-2 text-bhodix-textMuted hover:bg-bhodix-hover"><X className="h-4 w-4" /></button></div>
          <div className="grid grid-cols-2 gap-2">{[...visibleMoreItems, ...(user && ['owner', 'admin'].includes(user.role) ? [{ id: 'secrets', label: 'Secrets Vault', icon: KeyRound }] : [])].map(({ id, label, icon: Icon }) => <button key={id} onClick={() => navigate(id)} className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 text-left text-xs ${currentView === id ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-400' : 'border-bhodix-borderSubtle bg-bhodix-card text-bhodix-textMuted'}`}><Icon className="h-4 w-4 shrink-0" />{label}</button>)}</div>
          {!installed && <div className="mt-3 rounded-xl border border-bhodix-borderSubtle bg-bhodix-card p-3 text-xs text-bhodix-textMuted">{installPrompt ? <button onClick={async () => { await installPrompt.prompt(); setInstallPrompt(null); }} className="font-semibold text-indigo-400">Install Bhodhix on this device</button> : <span>{isAppleMobile ? 'To install, open the Share menu in Safari and choose “Add to Home Screen”.' : 'Use your browser menu and choose “Install app” or “Add to Home Screen”.'}</span>}</div>}
        </section>
      </div>}
      <nav aria-label="Mobile navigation" className="z-30 grid min-h-16 shrink-0 grid-cols-4 border-t border-bhodix-border bg-bhodix-surface/95 px-2 pt-1 backdrop-blur pb-[env(safe-area-inset-bottom)] md:hidden">
        {primaryItems.map(({ id, label, icon: Icon }) => <button key={id} aria-current={currentView === id ? 'page' : undefined} onClick={() => navigate(id)} className={`flex flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] ${currentView === id ? 'text-indigo-400' : 'text-bhodix-textSubtle'}`}><Icon className="h-4 w-4" /><span>{label}</span></button>)}
        <button aria-expanded={showMore} onClick={() => setShowMore((value) => !value)} className={`flex flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] ${showMore || visibleMoreItems.some((item) => item.id === currentView) || currentView === 'secrets' ? 'text-indigo-400' : 'text-bhodix-textSubtle'}`}><MoreHorizontal className="h-4 w-4" /><span>More</span></button>
      </nav>
    </>
  );
}
