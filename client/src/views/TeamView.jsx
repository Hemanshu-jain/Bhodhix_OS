import React, { useEffect, useState } from 'react';
import { Copy, Download, UserPlus, Users, Upload, X } from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { useToast } from '../components/ToastProvider';
import FieldWorkPanel from './FieldWorkPanel';

export default function TeamView() {
  const { user, teamMembers, teamRequest, apiFetch, projectList } = useVault();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [invites, setInvites] = useState([]);
  const [inviteCode, setInviteCode] = useState('');
  const [message, setMessage] = useState('');
  const [updates, setUpdates] = useState({ announcements: [], availability: [] });
  const [announcementDraft, setAnnouncementDraft] = useState('');
  const [availabilityDraft, setAvailabilityDraft] = useState({ status: 'available', note: '', until: '' });
  const [backupBusy, setBackupBusy] = useState(false);
  const [onboarding, setOnboarding] = useState(() => { try { return JSON.parse(localStorage.getItem(`bhodhix_onboarding_${user?.organization?.slug || 'local'}_${user?.id || 'guest'}`) || '{}'); } catch { return {}; } });
  const manager = ['owner', 'admin'].includes(user?.role);
  const onboardingItems = ['Invite your team', 'Create your first project', 'Save a reusable task template', 'Connect an AI assistant', 'Set notification quiet hours', 'Connect a Slack channel', 'Install Bhodhix on your phone'];

  const downloadBackup = async () => {
    setBackupBusy(true);
    try {
      const response = await apiFetch('/api/workspace/backup');
      const data = await response.json();
      if (!response.ok || !data.files) throw new Error(data.error || 'Could not create a backup');
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `bhodhix-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href);
      showToast('Workspace backup downloaded', 'success');
    } catch (error) { showToast(error.message || 'Could not create a backup', 'error'); }
    finally { setBackupBusy(false); }
  };
  const importBackup = async (event) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) return showToast('Backup must be under 30 MB', 'error');
    if (!window.confirm('Import this backup? Matching files will be replaced; files created after the backup will stay. Download a fresh backup first if you need a rollback.')) return;
    setBackupBusy(true);
    try {
      const backup = JSON.parse(await file.text());
      const response = await apiFetch('/api/workspace/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backup }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not import this backup');
      showToast(`Imported ${data.restoredFiles} workspace files`, 'success');
    } catch (error) { showToast(error.message || 'Could not import this backup', 'error'); }
    finally { setBackupBusy(false); }
  };

  const loadInvites = async () => {
    if (!manager) return;
    const data = await teamRequest('/api/team/invites');
    if (data.success) setInvites(data.invites);
  };
  const loadUpdates = async () => {
    const data = await teamRequest('/api/team/updates');
    if (data.success) setUpdates(data);
  };
  useEffect(() => { loadInvites(); loadUpdates(); }, [user?.role]);

  const invite = async (e) => {
    e.preventDefault();
    const data = await teamRequest('/api/team/invites', 'POST', { email, role });
    if (!data.success) return setMessage(data.error || 'Could not create invite');
    setInviteCode(data.code);
    setMessage(data.emailSent ? `Invite email sent to ${data.email}. You can also copy the link.` : 'Invite created. Copy the link and send it to the teammate.');
    setEmail('');
    await loadInvites();
  };

  const changeRole = async (member, nextRole) => {
    const data = await teamRequest(`/api/team/members/${member.id}`, 'PATCH', { role: nextRole });
    if (!data.success) setMessage(data.error || 'Could not update role');
  };
  const changeWorkMode = async (member, workMode) => {
    const data = await teamRequest(`/api/team/members/${member.id}/work-mode`, 'PATCH', { workMode });
    if (!data.success) setMessage(data.error || 'Could not update work type');
  };
  const saveProjectAccess = async (member, event) => {
    const projectIds = Array.from(event.target.selectedOptions, (option) => option.value);
    const data = await teamRequest(`/api/team/members/${member.id}/projects`, 'PATCH', { projectIds });
    if (!data.success) setMessage(data.error || 'Could not update project access');
    else setMessage(`Project access updated for ${member.name}`);
  };
  const remove = async (member) => {
    if (!window.confirm(`Remove ${member.name} from this workspace?`)) return;
    const data = await teamRequest(`/api/team/members/${member.id}`, 'DELETE');
    if (!data.success) setMessage(data.error || 'Could not remove member');
  };
  const revoke = async (id) => {
    const data = await teamRequest(`/api/team/invites/${id}`, 'DELETE');
    if (data.success) await loadInvites(); else setMessage(data.error || 'Could not revoke invite');
  };
  const copyInvite = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      const inviteLink = new URL('/', window.location.origin);
      inviteLink.searchParams.set('invite', inviteCode);
      await navigator.clipboard.writeText(inviteLink.href);
      showToast('Invite link copied', 'success');
    } catch {
      setMessage('Clipboard unavailable. Select and copy the invite code.');
    }
  };
  const postAnnouncement = async (e) => {
    e.preventDefault();
    const data = await teamRequest('/api/team/announcements', 'POST', { message: announcementDraft });
    if (!data.success) return setMessage(data.error || 'Could not post announcement');
    setAnnouncementDraft('');
    await loadUpdates();
  };
  const saveAvailability = async (e) => {
    e.preventDefault();
    const data = await teamRequest('/api/team/availability', 'PUT', availabilityDraft);
    if (!data.success) return setMessage(data.error || 'Could not update availability');
    await loadUpdates();
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 space-y-6 max-w-[1600px] w-full mx-auto">
      {/* Expansive Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-bhodix-border pb-5">
        <div>
          <div className="flex items-center gap-2 text-indigo-500">
            <Users className="w-5 h-5" />
            <span className="text-[10px] font-mono uppercase tracking-widest">Workspace Administration</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-bhodix-text tracking-tight">Team & Access</h1>
          <p className="mt-1 text-xs text-bhodix-textMuted">
            {user?.organization?.name} · sign-in key <code className="text-indigo-400 font-mono font-medium">{user?.organization?.slug}</code> · Manage team members, permissions, and workspace data.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-bhodix-border bg-bhodix-card text-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-bhodix-text font-medium">{teamMembers.length} Active Member{teamMembers.length === 1 ? '' : 's'}</span>
          </div>
          {manager && (
            <button
              disabled={backupBusy}
              onClick={downloadBackup}
              className="inline-flex items-center gap-1.5 rounded-xl border border-bhodix-border bg-bhodix-card px-3 py-1.5 text-xs font-medium text-bhodix-text hover:bg-bhodix-hover transition-colors shadow-sm disabled:opacity-50"
              title="Download workspace backup"
            >
              <Download className="h-3.5 w-3.5 text-indigo-400" />
              <span>Backup</span>
            </button>
          )}
        </div>
      </header>

      {/* Top 2-Column Row: Invites & Workspace Management */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Invite Teammates */}
        {manager && (
          <section className="lg:col-span-6 rounded-2xl border border-bhodix-border bg-bhodix-card p-5 space-y-4 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-bhodix-text flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-indigo-500" />
                    Invite Teammates
                  </h2>
                  <p className="mt-1 text-xs text-bhodix-textSubtle">
                    Generate an invite link to grant access with preset role permissions.
                  </p>
                </div>
                {invites.length > 0 && (
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    {invites.length} pending
                  </span>
                )}
              </div>

              <form onSubmit={invite} className="mt-4 flex flex-col sm:flex-row gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Teammate's email (optional)"
                  className="min-w-0 flex-1 rounded-xl border border-bhodix-border bg-bhodix-surface px-3 py-2 text-xs text-bhodix-text focus:outline-none focus:border-indigo-500 transition-colors"
                />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="rounded-xl border border-bhodix-border bg-bhodix-surface px-3 py-2 text-xs text-bhodix-text focus:outline-none focus:border-indigo-500 transition-colors"
                >
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 shadow-sm transition-all shrink-0"
                >
                  <UserPlus className="w-4 h-4" />
                  Create Invite
                </button>
              </form>

              {inviteCode && (
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <code className="min-w-0 flex-1 break-all text-xs text-emerald-500 font-mono">{inviteCode}</code>
                  <button
                    onClick={copyInvite}
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy Link
                  </button>
                </div>
              )}
              {message && <p role="status" className="mt-2 text-xs text-bhodix-textMuted">{message}</p>}
            </div>

            {/* Pending Invites List */}
            {invites.length > 0 && (
              <div className="border-t border-bhodix-borderSubtle pt-3 mt-2">
                <span className="text-[11px] font-medium text-bhodix-textMuted block mb-2">Pending Invitations</span>
                <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                  {invites.map((inviteItem) => (
                    <div key={inviteItem.id} className="flex items-center justify-between text-xs bg-bhodix-surface/60 px-2.5 py-1.5 rounded-lg border border-bhodix-borderSubtle">
                      <span className="truncate text-bhodix-textMuted font-mono text-[11px]">
                        {inviteItem.email || 'Any email'} · <span className="capitalize">{inviteItem.role}</span>
                      </span>
                      <button onClick={() => revoke(inviteItem.id)} className="text-rose-400 hover:text-rose-300 text-[11px] font-medium">
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Right Column: Workspace Setup & Backup/Restore */}
        <section className={`${manager ? 'lg:col-span-6' : 'lg:col-span-12'} rounded-2xl border border-bhodix-border bg-bhodix-card p-5 space-y-4 shadow-sm flex flex-col justify-between`}>
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-bhodix-text">Workspace Checklist</h2>
                <p className="mt-1 text-xs text-bhodix-textSubtle">Essential steps for getting your workspace configured.</p>
              </div>
              <span className="text-[11px] font-mono text-indigo-400">
                {Object.values(onboarding).filter(Boolean).length}/{onboardingItems.length} Done
              </span>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {onboardingItems.map((item) => (
                <label key={item} className="flex items-center gap-2.5 rounded-xl bg-bhodix-surface px-3 py-2 text-xs text-bhodix-text hover:bg-bhodix-hover transition-colors cursor-pointer border border-bhodix-borderSubtle">
                  <input
                    type="checkbox"
                    checked={Boolean(onboarding[item])}
                    onChange={(event) => setOnboarding((previous) => {
                      const next = { ...previous, [item]: event.target.checked };
                      try { localStorage.setItem(`bhodhix_onboarding_${user?.organization?.slug || 'local'}_${user?.id || 'guest'}`, JSON.stringify(next)); } catch { /* unavailable */ }
                      return next;
                    })}
                    className="accent-indigo-500 rounded"
                  />
                  <span className={onboarding[item] ? 'line-through text-bhodix-textSubtle' : ''}>{item}</span>
                </label>
              ))}
            </div>
          </div>

          {manager && (
            <div className="border-t border-bhodix-borderSubtle pt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-bhodix-textSubtle">Data snapshots & migrations</span>
              <div className="flex items-center gap-2">
                <button
                  disabled={backupBusy}
                  onClick={downloadBackup}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-400 disabled:opacity-50 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export JSON
                </button>
                <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-bhodix-border bg-bhodix-surface px-3 py-1.5 text-xs font-medium text-bhodix-text hover:bg-bhodix-hover transition-colors ${backupBusy ? 'pointer-events-none opacity-50' : ''}`}>
                  <Upload className="h-3.5 w-3.5 text-bhodix-textMuted" />
                  Import Backup
                  <input type="file" accept="application/json,.json" onChange={importBackup} className="sr-only" />
                </label>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Main Section: Team Members Directory (Full Width) */}
      <section className="rounded-2xl border border-bhodix-border bg-bhodix-card shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-bhodix-border px-6 py-4 bg-bhodix-surface/30">
          <div>
            <h2 className="text-sm font-semibold text-bhodix-text">Team Directory</h2>
            <p className="mt-0.5 text-xs text-bhodix-textSubtle">Active workspace accounts and their respective access rights.</p>
          </div>
          <span className="text-xs font-mono text-bhodix-textMuted mt-1 sm:mt-0">
            {teamMembers.length} active account{teamMembers.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="divide-y divide-bhodix-borderSubtle">
          {teamMembers.map((member) => (
            <div key={member.id} className="flex flex-wrap items-center gap-4 px-6 py-4 hover:bg-bhodix-surface/30 transition-colors">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-sm font-bold text-indigo-400 border border-indigo-500/20">
                {member.name?.slice(0, 1)?.toUpperCase() || 'U'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-bhodix-text">{member.name}</span>
                  {member.userId === user?.id && (
                    <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-400 border border-indigo-500/20">
                      You
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-bhodix-textSubtle font-mono">{member.email}</div>
              </div>

              {manager && member.role !== 'owner' && member.userId !== user?.id ? (
                  <div className="flex flex-wrap items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-mono uppercase text-bhodix-textSubtle">Work type</span>
                    <select aria-label={`Work type for ${member.name}`} value={member.workMode || 'office'} onChange={(event) => changeWorkMode(member, event.target.value)} className="rounded-xl border border-bhodix-border bg-bhodix-surface px-3 py-1.5 text-xs text-bhodix-text focus:outline-none focus:border-indigo-500">
                      <option value="field">On-ground</option><option value="office">Office</option><option value="hybrid">Hybrid</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-mono uppercase text-bhodix-textSubtle">Role</span>
                    <select
                      aria-label={`Role for ${member.name}`}
                      value={member.role}
                      onChange={(e) => changeRole(member, e.target.value)}
                      className="rounded-xl border border-bhodix-border bg-bhodix-surface px-3 py-1.5 text-xs capitalize text-bhodix-text focus:outline-none focus:border-indigo-500"
                    >
                      <option value="admin" disabled={user.role !== 'owner'}>Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-mono uppercase text-bhodix-textSubtle">Project Access</span>
                    <select
                      aria-label={`Project access for ${member.name}`}
                      multiple
                      size={Math.min(Math.max(projectList.length, 2), 4)}
                      value={member.projectIds === null ? projectList.map((project) => project.id) : member.projectIds || projectList.map((project) => project.id)}
                      onChange={(event) => saveProjectAccess(member, event)}
                      title="Ctrl-click to select multiple projects"
                      className="min-w-36 rounded-xl border border-bhodix-border bg-bhodix-surface px-2.5 py-1 text-[11px] text-bhodix-text focus:outline-none focus:border-indigo-500"
                    >
                      <option disabled value="">Project access</option>
                      {projectList.map((project) => (
                        <option key={project.id} value={project.id}>{project.name || project.id}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    title={`Remove ${member.name}`}
                    onClick={() => remove(member)}
                    className="self-center p-2 rounded-xl text-bhodix-textSubtle hover:bg-rose-500/10 hover:text-rose-400 transition-colors ml-2"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="rounded-xl border border-bhodix-border bg-bhodix-surface px-3 py-1.5 text-xs capitalize text-bhodix-text font-medium">
                    {member.role}
                  </span>
                  {member.userId === user?.id && user?.role !== 'viewer' ? <select aria-label="Your work type" value={member.workMode || 'office'} onChange={(event) => changeWorkMode(member, event.target.value)} className="rounded-xl border border-bhodix-border bg-bhodix-surface px-3 py-1.5 text-xs text-bhodix-text"><option value="field">On-ground</option><option value="office">Office</option><option value="hybrid">Hybrid</option></select> : <span className="text-xs capitalize text-bhodix-textMuted">{member.workMode === 'field' ? 'On-ground' : member.workMode || 'Office'}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Bottom 2-Column Row: Announcements & Availability */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Team Announcements */}
        <div className="rounded-2xl border border-bhodix-border bg-bhodix-card p-5 space-y-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-bhodix-text">Team Announcements</h2>
              <span className="text-[11px] text-bhodix-textSubtle">{updates.announcements.length} posted</span>
            </div>
            <p className="mt-0.5 text-xs text-bhodix-textSubtle">Broadcasts and updates for all workspace members.</p>

            <div className="mt-3 max-h-56 space-y-2.5 overflow-y-auto pr-1">
              {[...updates.announcements].reverse().map((item) => (
                <article key={item.id} className="rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-3.5">
                  <p className="text-xs text-bhodix-text leading-relaxed">{item.message}</p>
                  <p className="mt-2 text-[10px] text-bhodix-textSubtle font-mono">
                    {item.author} · {new Date(item.createdAt).toLocaleString()}
                  </p>
                </article>
              ))}
              {!updates.announcements.length && (
                <p className="text-xs text-bhodix-textSubtle py-6 text-center">No announcements yet.</p>
              )}
            </div>
          </div>

          {manager && (
            <form onSubmit={postAnnouncement} className="space-y-2 border-t border-bhodix-borderSubtle pt-3">
              <textarea
                required
                maxLength={500}
                value={announcementDraft}
                onChange={(e) => setAnnouncementDraft(e.target.value)}
                aria-label="Announcement message"
                placeholder="Share a team update…"
                className="w-full rounded-xl border border-bhodix-border bg-bhodix-surface p-3 text-xs text-bhodix-text focus:outline-none focus:border-indigo-500 transition-colors"
                rows={2}
              />
              <button className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition-all shadow-sm">
                Post announcement
              </button>
            </form>
          )}
        </div>

        {/* Live Availability */}
        <div className="rounded-2xl border border-bhodix-border bg-bhodix-card p-5 space-y-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-bhodix-text">Team Availability</h2>
              <span className="text-[11px] text-bhodix-textSubtle">Real-time status</span>
            </div>
            <p className="mt-0.5 text-xs text-bhodix-textSubtle">Let your colleagues know when you are active or focused.</p>

            <div className="mt-3 space-y-2 max-h-56 overflow-y-auto pr-1">
              {teamMembers.map((member) => {
                const presence = updates.availability.find((item) => item.userId === member.userId);
                return (
                  <div key={member.id} className="flex items-center gap-3 rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-2.5 text-xs">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        presence?.status === 'available'
                          ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                          : presence?.status === 'focus'
                          ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]'
                          : 'bg-slate-400'
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-bhodix-text">
                      {member.name}{member.userId === user?.id ? ' (you)' : ''}
                    </span>
                    <span className="text-[10px] capitalize text-bhodix-textSubtle font-mono">
                      {presence?.status?.replace('_', ' ') || 'No status'}
                    </span>
                    {presence?.until && (
                      <time className="text-[10px] text-bhodix-textSubtle font-mono">until {presence.until}</time>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {user?.role !== 'viewer' && (
            <form onSubmit={saveAvailability} className="grid grid-cols-2 gap-2 border-t border-bhodix-borderSubtle pt-3">
              <select
                aria-label="Your availability"
                value={availabilityDraft.status}
                onChange={(e) => setAvailabilityDraft((draft) => ({ ...draft, status: e.target.value }))}
                className="rounded-xl border border-bhodix-border bg-bhodix-surface px-3 py-2 text-xs text-bhodix-text focus:outline-none focus:border-indigo-500"
              >
                <option value="available">Available</option>
                <option value="focus">Focus time</option>
                <option value="away">Away</option>
              </select>
              <input
                type="date"
                aria-label="Availability until"
                value={availabilityDraft.until}
                onChange={(e) => setAvailabilityDraft((draft) => ({ ...draft, until: e.target.value }))}
                className="rounded-xl border border-bhodix-border bg-bhodix-surface px-3 py-2 text-xs text-bhodix-text focus:outline-none focus:border-indigo-500"
              />
              <input
                aria-label="Availability note"
                maxLength={120}
                value={availabilityDraft.note}
                onChange={(e) => setAvailabilityDraft((draft) => ({ ...draft, note: e.target.value }))}
                placeholder="Optional status note"
                className="col-span-2 rounded-xl border border-bhodix-border bg-bhodix-surface px-3 py-2 text-xs text-bhodix-text focus:outline-none focus:border-indigo-500"
              />
              <button className="col-span-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition-all shadow-sm">
                Update status
              </button>
            </form>
          )}
        </div>
      </section>

      <FieldWorkPanel />

      {!manager && (
        <p className="text-xs text-bhodix-textSubtle text-center">
          Workspace member view. Only administrators can invite teammates or modify project permissions.
        </p>
      )}
    </div>
  );
}
