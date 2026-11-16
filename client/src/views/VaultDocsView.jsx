import React, { useState, useEffect } from 'react';
import {
  FileText,
  Save,
  Eye,
  Edit3,
  Check,
  Folder,
  FileCheck,
  Shield,
  ChevronRight,
  Code
} from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { useToast } from '../components/ToastProvider';

function InlineMarkdown({ children }) {
  return String(children).split(/(https?:\/\/[^\s<]+|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).map((part, index) => {
    if (/^https?:\/\//.test(part)) return <a key={index} href={part} target="_blank" rel="noreferrer" className="text-indigo-500 underline break-all">{part}</a>;
    if (part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`')) return <code key={index} className="rounded bg-bhodix-bg px-1 py-0.5 font-mono text-[0.9em]">{part.slice(1, -1)}</code>;
    if (part.startsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function MarkdownPreview({ content }) {
  const lines = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').split(/\r?\n/);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (/^\s*---+\s*$/.test(line)) { blocks.push(<hr key={`hr-${i}`} className="border-bhodix-border" />); i += 1; continue; }
    if (line.startsWith('```')) {
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i += 1;
      blocks.push(<pre key={`code-${i}`} className="overflow-x-auto rounded-lg bg-bhodix-bg p-4 font-mono text-xs text-bhodix-text"><code>{code.join('\n')}</code></pre>);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^#+/)[0].length;
      const text = line.replace(/^#{1,6}\s+/, '');
      blocks.push(React.createElement(`h${level}`, { key: `heading-${i}`, id: `doc-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, className: 'scroll-mt-4 font-bold text-bhodix-text' }, <InlineMarkdown>{text}</InlineMarkdown>));
      i += 1;
      continue;
    }
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      const headers = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(<div key={`table-${i}`} className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead><tr className="border-b border-bhodix-border">{headers.map((cell, n) => <th key={n} className="px-3 py-2 font-semibold"><InlineMarkdown>{cell}</InlineMarkdown></th>)}</tr></thead><tbody>{rows.map((row, r) => <tr key={r} className="border-b border-bhodix-borderSubtle">{headers.map((_, n) => <td key={n} className="px-3 py-2 text-bhodix-textMuted"><InlineMarkdown>{row[n] || ''}</InlineMarkdown></td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ''));
      blocks.push(<ul key={`list-${i}`} className="list-disc space-y-1 pl-5 text-bhodix-textMuted">{items.map((item, n) => <li key={n}><InlineMarkdown>{item.replace(/^\[[ xX]\]\s*/, '')}</InlineMarkdown></li>)}</ul>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      blocks.push(<blockquote key={`quote-${i}`} className="border-l-2 border-indigo-500 pl-3 text-bhodix-textMuted"><InlineMarkdown>{line.replace(/^>\s?/, '')}</InlineMarkdown></blockquote>);
      i += 1;
      continue;
    }
    const paragraph = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^#{1,6}\s|^```|^\||^\s*[-*+]\s+|^>\s?/.test(lines[i])) paragraph.push(lines[i++]);
    blocks.push(<p key={`p-${i}`} className="leading-7 text-bhodix-textMuted"><InlineMarkdown>{paragraph.join(' ')}</InlineMarkdown></p>);
  }
  return <div className="space-y-4 text-sm">{blocks}</div>;
}

export default function VaultDocsView() {
  const { vault, saveFile, apiFetch, projectList, hasUnsavedDocChanges, setHasUnsavedDocChanges } = useVault();
  const { showToast } = useToast();

  // Index is built from the vault itself, so new projects and docs appear automatically.
  const docCatalog = [
    ...projectList.map(({ id, name }) => ({
      group: name,
      items: [
        { title: 'Overview', path: `projects/${id}/project.md` },
        { title: 'Features', path: `projects/${id}/features.md` },
        { title: 'Tasks', path: `projects/${id}/tasks.md` },
        { title: 'Finances', path: `projects/${id}/finances.md` },
        ...(vault.projects[id].docs || []).map((d) => ({ title: d.meta?.title || d.fileName, path: d.relativePath }))
      ]
    })),
    {
      group: 'Bhodhix Corporate & Operations',
      items: [
        { title: 'Company Profile & Milestones', path: 'company.md' },
        { title: 'Consolidated Financial Ledger', path: 'finances/bhodix-ledger.md' },
        { title: 'Monitored Endpoints', path: 'monitoring/endpoints.md' },
        { title: 'Incident History', path: 'monitoring/incidents.md' },
        ...(vault.docs || []).map((d) => ({ title: d.meta?.title || d.fileName, path: d.relativePath }))
      ]
    }
  ];

  const [selectedPath, setSelectedPath] = useState(() => localStorage.getItem('bhodix_doc_to_open') || 'company.md');
  const [fileContent, setFileContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [editorMode, setEditorMode] = useState('preview');
  const [docSearch, setDocSearch] = useState('');
  const [favorites, setFavorites] = useState(() => { try { return JSON.parse(localStorage.getItem('bhodix_doc_favorites') || '[]'); } catch { return []; } });
  const [recentDocs, setRecentDocs] = useState(() => { try { return JSON.parse(localStorage.getItem('bhodix_recent_docs') || '[]'); } catch { return []; } });
  const [draftConflict, setDraftConflict] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchDoc = async () => {
      try {
        const res = await apiFetch(`/api/vault/file?path=${encodeURIComponent(selectedPath)}`);
        const data = await res.json();
        if (data.success && active) {
          let draft = null;
          try { draft = JSON.parse(localStorage.getItem(`bhodix_doc_draft:${selectedPath}`) || 'null'); } catch { /* invalid local draft */ }
          const recoverable = typeof draft?.content === 'string' && draft.base === data.content;
          setDraftConflict(typeof draft?.content === 'string' && !recoverable ? draft.content : null);
          const content = recoverable ? draft.content : data.content;
          setFileContent(content);
          setSavedContent(data.content);
          setHasUnsavedDocChanges(content !== data.content);
        }
      } catch (err) {
        console.error('Error fetching doc:', err);
      }
    };
    fetchDoc();
    return () => { active = false; };
  }, [selectedPath]);

  useEffect(() => {
    const openRequestedDoc = (event) => {
      const path = event.detail;
      if (!path) return;
      if (hasUnsavedDocChanges && !window.confirm('You have unsaved document changes. Switch documents and discard them?')) {
        localStorage.removeItem('bhodix_doc_to_open');
        return;
      }
      setSelectedPath(path);
      localStorage.setItem('bhodix_doc_to_open', path);
    };
    const beforeUnload = (event) => {
      if (!hasUnsavedDocChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('bhodix:open-document', openRequestedDoc);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('bhodix:open-document', openRequestedDoc);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [hasUnsavedDocChanges]);

  const selectPath = (path) => {
    if (path === selectedPath) return;
    if (hasUnsavedDocChanges && !window.confirm('You have unsaved document changes. Switch documents and discard them?')) return;
    setSelectedPath(path);
    localStorage.setItem('bhodix_doc_to_open', path);
    const recent = [path, ...recentDocs.filter((item) => item !== path)].slice(0, 8);
    setRecentDocs(recent);
    try { localStorage.setItem('bhodix_recent_docs', JSON.stringify(recent)); } catch { /* storage unavailable */ }
  };

  const changeContent = (content) => {
    setFileContent(content);
    setHasUnsavedDocChanges(content !== savedContent);
    try { if (content === savedContent) localStorage.removeItem(`bhodix_doc_draft:${selectedPath}`); else localStorage.setItem(`bhodix_doc_draft:${selectedPath}`, JSON.stringify({ content, base: savedContent, savedAt: Date.now() })); } catch { /* storage unavailable */ }
  };

  const handleSave = async () => {
    setSaving(true);
    const ok = await saveFile(selectedPath, fileContent);
    setSaving(false);
    if (ok) {
      setSavedContent(fileContent);
      setHasUnsavedDocChanges(false);
      setDraftConflict(null);
      try { localStorage.removeItem(`bhodix_doc_draft:${selectedPath}`); } catch { /* storage unavailable */ }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } else showToast('Could not save document', 'error');
  };

  const headings = [...fileContent.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match) => ({ text: match[2], level: match[1].length }));
  const qualityHints = [
    !fileContent.trim() && 'This document is empty.',
    fileContent.trim() && !/^---\r?\n/.test(fileContent) && 'No YAML frontmatter was found.',
    fileContent.trim() && !/^#{1,2}\s/m.test(fileContent) && 'Add a heading to make this document easier to scan.'
  ].filter(Boolean);
  const toggleFavorite = () => {
    const next = favorites.includes(selectedPath) ? favorites.filter((path) => path !== selectedPath) : [...favorites, selectedPath];
    setFavorites(next);
    try { localStorage.setItem('bhodix_doc_favorites', JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  const recoverConflictedDraft = () => {
    setFileContent(draftConflict);
    setHasUnsavedDocChanges(draftConflict !== savedContent);
    try { localStorage.setItem(`bhodix_doc_draft:${selectedPath}`, JSON.stringify({ content: draftConflict, base: savedContent, savedAt: Date.now() })); } catch { /* storage unavailable */ }
    setDraftConflict(null);
    setEditorMode('split');
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 transition-colors">
      <div className="border-b border-bhodix-border pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-bhodix-text tracking-tight flex items-center gap-2">
            Document, Compliance & Test Vault
          </h1>
          <p className="text-xs text-bhodix-textMuted mt-0.5">
            Native Markdown documents directly readable and writable by AI agents & team members
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-bhodix-card border border-bhodix-border rounded-xl p-0.5 text-xs">
            <button
              onClick={() => setEditorMode('preview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                editorMode === 'preview'
                  ? 'bg-indigo-600 text-white font-medium shadow-sm'
                  : 'text-bhodix-textMuted hover:text-bhodix-text'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview</span>
            </button>
            <button
              onClick={() => setEditorMode('edit')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                editorMode === 'edit'
                  ? 'bg-indigo-600 text-white font-medium shadow-sm'
                  : 'text-bhodix-textMuted hover:text-bhodix-text'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Raw Editor</span>
            </button>
            <button onClick={() => setEditorMode('split')} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${editorMode === 'split' ? 'bg-indigo-600 font-medium text-white shadow-sm' : 'text-bhodix-textMuted hover:text-bhodix-text'}`}><Code className="h-3.5 w-3.5" /><span>Split</span></button>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-all shadow-md disabled:opacity-50"
          >
            {saveSuccess ? <Check className="w-4 h-4 text-white" /> : <Save className="w-4 h-4" />}
            <span>{saving ? 'Saving...' : saveSuccess ? 'Saved to Disk' : 'Save Changes'}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        <div className="bg-bhodix-card border border-bhodix-border rounded-2xl p-4 space-y-4 shadow-sm">
          <div className="text-xs font-mono uppercase tracking-wider text-bhodix-textSubtle font-semibold px-2">
            Vault Index
          </div>
          <input value={docSearch} onChange={(e) => setDocSearch(e.target.value)} placeholder="Find a document…" aria-label="Find a vault document" className="w-full rounded-lg border border-bhodix-border bg-bhodix-surface px-3 py-2 text-xs text-bhodix-text" />
          {favorites.length > 0 && <div className="space-y-1"><div className="px-2 text-[10px] font-mono uppercase text-bhodix-textSubtle">Favorites</div>{favorites.map((path) => <button key={path} onClick={() => selectPath(path)} className="block w-full truncate rounded-lg px-2.5 py-2 text-left text-xs text-amber-500 hover:bg-bhodix-surface">★ {path.split('/').pop()}</button>)}</div>}
          {recentDocs.length > 0 && <div className="space-y-1"><div className="px-2 text-[10px] font-mono uppercase text-bhodix-textSubtle">Recent</div>{recentDocs.map((path) => <button key={path} onClick={() => selectPath(path)} className="block w-full truncate rounded-lg px-2.5 py-2 text-left text-xs text-bhodix-textMuted hover:bg-bhodix-surface">{path.split('/').pop()}</button>)}</div>}

          <div className="space-y-4">
            {docCatalog.map((group, gIdx) => (
              <div key={gIdx} className="space-y-1.5">
                <div className="text-[11px] font-semibold text-bhodix-textMuted flex items-center gap-1.5 px-2">
                  <Folder className="w-3.5 h-3.5 text-indigo-500" />
                  <span>{group.group}</span>
                </div>
                <div className="space-y-1 pl-2">
                  {group.items.filter((item) => `${item.title} ${item.path}`.toLowerCase().includes(docSearch.toLowerCase())).map((item, iIdx) => {
                    const active = selectedPath === item.path;
                    return (
                      <button
                        key={iIdx}
                        onClick={() => selectPath(item.path)}
                        className={`w-full text-left px-2.5 py-2 rounded-xl text-xs transition-colors flex items-center justify-between ${
                          active
                            ? 'bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-semibold'
                            : 'text-bhodix-textSubtle hover:text-bhodix-text hover:bg-bhodix-surface'
                        }`}
                      >
                        <span className="truncate">{item.title}</span>
                        {active && <ChevronRight className="w-3 h-3 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-3 bg-bhodix-card border border-bhodix-border rounded-2xl p-6 min-h-[600px] flex flex-col justify-between shadow-sm">
          <div className="relative group">
            <div className="flex items-center justify-between border-b border-bhodix-border pb-3 mb-5">
              <div className="font-mono text-xs text-indigo-500 dark:text-indigo-400 font-semibold">
                vault/{selectedPath}
              </div>
              <div className="flex items-center gap-2"><button onClick={toggleFavorite} aria-pressed={favorites.includes(selectedPath)} className="rounded-lg border border-bhodix-border px-2 py-1 text-xs text-amber-500" title="Toggle favorite">{favorites.includes(selectedPath) ? '★ Saved' : '☆ Favorite'}</button><span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bhodix-surface text-bhodix-textSubtle border border-bhodix-borderSubtle">{hasUnsavedDocChanges ? 'DRAFT RECOVERED / UNSAVED' : 'UTF-8 Markdown'}</span></div>
            </div>

            {qualityHints.length > 0 && <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-600 dark:text-amber-300">{qualityHints.join(' ')}</div>}
            {draftConflict !== null && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-[10px] text-bhodix-text"><span>A local draft differs from the current vault file. Review before replacing the newer document.</span><div className="flex gap-2"><button onClick={recoverConflictedDraft} className="rounded bg-rose-600 px-2 py-1 text-white">Open local draft</button><button onClick={() => { setDraftConflict(null); try { localStorage.removeItem(`bhodix_doc_draft:${selectedPath}`); } catch { /* storage unavailable */ } }} className="rounded border border-bhodix-border px-2 py-1">Discard local draft</button></div></div>}

            {headings.length > 0 && <nav aria-label="Document outline" className="mb-4 flex flex-wrap gap-2">{headings.map((heading, index) => <button key={`${heading.text}-${index}`} onClick={() => document.getElementById(`doc-${heading.text.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="rounded bg-bhodix-surface px-2 py-1 text-[10px] text-bhodix-textMuted hover:text-indigo-500">{'·'.repeat(Math.max(0, heading.level - 1))} {heading.text}</button>)}</nav>}

            {editorMode === 'preview' ? (
              <div className="rounded-xl p-1">
                <div className="p-5 rounded-xl bg-bhodix-surface border border-bhodix-borderSubtle select-text leading-relaxed">
                  <MarkdownPreview content={fileContent} />
                </div>
                <div className="absolute top-12 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setEditorMode('edit')}
                    aria-label="Edit this document"
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-indigo-600 text-white text-[10px] font-bold shadow-lg"
                  >
                    <Edit3 className="w-3 h-3" />
                    Edit
                  </button>
                </div>
              </div>
            ) : editorMode === 'split' ? (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2"><textarea aria-label="Markdown source" value={fileContent} onChange={(e) => changeContent(e.target.value)} rows={26} className="w-full resize-y rounded-xl border border-bhodix-border bg-bhodix-surface p-4 font-mono text-xs leading-relaxed text-bhodix-text focus:border-indigo-500 focus:outline-none" spellCheck={false} /><div className="max-h-[60vh] overflow-auto rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-5"><MarkdownPreview content={fileContent} /></div></div>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={fileContent}
                  onChange={(e) => changeContent(e.target.value)}
                  rows={26}
                  className="w-full p-4 rounded-xl bg-bhodix-surface border border-bhodix-border font-mono text-xs text-bhodix-text focus:outline-none focus:border-indigo-500 leading-relaxed resize-y selection:bg-indigo-500/30"
                  spellCheck={false}
                />
              </div>
            )}
          </div>

          <div className="pt-4 mt-6 border-t border-bhodix-border flex items-center justify-between text-[11px] font-mono text-bhodix-textSubtle">
            <span>Markdown source · browser drafts recover locally</span>
            <div className="flex items-center gap-3"><button onClick={() => setEditorMode('split')} className="text-indigo-500 hover:text-indigo-400">Split edit</button><span>{hasUnsavedDocChanges ? 'Draft not saved to vault' : 'Saved to vault'}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
