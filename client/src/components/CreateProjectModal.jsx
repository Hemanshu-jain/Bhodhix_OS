import React, { useEffect, useState } from 'react';
import { 
  X, 
  FolderPlus, 
  Layers, 
  Calendar, 
  Server, 
  Globe, 
  Cpu, 
  User, 
  ArrowRight,
  Sparkles,
  AlertCircle
} from 'lucide-react';
import { useVault } from '../context/VaultContext';
import useDialogFocus from '../lib/useDialogFocus';

export default function CreateProjectModal({ isOpen, onClose }) {
  const { createProject, setSelectedProject } = useVault();
  const dialogRef = useDialogFocus(isOpen);
  
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [category, setCategory] = useState('');
  const [tagline, setTagline] = useState('');
  const [stage, setStage] = useState('In Development');
  const [targetLiveDate, setTargetLiveDate] = useState('');
  const [primaryClient, setPrimaryClient] = useState('');
  const [liveUrl, setLiveUrl] = useState('');
  const [apiHealthUrl, setApiHealthUrl] = useState('');
  const [frontend, setFrontend] = useState('');
  const [backend, setBackend] = useState('');
  const [caching, setCaching] = useState('');
  const [hosting, setHosting] = useState('');
  const [description, setDescription] = useState('');
  
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnEscape = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleNameChange = (val) => {
    setName(val);
    if (!id || id === name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, -1)) {
      const slug = val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      setId(slug);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter a project name');
      return;
    }
    setError('');
    setSubmitting(true);

    const projectData = {
      name: name.trim(),
      id: id.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      category: category.trim(),
      tagline: tagline.trim(),
      stage,
      targetLiveDate,
      primaryClient: primaryClient.trim(),
      liveUrl: liveUrl.trim(),
      apiHealthUrl: apiHealthUrl.trim(),
      frontend,
      backend,
      caching,
      hosting,
      description: description.trim()
    };

    const res = await createProject(projectData);
    setSubmitting(false);

    if (res.success) {
      setSelectedProject(projectData.id);
      onClose();
      // Reset form
      setName('');
      setId('');
      setTagline('');
      setDescription('');
    } else {
      setError(res.error || 'Failed to initialize project');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="create-project-title" className="bg-bhodix-card border border-bhodix-border rounded-2xl max-w-2xl w-full p-6 space-y-6 shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-bhodix-border pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500">
              <FolderPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 id="create-project-title" className="text-lg font-bold text-bhodix-text tracking-tight flex items-center gap-2">
                Scaffold New Bhodhix Project
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 uppercase">
                  Markdown Vault Sync
                </span>
              </h2>
              <p className="text-xs text-bhodix-textMuted mt-0.5">
                Automatically initializes `.md` feature matrices, tasks, financial ledgers, and health monitors.
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            aria-label="Close create project dialog"
            className="p-1 rounded-lg text-bhodix-textSubtle hover:text-bhodix-text transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Identity & Slug */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-bhodix-textSubtle font-mono mb-1 uppercase text-[10px]">
                Project Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. FinBridge Exchange"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-bhodix-textSubtle font-mono mb-1 uppercase text-[10px]">
                Directory / Slug ID *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. finbridge"
                value={id}
                onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Category & Stage */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-bhodix-textSubtle font-mono mb-1 uppercase text-[10px]">
                Category
              </label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Web platform, Desktop software"
                className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-bhodix-textSubtle font-mono mb-1 uppercase text-[10px]">
                Development Stage
              </label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500"
              >
                <option value="In Development">In Development</option>
                <option value="Beta Testing">Beta Testing</option>
                <option value="Client UAT / Staging">Client UAT / Staging</option>
                <option value="Commercial Production">Commercial Production</option>
              </select>
            </div>
            <div>
              <label className="block text-bhodix-textSubtle font-mono mb-1 uppercase text-[10px]">
                Target Live Date
              </label>
              <input
                type="date"
                value={targetLiveDate}
                onChange={(e) => setTargetLiveDate(e.target.value)}
                className="w-full p-2 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Tagline & Primary Client */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-bhodix-textSubtle font-mono mb-1 uppercase text-[10px]">
                Tagline / Value Proposition
              </label>
              <input
                type="text"
                placeholder="Institutional bridge for secondary market transactions"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-bhodix-textSubtle font-mono mb-1 uppercase text-[10px]">
                Primary Client / Partner
              </label>
              <input
                type="text"
                placeholder="Client or partner name"
                value={primaryClient}
                onChange={(e) => setPrimaryClient(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Infrastructure & Endpoints */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-bhodix-textSubtle font-mono mb-1 uppercase text-[10px]">
                Live Web App URL
              </label>
              <input
                type="text"
                placeholder="https://app.example.com"
                value={liveUrl}
                onChange={(e) => setLiveUrl(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-bhodix-textSubtle font-mono mb-1 uppercase text-[10px]">
                Health Check Endpoint URL (Heartbeat)
              </label>
              <input
                type="text"
                placeholder="https://api.example.com/health"
                value={apiHealthUrl}
                onChange={(e) => setApiHealthUrl(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Tech Stack */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-bhodix-textSubtle font-mono mb-1 uppercase text-[9px]">Frontend</label>
              <input
                type="text"
                value={frontend}
                onChange={(e) => setFrontend(e.target.value)}
                className="w-full p-2 rounded-lg bg-bhodix-surface border border-bhodix-border text-bhodix-text font-mono"
              />
            </div>
            <div>
              <label className="block text-bhodix-textSubtle font-mono mb-1 uppercase text-[9px]">Backend</label>
              <input
                type="text"
                value={backend}
                onChange={(e) => setBackend(e.target.value)}
                className="w-full p-2 rounded-lg bg-bhodix-surface border border-bhodix-border text-bhodix-text font-mono"
              />
            </div>
            <div>
              <label className="block text-bhodix-textSubtle font-mono mb-1 uppercase text-[9px]">Caching</label>
              <input
                type="text"
                value={caching}
                onChange={(e) => setCaching(e.target.value)}
                className="w-full p-2 rounded-lg bg-bhodix-surface border border-bhodix-border text-bhodix-text font-mono"
              />
            </div>
            <div>
              <label className="block text-bhodix-textSubtle font-mono mb-1 uppercase text-[9px]">Hosting</label>
              <input
                type="text"
                value={hosting}
                onChange={(e) => setHosting(e.target.value)}
                className="w-full p-2 rounded-lg bg-bhodix-surface border border-bhodix-border text-bhodix-text font-mono"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-bhodix-textSubtle font-mono mb-1 uppercase text-[10px]">
              Detailed Architectural Overview
            </label>
            <textarea
              rows={2}
              placeholder="Describe core problem solved, institutional user flows, and integrations..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500 leading-relaxed"
            />
          </div>

          {/* Submit Actions */}
          <div className="pt-4 border-t border-bhodix-border flex items-center justify-between">
            <span className="text-[11px] font-mono text-bhodix-textSubtle">
              Creates: <code className="text-indigo-500">vault/projects/{id || 'slug'}/</code>
            </span>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs text-bhodix-textMuted hover:text-bhodix-text"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 flex items-center gap-2 disabled:opacity-50"
              >
                <span>{submitting ? 'Scaffolding Project...' : 'Initialize & Mount Project'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
