import React, { useEffect, useState } from 'react';
import {
  FolderKanban,
  ExternalLink,
  GitBranch,
  Server,
  CheckCircle2,
  Clock,
  AlertCircle,
  Cpu,
  Layers,
  Shield,
  Search,
  Plus
} from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { useToast } from '../components/ToastProvider';
import useDialogFocus from '../lib/useDialogFocus';

export default function ProjectsView({ setCurrentView }) {
  const { vault, selectedProject, setSelectedProject, projectList, setIsCreateProjectOpen, createFeature, updateProjectMetadata, user } = useVault();
  const { showToast } = useToast();
  const activeTab = projectList.some((p) => p.id === selectedProject) ? selectedProject : projectList[0]?.id;
  const [featureFilter, setFeatureFilter] = useState('all'); // 'all', 'live', 'testing', 'staged'
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatureForm, setShowFeatureForm] = useState(false);
  const [featureDraft, setFeatureDraft] = useState({ name: '', description: '', status: 'Planned', readiness: '', owner: '' });
  const [savingFeature, setSavingFeature] = useState(false);
  const [portfolioMode, setPortfolioMode] = useState(false);
  const [milestoneDraft, setMilestoneDraft] = useState({ name: '', date: '' });
  const [goalDraft, setGoalDraft] = useState('');
  const [checkinDraft, setCheckinDraft] = useState({ status: 'on_track', summary: '' });
  const featureDialogRef = useDialogFocus(showFeatureForm);

  useEffect(() => {
    if (!showFeatureForm) return undefined;
    const closeOnEscape = (e) => { if (e.key === 'Escape') setShowFeatureForm(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showFeatureForm]);

  const project = vault?.projects?.[activeTab] || {};

  useEffect(() => {
    if (selectedProject === 'all' && projectList[0]) setSelectedProject(projectList[0].id);
  }, [selectedProject, projectList, setSelectedProject]);

  useEffect(() => {
    const openFeature = (wanted) => {
      if (!wanted || !activeTab) return;
      requestAnimationFrame(() => {
        const row = [...document.querySelectorAll('[data-feature-id]')].find((el) => el.getAttribute('data-feature-id') === wanted);
        if (!row) return;
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        row.classList.add('ring-2', 'ring-indigo-500');
        setTimeout(() => row.classList.remove('ring-2', 'ring-indigo-500'), 1800);
        localStorage.removeItem('bhodix_feature_to_open');
      });
    };
    const wanted = localStorage.getItem('bhodix_feature_to_open');
    if (wanted) openFeature(wanted);
    const requested = (e) => openFeature(e.detail);
    window.addEventListener('bhodix:open-feature', requested);
    return () => window.removeEventListener('bhodix:open-feature', requested);
  }, [activeTab, project.features]);

  const submitFeature = async (e) => {
    e.preventDefault();
    if (!featureDraft.name.trim()) return;
    setSavingFeature(true);
    const ok = await createFeature(activeTab, { ...featureDraft, readiness: featureDraft.readiness ? `${featureDraft.readiness}%` : '' });
    setSavingFeature(false);
    showToast(ok ? 'Feature added' : 'Could not add feature', ok ? 'success' : 'error');
    if (ok) {
      setShowFeatureForm(false);
      setFeatureDraft({ name: '', description: '', status: 'Planned', readiness: '', owner: '' });
    }
  };

  const submitProjectUpdate = async (e, payload, reset) => {
    e.preventDefault();
    const result = await updateProjectMetadata(activeTab, payload);
    showToast(result.success ? 'Project update saved' : result.error || 'Could not save project update', result.success ? 'success' : 'error');
    if (result.success) reset();
  };

  if (!activeTab) {
    return (
      <div className="p-8 max-w-7xl mx-auto py-24 text-center text-xs text-bhodix-textSubtle font-mono">
        No projects yet — use the + next to the project selector in the header to create one.
      </div>
    );
  }
  const meta = project.meta || {};
  const features = project.features || [];

  const filteredFeatures = features.filter(f => {
    const matchesFilter = 
      featureFilter === 'all' ||
      (featureFilter === 'live' && f.status?.toLowerCase() === 'live') ||
      (featureFilter === 'testing' && f.status?.toLowerCase().includes('testing')) ||
      (featureFilter === 'staged' && f.status?.toLowerCase() === 'staged');

    const matchesSearch = 
      !searchQuery ||
      f.feature_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.id?.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  if (portfolioMode) {
    const portfolios = projectList.map((item) => {
      const data = vault?.projects?.[item.id] || {};
      const itemFeatures = data.features || [];
      const itemTasks = data.tasks || [];
      const live = itemFeatures.filter((feature) => feature.status?.toLowerCase() === 'live').length;
      const readiness = itemFeatures.length ? Math.round(itemFeatures.reduce((sum, feature) => sum + (parseFloat(feature.readiness) || (feature.status?.toLowerCase() === 'live' ? 100 : 0)), 0) / itemFeatures.length) : null;
      return { ...item, data, itemFeatures, itemTasks, live, readiness, target: data.meta?.target_live_date || data.meta?.target_launch_date || '' };
    });
    return <div className="mx-auto max-w-7xl space-y-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bhodix-border pb-4"><div><h1 className="text-xl font-bold text-bhodix-text">Project portfolio</h1><p className="mt-1 text-xs text-bhodix-textMuted">Compare readiness, open work, and target dates using each project’s recorded data.</p></div><button onClick={() => setPortfolioMode(false)} className="rounded-lg border border-bhodix-border px-3 py-2 text-xs text-bhodix-textMuted hover:text-indigo-500">Back to project</button></div>
      <div className="overflow-x-auto rounded-2xl border border-bhodix-border bg-bhodix-card p-5 shadow-sm"><h2 className="mb-4 text-sm font-bold text-bhodix-text">Project comparison</h2><table className="w-full min-w-[680px] text-left text-xs"><thead className="text-[10px] uppercase text-bhodix-textSubtle"><tr><th className="pb-3">Project</th><th>Stage</th><th>Features live</th><th>Readiness</th><th>Open tasks</th><th>Target date</th></tr></thead><tbody>{portfolios.map((item) => <tr key={item.id} className="cursor-pointer border-t border-bhodix-borderSubtle hover:bg-bhodix-surface/50" onClick={() => { setSelectedProject(item.id); setPortfolioMode(false); }}><td className="py-3 font-semibold text-indigo-500">{item.name}</td><td className="text-bhodix-textMuted">{item.data.meta?.stage || 'Not recorded'}</td><td>{item.live} / {item.itemFeatures.length}</td><td>{item.readiness === null ? '—' : `${item.readiness}%`}</td><td>{item.itemTasks.filter((task) => task.status !== 'done').length}</td><td>{item.target || '—'}</td></tr>)}</tbody></table></div>
      <section className="rounded-2xl border border-bhodix-border bg-bhodix-card p-5 shadow-sm"><h2 className="text-sm font-bold text-bhodix-text">Delivery timeline</h2><p className="mb-4 mt-1 text-[11px] text-bhodix-textSubtle">Projects with a recorded target date, in date order.</p><div className="space-y-3 border-l border-indigo-500/30 pl-4">{portfolios.filter((item) => item.target).sort((a, b) => a.target.localeCompare(b.target)).map((item) => <button key={item.id} onClick={() => { setSelectedProject(item.id); setPortfolioMode(false); }} className="relative flex w-full flex-wrap items-center justify-between gap-2 text-left"><span className="absolute -left-[21px] h-2.5 w-2.5 rounded-full bg-indigo-500" /><span className="text-xs font-semibold text-bhodix-text">{item.name}</span><span className="font-mono text-[10px] text-indigo-500">{item.target}</span><span className="basis-full text-[10px] text-bhodix-textSubtle">{item.data.meta?.stage || 'Stage not set'} · {item.readiness === null ? 'Readiness not recorded' : `${item.readiness}% ready`}</span></button>)}{!portfolios.some((item) => item.target) && <p className="text-xs text-bhodix-textSubtle">No project target dates are recorded yet.</p>}</div></section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{portfolios.map((item) => <section key={item.id} className="rounded-2xl border border-bhodix-border bg-bhodix-card p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-bhodix-text">{item.name}</h2><p className="mt-1 text-[11px] text-bhodix-textSubtle">{item.data.meta?.stage || 'Stage not set'}{item.target ? ` · Target ${item.target}` : ''}</p></div><button onClick={() => { setSelectedProject(item.id); setPortfolioMode(false); }} className="text-xs text-indigo-500">Open</button></div><div className="mt-4 flex items-center justify-between text-[11px] text-bhodix-textMuted"><span>Feature readiness</span><span>{item.readiness === null ? 'No readiness data' : `${item.readiness}%`}</span></div><div className="mt-1 h-2 rounded-full bg-bhodix-surface"><div className="h-2 rounded-full bg-indigo-500" style={{ width: `${item.readiness || 0}%` }} /></div><div className="mt-4 flex flex-wrap gap-2 text-[10px]">{item.itemFeatures.filter((feature) => feature.status?.toLowerCase() !== 'live').slice(0, 4).map((feature) => <span key={feature.id || feature.feature_name} className="rounded-full bg-amber-500/10 px-2 py-1 text-amber-600 dark:text-amber-300">Readiness: {feature.feature_name} · {feature.status || 'status missing'}</span>)}</div>{!item.itemFeatures.length && <p className="mt-3 text-[10px] text-bhodix-textSubtle">Add feature statuses to build a release readiness checklist.</p>}<div className="mt-4 border-t border-bhodix-borderSubtle pt-3 text-[10px] text-bhodix-textSubtle">Dependencies: {Array.isArray(item.data.meta?.dependencies) && item.data.meta.dependencies.length ? item.data.meta.dependencies.join(', ') : 'None recorded'}</div></section>)}</div>
      <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 text-xs text-bhodix-textMuted"><strong className="text-bhodix-text">Project setup guide:</strong> add a stage, target date, features, owners, and readiness values in the project overview and feature list. Missing values stay blank here rather than being estimated.</div>
    </div>;
  }

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto transition-colors">
      {/* Project Switcher Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-bhodix-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {projectList.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedProject(p.id)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all ${
                activeTab === p.id
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-bhodix-card text-bhodix-textMuted hover:text-bhodix-text border border-bhodix-border'
              }`}
            >
              {p.name}
            </button>
          ))}
          <button
            onClick={() => setIsCreateProjectOpen(true)}
            className="px-3 py-2 rounded-xl bg-bhodix-surface border border-bhodix-border text-indigo-500 hover:bg-indigo-500 hover:text-white transition-all shadow-sm"
            title="Create New Project"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-bhodix-textSubtle">
          <button onClick={() => setPortfolioMode(true)} className="mr-3 rounded-lg border border-bhodix-border px-3 py-1.5 text-[11px] font-sans text-bhodix-textMuted hover:text-indigo-500">Portfolio compare</button>
          <span>Target Live:</span>
          <span className="text-amber-500 dark:text-amber-300 font-semibold">{meta.target_live_date || '—'}</span>
          <span>•</span>
          <span>Version:</span>
          <span className="text-bhodix-text font-medium">{meta.current_version || '—'}</span>
        </div>
      </div>

      {/* Project Information Panel */}
      <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-6 space-y-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-bhodix-text tracking-tight">
                {meta.name || activeTab.toUpperCase()}
              </h1>
              {meta.category && (
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border border-indigo-500/20 font-mono font-medium">
                  {meta.category}
                </span>
              )}
            </div>
            <p className="text-xs text-bhodix-textMuted leading-relaxed">
              {meta.tagline}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="px-3.5 py-2.5 rounded-xl bg-bhodix-surface border border-bhodix-borderSubtle text-xs">
              <span className="text-bhodix-textSubtle block text-[10px] font-mono">PRIMARY CLIENT</span>
              <span className="font-semibold text-bhodix-text">{meta.primary_client || '—'}</span>
            </div>
            <div className="px-3.5 py-2.5 rounded-xl bg-bhodix-surface border border-bhodix-borderSubtle text-xs">
              <span className="text-bhodix-textSubtle block text-[10px] font-mono">INFRA HOST</span>
              <span className="font-semibold text-bhodix-text">{meta.tech_stack?.hosting || '—'}</span>
            </div>
          </div>
        </div>

        {/* Tech Stack Pills */}
        <div className="pt-4 border-t border-bhodix-border flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono text-bhodix-textSubtle mr-2 flex items-center gap-1">
            <Cpu className="w-3.5 h-3.5" /> Stack:
          </span>
          {meta.tech_stack && Object.entries(meta.tech_stack).filter(([, val]) => val).map(([key, val]) => (
            <span 
              key={key} 
              className="px-2.5 py-1 rounded-md bg-bhodix-surface text-bhodix-text text-xs border border-bhodix-borderSubtle font-mono"
            >
              <strong className="text-indigo-500 dark:text-indigo-400 capitalize">{key}:</strong> {val}
            </span>
          ))}
        </div>
        <div className="pt-4 border-t border-bhodix-border flex flex-wrap gap-2">
          <button onClick={() => { setSelectedProject(activeTab); setCurrentView('planner'); }} className="px-3 py-1.5 rounded-lg bg-bhodix-surface border border-bhodix-border text-xs text-bhodix-textMuted hover:text-indigo-500">View tasks</button>
          <button onClick={() => { setSelectedProject(activeTab); setCurrentView('monitor'); }} className="px-3 py-1.5 rounded-lg bg-bhodix-surface border border-bhodix-border text-xs text-bhodix-textMuted hover:text-indigo-500">View services</button>
          <button onClick={() => { setSelectedProject(activeTab); setCurrentView('finance'); }} className="px-3 py-1.5 rounded-lg bg-bhodix-surface border border-bhodix-border text-xs text-bhodix-textMuted hover:text-indigo-500">View finances</button>
        </div>
      </div>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-bhodix-border bg-bhodix-card p-5 space-y-3">
          <div><h2 className="text-sm font-semibold text-bhodix-text">Milestones</h2><p className="text-[11px] text-bhodix-textSubtle">Track dated project checkpoints.</p></div>
          <div className="space-y-2">{(meta.milestones || []).map((item, index) => <div key={`${item.name}-${index}`} className="flex justify-between gap-2 rounded-lg bg-bhodix-surface p-2 text-xs"><span className="text-bhodix-text">{item.name}</span><time className="font-mono text-indigo-500">{item.date}</time></div>)}{!meta.milestones?.length && <p className="text-xs text-bhodix-textSubtle">No milestones yet.</p>}</div>
          {user?.role !== 'viewer' && <form onSubmit={(e) => submitProjectUpdate(e, { milestone: milestoneDraft }, () => setMilestoneDraft({ name: '', date: '' }))} className="grid grid-cols-2 gap-2 border-t border-bhodix-border pt-3"><input required aria-label="Milestone name" value={milestoneDraft.name} onChange={(e) => setMilestoneDraft((draft) => ({ ...draft, name: e.target.value }))} placeholder="Milestone" className="col-span-2 rounded-lg border border-bhodix-border bg-bhodix-surface px-2.5 py-2 text-xs text-bhodix-text" /><input required aria-label="Milestone date" type="date" value={milestoneDraft.date} onChange={(e) => setMilestoneDraft((draft) => ({ ...draft, date: e.target.value }))} className="min-w-0 rounded-lg border border-bhodix-border bg-bhodix-surface px-2 py-2 text-xs text-bhodix-text" /><button className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">Add milestone</button></form>}
        </div>

        <div className="rounded-2xl border border-bhodix-border bg-bhodix-card p-5 space-y-3">
          <div><h2 className="text-sm font-semibold text-bhodix-text">Project goals</h2><p className="text-[11px] text-bhodix-textSubtle">Record outcomes this project should deliver.</p></div>
          <div className="space-y-2">{(meta.goals || []).map((item, index) => <div key={`${item.name}-${index}`} className="rounded-lg bg-bhodix-surface p-2 text-xs text-bhodix-text">{item.name}<span className="ml-2 text-[10px] uppercase text-bhodix-textSubtle">{item.status}</span></div>)}{!meta.goals?.length && <p className="text-xs text-bhodix-textSubtle">No goals recorded yet.</p>}</div>
          {user?.role !== 'viewer' && <form onSubmit={(e) => submitProjectUpdate(e, { goal: { name: goalDraft } }, () => setGoalDraft(''))} className="flex gap-2 border-t border-bhodix-border pt-3"><input required aria-label="Project goal" value={goalDraft} onChange={(e) => setGoalDraft(e.target.value)} placeholder="Add an outcome" className="min-w-0 flex-1 rounded-lg border border-bhodix-border bg-bhodix-surface px-2.5 py-2 text-xs text-bhodix-text" /><button className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">Add goal</button></form>}
        </div>

        <div className="rounded-2xl border border-bhodix-border bg-bhodix-card p-5 space-y-3">
          <div><h2 className="text-sm font-semibold text-bhodix-text">Project health</h2><p className="text-[11px] text-bhodix-textSubtle">Share a short delivery check-in with the team.</p></div>
          <div className="max-h-40 space-y-2 overflow-y-auto">{[...(meta.health_checkins || [])].reverse().map((item, index) => <div key={`${item.date}-${index}`} className="rounded-lg bg-bhodix-surface p-2 text-xs"><div className="flex justify-between gap-2"><span className="font-semibold uppercase text-bhodix-text">{(item.status || 'on_track').replace('_', ' ')}</span><time className="text-[10px] text-bhodix-textSubtle">{item.date}</time></div><p className="mt-1 text-bhodix-textMuted">{item.summary}</p><span className="text-[10px] text-bhodix-textSubtle">{item.author}</span></div>)}{!meta.health_checkins?.length && <p className="text-xs text-bhodix-textSubtle">No project check-ins yet.</p>}</div>
          {user?.role !== 'viewer' && <form onSubmit={(e) => submitProjectUpdate(e, { checkin: checkinDraft }, () => setCheckinDraft({ status: 'on_track', summary: '' }))} className="space-y-2 border-t border-bhodix-border pt-3"><select aria-label="Project health status" value={checkinDraft.status} onChange={(e) => setCheckinDraft((draft) => ({ ...draft, status: e.target.value }))} className="w-full rounded-lg border border-bhodix-border bg-bhodix-surface px-2.5 py-2 text-xs text-bhodix-text"><option value="on_track">On track</option><option value="at_risk">At risk</option><option value="blocked">Blocked</option></select><textarea required aria-label="Health update" maxLength={500} value={checkinDraft.summary} onChange={(e) => setCheckinDraft((draft) => ({ ...draft, summary: e.target.value }))} placeholder="What's changed since the last update?" className="w-full rounded-lg border border-bhodix-border bg-bhodix-surface px-2.5 py-2 text-xs text-bhodix-text" /><button className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">Post check-in</button></form>}
        </div>
      </section>

      {/* Feature Inventory Section */}
      <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-6 space-y-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-bhodix-text tracking-tight flex items-center gap-2">
              Feature Inventory & Readiness Matrix
              <span className="text-xs font-mono font-normal text-bhodix-textSubtle">
                ({filteredFeatures.length} Features)
              </span>
            </h2>
            <p className="text-xs text-bhodix-textMuted mt-0.5">
              Live status parsed directly from <code className="text-indigo-500 font-mono">features.md</code>
            </p>
          </div>
          <button onClick={() => setShowFeatureForm(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shrink-0">
            <Plus className="w-3.5 h-3.5" /> Add Feature
          </button>

          {/* Filter & Search */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-bhodix-textSubtle" />
              <input
                type="text"
                placeholder="Search features..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 rounded-lg bg-bhodix-surface border border-bhodix-border text-xs text-bhodix-text placeholder-bhodix-textSubtle focus:outline-none focus:border-indigo-500 w-44 font-mono"
              />
            </div>

            <div className="flex items-center bg-bhodix-surface border border-bhodix-border rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setFeatureFilter('all')}
                className={`px-2.5 py-1 rounded-md transition-all ${featureFilter === 'all' ? 'bg-indigo-600 text-white font-medium' : 'text-bhodix-textMuted hover:text-bhodix-text'}`}
              >
                All
              </button>
              <button
                onClick={() => setFeatureFilter('live')}
                className={`px-2.5 py-1 rounded-md transition-all ${featureFilter === 'live' ? 'bg-indigo-600 text-white font-medium' : 'text-bhodix-textMuted hover:text-bhodix-text'}`}
              >
                Live
              </button>
              <button
                onClick={() => setFeatureFilter('testing')}
                className={`px-2.5 py-1 rounded-md transition-all ${featureFilter === 'testing' ? 'bg-indigo-600 text-white font-medium' : 'text-bhodix-textMuted hover:text-bhodix-text'}`}
              >
                Testing
              </button>
              <button
                onClick={() => setFeatureFilter('staged')}
                className={`px-2.5 py-1 rounded-md transition-all ${featureFilter === 'staged' ? 'bg-indigo-600 text-white font-medium' : 'text-bhodix-textMuted hover:text-bhodix-text'}`}
              >
                Staged
              </button>
            </div>
          </div>
        </div>

        {/* Features Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-bhodix-border text-bhodix-textSubtle uppercase tracking-wider font-mono text-[11px]">
                <th className="pb-3 font-medium">ID</th>
                <th className="pb-3 font-medium">Feature Name</th>
                <th className="pb-3 font-medium">Description</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium">Readiness</th>
                <th className="pb-3 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bhodix-borderSubtle">
              {filteredFeatures.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-bhodix-textSubtle font-mono">
                    No features recorded yet.
                  </td>
                </tr>
              )}
              {filteredFeatures.map((feat, idx) => {
                const isLive = feat.status?.toLowerCase() === 'live';
                const isTesting = feat.status?.toLowerCase().includes('testing');
                const readinessValue = Math.max(0, Math.min(100, parseFloat(feat.readiness) || 0));
                return (
                  <tr key={idx} data-feature-id={feat.id || ''} className="hover:bg-bhodix-surface/40 transition-colors">
                    <td className="py-3.5 font-mono text-indigo-500 dark:text-indigo-400 font-semibold">
                      {feat.id}
                    </td>
                    <td className="py-3.5 font-semibold text-bhodix-text">
                      {feat.feature_name}
                    </td>
                    <td className="py-3.5 text-bhodix-textMuted max-w-md">
                      {feat.description}
                    </td>
                    <td className="py-3.5">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-medium ${
                        isLive 
                          ? 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20'
                          : isTesting
                          ? 'bg-amber-500/10 text-amber-500 dark:text-amber-300 border border-amber-500/20'
                          : 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-300 border border-indigo-500/20'
                      }`}>
                        {feat.status}
                      </span>
                    </td>
                    <td className="py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-bhodix-text font-medium text-[11px]">
                          {feat.readiness || '—'}
                        </span>
                        <div role="progressbar" aria-label={`${feat.feature_name} readiness`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={readinessValue} className="w-16 bg-bhodix-surface rounded-full h-1.5 overflow-hidden">
                          <div 
                            className={`h-1.5 rounded-full ${isLive ? 'bg-emerald-500' : 'bg-amber-500'}`}
                            style={{ width: `${readinessValue}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 text-bhodix-textMuted font-mono text-[11px]">
                      {feat.owner}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {showFeatureForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowFeatureForm(false); }}>
          <form ref={featureDialogRef} role="dialog" aria-modal="true" aria-labelledby="new-feature-title" onSubmit={submitFeature} className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-bhodix-border bg-bhodix-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between"><h2 id="new-feature-title" className="text-base font-bold text-bhodix-text">Add feature</h2><button type="button" aria-label="Close dialog" onClick={() => setShowFeatureForm(false)}><span aria-hidden="true">×</span></button></div>
            <label className="block text-xs text-bhodix-textMuted">Feature name *<input required autoFocus value={featureDraft.name} onChange={(e) => setFeatureDraft({ ...featureDraft, name: e.target.value })} className="mt-1 w-full rounded-lg border border-bhodix-border bg-bhodix-surface p-2.5 text-bhodix-text" /></label>
            <label className="block text-xs text-bhodix-textMuted">Description<textarea value={featureDraft.description} onChange={(e) => setFeatureDraft({ ...featureDraft, description: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-bhodix-border bg-bhodix-surface p-2.5 text-bhodix-text" /></label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block text-xs text-bhodix-textMuted">Status<select value={featureDraft.status} onChange={(e) => setFeatureDraft({ ...featureDraft, status: e.target.value })} className="mt-1 w-full rounded-lg border border-bhodix-border bg-bhodix-surface p-2.5 text-bhodix-text">{['Planned', 'Staged', 'In Testing', 'Live'].map((s) => <option key={s}>{s}</option>)}</select></label>
              <label className="block text-xs text-bhodix-textMuted">Readiness (%)<input type="number" min="0" max="100" value={featureDraft.readiness} onChange={(e) => setFeatureDraft({ ...featureDraft, readiness: e.target.value })} className="mt-1 w-full rounded-lg border border-bhodix-border bg-bhodix-surface p-2.5 text-bhodix-text" /></label>
              <label className="block text-xs text-bhodix-textMuted">Owner<input value={featureDraft.owner} onChange={(e) => setFeatureDraft({ ...featureDraft, owner: e.target.value })} className="mt-1 w-full rounded-lg border border-bhodix-border bg-bhodix-surface p-2.5 text-bhodix-text" /></label>
            </div>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowFeatureForm(false)} className="px-3 py-2 text-xs text-bhodix-textMuted">Cancel</button><button disabled={savingFeature} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{savingFeature ? 'Saving…' : 'Add feature'}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
