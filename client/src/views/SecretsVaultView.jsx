import React, { useEffect, useRef, useState } from 'react';
import { Copy, Eye, EyeOff, KeyRound, LockKeyhole, Plus, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { useToast } from '../components/ToastProvider';
import { createSecretsVault, decryptSecrets, encryptSecrets } from '../lib/secretsCrypto';

const DEFAULT_VAULT_NAME = 'Secrets Vault';
const CATEGORIES = ['Account password', 'One-time code', 'Test account', 'Client ID / secret', 'API key / webhook', 'Database credential', 'Server / cloud access', 'Third-party integration', 'Certificate', 'Other'];
const EXPOSURE = [
  ['serverSide', 'Server-side'],
  ['customerFacing', 'Customer-facing'],
  ['clientFacing', 'Client-facing'],
  ['thirdParty', 'Third-party']
];
const INPUT = 'w-full rounded-lg border border-bhodix-border bg-bhodix-surface px-3 py-2 text-sm text-bhodix-text placeholder:text-bhodix-textSubtle focus:border-indigo-500 focus:outline-none';
const makeEntry = () => ({
  title: '', project: '', category: 'Account password', segment: '', expiresAt: '', url: '', notes: '',
  serverSide: false, customerFacing: false, clientFacing: false, thirdParty: false,
  fields: [{ label: 'Password', value: '' }]
});
const entryFields = (entry) => Array.isArray(entry.fields) && entry.fields.length
  ? entry.fields
  : [
      ...(entry.username ? [{ label: entry.category === 'Client ID / secret' ? 'Client ID' : 'Username', value: entry.username }] : []),
      ...(entry.secret ? [{ label: entry.category === 'Client ID / secret' ? 'Client secret' : 'Password / secret / code', value: entry.secret }] : [])
    ];

export default function SecretsVaultView() {
  const { apiFetch, projectList, user } = useVault();
  const { showToast } = useToast();
  const [revision, setRevision] = useState(0);
  const [envelope, setEnvelope] = useState(null);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState(null);
  const [salt, setSalt] = useState(null);
  const [entries, setEntries] = useState([]);
  const [vaultName, setVaultName] = useState(DEFAULT_VAULT_NAME);
  const [nameDraft, setNameDraft] = useState(DEFAULT_VAULT_NAME);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [draft, setDraft] = useState(makeEntry);
  const [editingId, setEditingId] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [visible, setVisible] = useState({});
  const [auditHistory, setAuditHistory] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lastActivity = useRef(Date.now());
  const canManage = ['owner', 'admin'].includes(user?.role);

  const loadEnvelope = async () => {
    const response = await apiFetch('/api/secrets-vault', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Could not load the encrypted vault');
    setEnvelope(data.envelope);
    setRevision(data.revision || 0);
  };

  const loadAudit = async () => {
    const response = await apiFetch('/api/secrets-vault/audit', { cache: 'no-store' });
    const data = await response.json();
    if (response.ok && data.success) setAuditHistory(data.entries || []);
  };

  const recordAudit = async (action, entryId = '') => {
    try {
      const response = await apiFetch('/api/secrets-vault/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, entryId }) });
      const data = await response.json();
      if (response.ok && data.success) setAuditHistory((items) => [...items, data.entry].slice(-500));
    } catch { /* vault writes stay successful if audit storage is temporarily unavailable */ }
  };

  useEffect(() => {
    if (!canManage) { setLoading(false); return; }
    loadEnvelope().catch((err) => setError(err.message)).finally(() => setLoading(false));
    loadAudit().catch(() => {});
  }, []);

  useEffect(() => {
    if (!key) return undefined;
    const activity = () => { lastActivity.current = Date.now(); };
    const lock = () => {
      setKey(null); setSalt(null); setEntries([]); setVisible({}); setDraft(makeEntry()); setEditingId(''); setEditorOpen(false);
    };
    const events = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, activity, { passive: true }));
    const onVisibility = () => { if (document.hidden) lock(); };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => { if (Date.now() - lastActivity.current > 5 * 60 * 1000) lock(); }, 15000);
    return () => {
      events.forEach((event) => window.removeEventListener(event, activity));
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [key]);

  const unlock = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const opened = await decryptSecrets(envelope, password);
      setKey(opened.key); setSalt(opened.salt); setEntries(opened.entries); setVaultName(opened.vaultName); setNameDraft(opened.vaultName); setPassword(''); lastActivity.current = Date.now();
    } catch { setError('Could not unlock the vault. Check the passphrase and try again.'); }
    finally { setBusy(false); }
  };

  const setup = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (!nameDraft.trim()) throw new Error('Give your vault a name.');
      if (password.length < 14) throw new Error('Use a passphrase with at least 14 characters.');
      if (password !== confirmation) throw new Error('The passphrases do not match.');
      const created = await createSecretsVault([], password, nameDraft.trim());
      const response = await apiFetch('/api/secrets-vault', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision, envelope: created.envelope })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not create the vault');
      setEnvelope(created.envelope); setRevision(data.revision); setKey(created.key); setSalt(created.salt); setEntries([]); setVaultName(nameDraft.trim()); setNameDraft(nameDraft.trim()); setPassword(''); setConfirmation(''); lastActivity.current = Date.now();
      showToast('Encrypted secrets vault created', 'success');
    } catch (err) { setError(err.message || 'Could not create the vault'); }
    finally { setBusy(false); }
  };

  const closeEditor = () => { setDraft(makeEntry()); setEditingId(''); setEditorOpen(false); };
  const persistEnvelope = async (nextEnvelope) => {
    const response = await apiFetch('/api/secrets-vault', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision, envelope: nextEnvelope })
    });
    const data = await response.json();
    if (response.status === 409) throw new Error('Another admin changed the vault. Lock and unlock it to load the latest version, then try again.');
    if (!response.ok || !data.success) throw new Error(data.error || 'Could not save the encrypted vault');
    setEnvelope(nextEnvelope); setRevision(data.revision);
  };

  const saveEntry = async (event) => {
    event.preventDefault();
    if (!draft.title.trim() || !key || !salt) return;
    if (draft.url) {
      try { if (!['http:', 'https:'].includes(new URL(draft.url).protocol)) throw new Error(); }
      catch { setError('Enter a valid HTTP or HTTPS URL.'); return; }
    }
    const incompleteField = draft.fields.some((field) => Boolean(field.label.trim()) !== Boolean(field.value.trim()));
    const fields = draft.fields.map((field) => ({ label: field.label.trim(), value: field.value })).filter((field) => field.label && field.value.trim());
    if (incompleteField) { setError('Each credential field needs both a name and a value, or both left blank.'); return; }
    if (!fields.length) { setError('Add at least one named credential field.'); return; }
    setBusy(true); setError('');
    const now = new Date().toISOString();
    const cleanDraft = { ...draft, title: draft.title.trim(), fields };
    delete cleanDraft.username; delete cleanDraft.secret;
    const next = editingId
      ? entries.map((entry) => entry.id === editingId ? { ...cleanDraft, id: entry.id, createdAt: entry.createdAt, updatedAt: now } : entry)
      : [{ ...cleanDraft, id: crypto.randomUUID(), createdAt: now, updatedAt: now }, ...entries];
    try {
      await persistEnvelope(await encryptSecrets(next, key, salt, vaultName));
      setEntries(next); closeEditor();
      await recordAudit(editingId ? 'updated' : 'created', editingId || next[0].id);
      showToast(editingId ? 'Secret updated' : 'Secret saved', 'success');
    } catch (err) { setError(err.message || 'Could not save this secret'); }
    finally { setBusy(false); }
  };

  const deleteEntry = async (entry) => {
    if (!window.confirm(`Permanently delete “${entry.title}” from the secrets vault?`)) return;
    setBusy(true); setError('');
    const next = entries.filter((item) => item.id !== entry.id);
    try {
      await persistEnvelope(await encryptSecrets(next, key, salt, vaultName));
      setEntries(next); setVisible((items) => ({ ...items, [entry.id]: false }));
      await recordAudit('deleted', entry.id);
      showToast('Secret deleted', 'success');
    } catch (err) { setError(err.message || 'Could not delete this secret'); }
    finally { setBusy(false); }
  };

  const saveVaultName = async (event) => {
    event.preventDefault();
    const nextName = nameDraft.trim();
    if (!nextName || !key || !salt) { setError('Give your vault a name.'); return; }
    setBusy(true); setError('');
    try {
      await persistEnvelope(await encryptSecrets(entries, key, salt, nextName));
      setVaultName(nextName); setNameDraft(nextName); await recordAudit('vault_renamed'); showToast('Vault name updated', 'success');
    } catch (err) { setError(err.message || 'Could not rename the vault'); }
    finally { setBusy(false); }
  };

  const editEntry = (entry) => {
    setEditingId(entry.id);
    setDraft({ ...makeEntry(), ...entry, fields: entryFields(entry).map((field) => ({ ...field })) });
    setEditorOpen(true);
  };
  const copyValue = async (value) => {
    try { await navigator.clipboard.writeText(value); showToast('Credential copied to clipboard', 'success'); }
    catch { showToast('Clipboard access is unavailable in this browser', 'error'); }
  };
  const lock = () => {
    setKey(null); setSalt(null); setEntries([]); setVisible({}); setDraft(makeEntry()); setEditingId(''); setEditorOpen(false); setPassword(''); setConfirmation(''); setNameDraft(vaultName);
  };
  const addField = () => setDraft((current) => ({ ...current, fields: [...current.fields, { label: '', value: '' }] }));

  if (!canManage) return <div className="mx-auto max-w-3xl p-6 text-sm text-bhodix-textMuted">Only workspace owners and admins can access the Secrets Vault.</div>;
  if (loading) return <div className="p-8 text-sm text-bhodix-textMuted">Loading encrypted vault…</div>;

  return (
    <div className="mx-auto h-full max-w-[1600px] w-full space-y-5 overflow-y-auto p-4 pb-24 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-bhodix-border pb-5">
        <div><div className="flex items-center gap-2 text-indigo-400"><KeyRound className="h-5 w-5" /><span className="text-[10px] font-mono uppercase tracking-widest">Private storage</span></div><h1 className="mt-2 text-2xl font-bold text-bhodix-text tracking-tight">{key ? vaultName : 'Secrets Vault'}</h1><p className="mt-1 max-w-2xl text-xs text-bhodix-textMuted">Keep credentials organized by project, category, environment, audience, and expiration. Values are encrypted in this browser before they are saved.</p></div>
        {key && <button onClick={lock} className="inline-flex items-center gap-2 rounded-xl border border-bhodix-border px-3 py-2 text-xs font-medium text-bhodix-textMuted hover:bg-bhodix-hover transition-colors shadow-sm"><LockKeyhole className="h-4 w-4" />Lock vault</button>}
      </header>

      {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">{error}</div>}

      {!key && !envelope && (
        <form onSubmit={setup} className="mx-auto max-w-xl space-y-4 rounded-2xl border border-bhodix-border bg-bhodix-card p-5 md:p-7">
          <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200"><ShieldCheck className="h-4 w-4 shrink-0" /><span>Choose a strong passphrase and share it only with trusted workspace admins. If it is lost, these secrets cannot be recovered.</span></div>
          <label className="block text-xs text-bhodix-textMuted">Vault name *<input required maxLength={80} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Acme production credentials" className={`${INPUT} mt-1`} /></label>
          <label className="block text-xs text-bhodix-textMuted">Vault passphrase<input autoComplete="new-password" required minLength={14} maxLength={256} type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${INPUT} mt-1`} /></label>
          <label className="block text-xs text-bhodix-textMuted">Confirm passphrase<input autoComplete="new-password" required minLength={14} maxLength={256} type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className={`${INPUT} mt-1`} /></label>
          <button disabled={busy} className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">{busy ? 'Creating encrypted vault…' : 'Create encrypted vault'}</button>
        </form>
      )}

      {!key && envelope && (
        <form onSubmit={unlock} className="mx-auto max-w-md space-y-4 rounded-2xl border border-bhodix-border bg-bhodix-card p-5 md:p-7">
          <div className="text-center"><LockKeyhole className="mx-auto h-8 w-8 text-indigo-400" /><h2 className="mt-3 text-base font-semibold text-bhodix-text">Vault locked</h2><p className="mt-1 text-xs text-bhodix-textSubtle">Enter the vault passphrase to decrypt its name and credentials on this device.</p></div>
          <input autoFocus autoComplete="current-password" aria-label="Vault passphrase" required type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />
          <button disabled={busy} className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">{busy ? 'Unlocking…' : 'Unlock vault'}</button>
        </form>
      )}

      {key && <>
        <div className="grid gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 md:grid-cols-[1fr_auto] md:items-end">
          <form onSubmit={saveVaultName} className="flex flex-wrap items-end gap-2">
            <label className="min-w-[220px] flex-1 text-[11px] text-bhodix-textSubtle">Vault name<input required maxLength={80} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} className={`${INPUT} mt-1`} /></label>
            <button disabled={busy || nameDraft.trim() === vaultName} className="rounded-lg border border-bhodix-border px-3 py-2 text-xs font-medium text-bhodix-textMuted hover:bg-bhodix-hover disabled:opacity-40">Save name</button>
          </form>
          <div className="flex flex-wrap items-center justify-between gap-3 md:justify-end"><p className="text-[11px] text-emerald-300">Encrypted in this browser · auto-locks after 5 minutes idle or when this tab is hidden</p><button onClick={() => { setEditingId(''); setDraft({ ...makeEntry(), project: projectList[0]?.id || '' }); setEditorOpen(true); }} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500"><Plus className="h-4 w-4" />Add credential</button></div>
        </div>

        {editorOpen && <form onSubmit={saveEntry} className="space-y-5 rounded-2xl border border-bhodix-border bg-bhodix-card p-5 md:p-6">
          <div className="flex items-center justify-between"><div><h2 className="text-base font-semibold text-bhodix-text">{editingId ? 'Edit credential' : 'New credential'}</h2><p className="mt-1 text-xs text-bhodix-textSubtle">Describe what it is for, where it belongs, and add one or more named values.</p></div><button type="button" aria-label="Close editor" onClick={closeEditor} className="rounded p-1 text-bhodix-textSubtle hover:bg-bhodix-hover"><X className="h-4 w-4" /></button></div>

          <section className="grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] text-bhodix-textSubtle sm:col-span-2">Credential name *<input required maxLength={120} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Payments API production credentials" className={`${INPUT} mt-1`} /></label>
            <label className="text-[11px] text-bhodix-textSubtle">Project<select value={draft.project} onChange={(e) => setDraft({ ...draft, project: e.target.value })} className={`${INPUT} mt-1`}><option value="">Workspace-wide</option>{projectList.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
            <label className="text-[11px] text-bhodix-textSubtle">Category<select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className={`${INPUT} mt-1`}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label className="text-[11px] text-bhodix-textSubtle">Environment / segment<input list="secret-segments" maxLength={80} value={draft.segment} onChange={(e) => setDraft({ ...draft, segment: e.target.value })} placeholder="Production, staging, QA…" className={`${INPUT} mt-1`} /><datalist id="secret-segments"><option value="Production" /><option value="Staging" /><option value="Development" /><option value="QA" /><option value="Customer-specific" /></datalist></label>
            <label className="text-[11px] text-bhodix-textSubtle">Expiration date<input type="date" value={draft.expiresAt} onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })} className={`${INPUT} mt-1`} /></label>
            <label className="text-[11px] text-bhodix-textSubtle sm:col-span-2">Login, documentation, or webhook URL<input type="url" maxLength={2000} value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://…" className={`${INPUT} mt-1`} /></label>
          </section>

          <section className="space-y-3 rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface/50 p-4">
            <div><h3 className="text-xs font-semibold text-bhodix-text">Named credential values *</h3><p className="mt-1 text-[11px] text-bhodix-textSubtle">For example, add separate fields for Client ID, Client secret, webhook signing key, and callback token.</p></div>
            <div className="space-y-3">{draft.fields.map((field, index) => <div key={index} className="grid gap-2 sm:grid-cols-[minmax(140px,0.7fr)_minmax(220px,1.3fr)_auto] sm:items-start">
              <label className="text-[10px] text-bhodix-textSubtle">Field name *<input required={index === 0} maxLength={80} value={field.label} onChange={(e) => setDraft((current) => ({ ...current, fields: current.fields.map((item, itemIndex) => itemIndex === index ? { ...item, label: e.target.value } : item) }))} placeholder="Client ID" className={`${INPUT} mt-1`} /></label>
              <label className="text-[10px] text-bhodix-textSubtle">Value *<textarea required={index === 0} rows={2} maxLength={12000} value={field.value} onChange={(e) => setDraft((current) => ({ ...current, fields: current.fields.map((item, itemIndex) => itemIndex === index ? { ...item, value: e.target.value } : item) }))} placeholder="Paste the credential value" className={`${INPUT} mt-1 font-mono`} /></label>
              <button type="button" disabled={draft.fields.length === 1} onClick={() => setDraft((current) => ({ ...current, fields: current.fields.filter((_, itemIndex) => itemIndex !== index) }))} aria-label={`Remove ${field.label || 'credential'} field`} className="mt-5 rounded-lg p-2 text-bhodix-textSubtle hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
            </div>)}</div>
            <button type="button" onClick={addField} className="inline-flex items-center gap-1.5 rounded-lg border border-bhodix-border px-3 py-2 text-xs text-bhodix-textMuted hover:bg-bhodix-hover"><Plus className="h-3.5 w-3.5" />Add named field</button>
          </section>

          <fieldset className="space-y-2"><legend className="text-[11px] font-medium text-bhodix-textMuted">Where is this credential used?</legend><div className="flex flex-wrap gap-2">{EXPOSURE.map(([keyName, label]) => <label key={keyName} className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-bhodix-border px-3 py-2 text-xs text-bhodix-textMuted"><input type="checkbox" checked={!!draft[keyName]} onChange={(e) => setDraft({ ...draft, [keyName]: e.target.checked })} className="accent-indigo-500" />{label}</label>)}</div></fieldset>
          <label className="block text-[11px] text-bhodix-textSubtle">Notes / purpose<textarea rows={3} maxLength={4000} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="What service uses this, who owns it, or when should it be rotated?" className={`${INPUT} mt-1`} /></label>
          <div className="flex justify-end gap-2"><button type="button" onClick={closeEditor} className="rounded-lg px-3 py-2 text-xs text-bhodix-textMuted">Cancel</button><button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" />{busy ? 'Encrypting…' : 'Encrypt & save credential'}</button></div>
        </form>}

        <section className="space-y-3">
          {!entries.length ? <div className="rounded-2xl border border-dashed border-bhodix-border p-10 text-center"><KeyRound className="mx-auto h-7 w-7 text-bhodix-textSubtle" /><p className="mt-3 text-sm font-medium text-bhodix-text">No credentials saved yet</p><p className="mt-1 text-xs text-bhodix-textSubtle">Add a credential, connect it to a project, and label every value so it is clear what each one unlocks.</p></div> : entries.map((entry) => {
            const fields = entryFields(entry);
            const projectName = projectList.find((project) => project.id === entry.project)?.name || (entry.project || 'Workspace-wide');
            const expired = entry.expiresAt && new Date(`${entry.expiresAt}T23:59:59`).getTime() < Date.now();
            const exposure = EXPOSURE.filter(([keyName]) => entry[keyName]).map(([, label]) => label);
            return <article key={entry.id} className="rounded-2xl border border-bhodix-border bg-bhodix-card p-4 md:p-5">
              <div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-semibold text-bhodix-text">{entry.title}</h2><span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] text-indigo-300">{entry.category}</span>{entry.expiresAt && <span className={`rounded-full px-2 py-0.5 text-[10px] ${expired ? 'bg-rose-500/10 text-rose-300' : 'bg-amber-500/10 text-amber-200'}`}>{expired ? 'Expired' : 'Expires'} {entry.expiresAt}</span>}</div>
                <p className="mt-1 text-[11px] text-bhodix-textSubtle">{projectName}{entry.segment ? ` · ${entry.segment}` : ''}</p>
                {!!exposure.length && <div className="mt-2 flex flex-wrap gap-1.5">{exposure.map((label) => <span key={label} className="rounded-md border border-bhodix-border px-2 py-0.5 text-[10px] text-bhodix-textMuted">{label}</span>)}</div>}
              </div><div className="flex items-center gap-1"><button title="Edit credential" onClick={() => editEntry(entry)} className="rounded-lg px-2 py-1 text-[11px] text-indigo-400 hover:bg-indigo-500/10">Edit</button><button title="Delete credential" onClick={() => deleteEntry(entry)} disabled={busy} className="rounded-lg p-2 text-rose-400 hover:bg-rose-500/10 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button></div></div>
              <div className="mt-4 space-y-2">{fields.map((field, index) => {
                const keyId = `${entry.id}:${index}`;
                return <div key={`${field.label}-${index}`} className="rounded-lg border border-bhodix-borderSubtle bg-bhodix-surface p-3"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-bhodix-textSubtle">{field.label || 'Credential value'}</p><div className="flex items-center gap-1"><button title={visible[keyId] ? 'Hide value' : 'Reveal value'} onClick={() => setVisible((current) => ({ ...current, [keyId]: !current[keyId] }))} className="rounded p-1.5 text-bhodix-textMuted hover:bg-bhodix-hover">{visible[keyId] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button><button title="Copy value" onClick={() => copyValue(field.value)} className="rounded p-1.5 text-bhodix-textMuted hover:bg-bhodix-hover"><Copy className="h-3.5 w-3.5" /></button></div></div><div className="mt-1 break-all font-mono text-xs text-bhodix-text">{visible[keyId] ? field.value : '••••••••••••••••'}</div></div>;
              })}</div>
              {entry.url && <a href={entry.url} target="_blank" rel="noreferrer" className="mt-3 block truncate text-xs text-indigo-400 underline">{entry.url}</a>}
              {entry.notes && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-bhodix-textMuted">{entry.notes}</p>}
            </article>;
          })}
        </section>

        <section className="rounded-2xl border border-bhodix-border bg-bhodix-card p-4 md:p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-bhodix-text">Vault activity</h2><p className="mt-1 text-[11px] text-bhodix-textSubtle">Who changed a credential and when. Secret values and credential names are never written to this log.</p></div><button onClick={() => loadAudit().catch(() => {})} className="rounded-lg border border-bhodix-border px-3 py-1.5 text-[10px] text-bhodix-textMuted hover:bg-bhodix-hover">Refresh</button></div><div className="mt-3 max-h-56 divide-y divide-bhodix-borderSubtle overflow-y-auto">{[...auditHistory].reverse().slice(0, 30).map((item) => <div key={item.id} className="flex flex-wrap items-center gap-2 py-2 text-[10px]"><span className="min-w-0 flex-1 truncate text-bhodix-text">{item.actor} · {item.action.replace('_', ' ')}</span>{item.entryId && <code className="text-bhodix-textSubtle">{item.entryId.slice(0, 8)}</code>}<time className="text-bhodix-textSubtle">{new Date(item.time).toLocaleString()}</time></div>)}{!auditHistory.length && <p className="py-4 text-center text-xs text-bhodix-textSubtle">No vault changes recorded yet.</p>}</div></section>
      </>}
    </div>
  );
}
