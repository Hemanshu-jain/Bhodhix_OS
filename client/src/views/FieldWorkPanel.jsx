import React, { useEffect, useMemo, useState } from 'react';
import { Camera, CheckCircle2, ClipboardList, MapPin, Route, X } from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { useToast } from '../components/ToastProvider';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const emptyData = { retentionDays: 90, routes: [], shifts: [], trips: [], claims: [], photos: [] };

async function photoData(file) {
  if (!file) return '';
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file');
  const source = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale); canvas.height = Math.round(source.height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
  if (!blob || blob.size > 1_000_000) throw new Error('Photo is too large after compression. Choose a smaller image.');
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read photo')); reader.readAsDataURL(blob); });
}

export default function FieldWorkPanel() {
  const { user, teamMembers, projectList, apiFetch } = useVault();
  const { showToast } = useToast();
  const manager = ['owner', 'admin'].includes(user?.role);
  const [data, setData] = useState(emptyData);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shiftPhoto, setShiftPhoto] = useState('');
  const [startPhoto, setStartPhoto] = useState('');
  const [returnPhoto, setReturnPhoto] = useState('');
  const [routeDraft, setRouteDraft] = useState({ date: today(), userId: '', projectId: '', title: '', plannedKm: '', stops: '' });
  const [tripDraft, setTripDraft] = useState({});
  const [claimDraft, setClaimDraft] = useState({ routeId: '', category: 'fuel', amount: '', note: '' });
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoLoading, setPhotoLoading] = useState('');
  const shift = data.shifts.find((item) => item.userId === user?.id && item.date === today());
  const ownRoutes = data.routes.filter((item) => item.userId === user?.id).sort((a, b) => a.date.localeCompare(b.date));
  const membersById = useMemo(() => new Map(teamMembers.map((item) => [item.userId, item.name])), [teamMembers]);

  const load = async () => {
    const response = await apiFetch('/api/team/field-work'); const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Could not load field-work records');
    setData(result.data);
  };
  useEffect(() => {
    load().catch((err) => setError(err.message));
    const refresh = setInterval(() => load().catch(() => {}), 30_000);
    return () => clearInterval(refresh);
  }, []);

  const send = async (url, method, payload) => {
    setBusy(true); setError('');
    try {
      const response = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Could not save field-work update');
      await load(); window.dispatchEvent(new Event('bhodhix:field-shift-updated')); return result;
    } catch (err) { setError(err.message); showToast(err.message, 'error'); return null; }
    finally { setBusy(false); }
  };
  const setPhoto = async (event, setter) => {
    try { setter(await photoData(event.target.files?.[0])); }
    catch (err) { setter(''); setError(err.message); showToast(err.message, 'error'); }
    event.target.value = '';
  };
  const openPhoto = async (id) => {
    setPhotoLoading(id);
    try { const response = await apiFetch(`/api/team/field-work/photos/${encodeURIComponent(id)}`); if (!response.ok) throw new Error('Photo is no longer available'); const blob = await response.blob(); setPhotoPreview(URL.createObjectURL(blob)); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setPhotoLoading(''); }
  };
  const submitRoute = async (event) => {
    event.preventDefault(); const result = await send('/api/team/field-work/routes', 'POST', routeDraft);
    if (result) setRouteDraft((draft) => ({ ...draft, title: '', plannedKm: '', stops: '' }));
  };
  const submitShift = async (action) => {
    if (!shiftPhoto) return showToast('Take or select a check-in photo first', 'error');
    const result = await send('/api/team/field-work/shifts', 'POST', { action, photoData: shiftPhoto });
    if (result) setShiftPhoto('');
  };
  const startTrip = async (route) => {
    const draft = tripDraft[route.id] || {};
    if (!startPhoto) return showToast('Take an odometer photo before starting the route', 'error');
    const result = await send('/api/team/field-work/trips', 'POST', { routeId: route.id, odometer: draft.startOdometer, photoData: startPhoto });
    if (result) { setStartPhoto(''); setTripDraft((state) => ({ ...state, [route.id]: { ...draft, startOdometer: '' } })); }
  };
  const finishTrip = async (trip) => {
    const draft = tripDraft[trip.routeId] || {};
    if (!returnPhoto) return showToast('Take an odometer photo before completing the route', 'error');
    const result = await send(`/api/team/field-work/trips/${encodeURIComponent(trip.id)}/return`, 'PATCH', { odometer: draft.endOdometer, photoData: returnPhoto });
    if (result) { setReturnPhoto(''); setTripDraft((state) => ({ ...state, [trip.routeId]: { ...draft, endOdometer: '' } })); }
  };
  const submitClaim = async (event) => {
    event.preventDefault(); const result = await send('/api/team/field-work/claims', 'POST', claimDraft);
    if (result) setClaimDraft({ routeId: '', category: 'fuel', amount: '', note: '' });
  };
  const saveRetention = async (event) => { await send('/api/team/field-work/retention', 'PUT', { days: Number(event.target.value) }); };
  const saveGrace = async (event) => { await send('/api/team/field-work/inactivity-grace', 'PUT', { minutes: Number(event.target.value) }); };
  const reviewClaim = (claim, status) => send(`/api/team/field-work/claims/${encodeURIComponent(claim.id)}`, 'PATCH', { status });
  const photoButton = (id, label) => id && <button type="button" onClick={() => openPhoto(id)} disabled={photoLoading === id} className="text-indigo-500 hover:text-indigo-400 underline underline-offset-2 disabled:opacity-50">{photoLoading === id ? 'Loading…' : label}</button>;

  return <section className="space-y-5 rounded-2xl border border-bhodix-border bg-bhodix-card p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2 text-indigo-400"><Route className="h-4 w-4"/><span className="text-[10px] font-mono uppercase tracking-widest">Field operations</span></div><h2 className="mt-1 text-lg font-semibold text-bhodix-text">Shifts & routes</h2><p className="mt-1 max-w-2xl text-xs text-bhodix-textSubtle">Check in with a photo, record route odometers, compare distance, and submit expenses. While checked in as Working, Bhodhix checks only whether this app is open and being used; it does not record keystrokes, content, or location. Break and Travel pause inactivity alerts. Photos are workspace-private and expire after the configured period.</p></div>
      {manager && <div className="flex flex-wrap gap-2 text-xs text-bhodix-textMuted"><label className="flex items-center gap-2">Photo retention <select value={data.retentionDays} onChange={saveRetention} disabled={busy} className="rounded-lg border border-bhodix-border bg-bhodix-surface px-2 py-1.5 text-bhodix-text"><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option><option value="365">1 year</option><option value="730">2 years</option><option value="3650">10 years</option></select></label><label className="flex items-center gap-2">Idle grace <select value={data.inactivityGraceMinutes || 30} onChange={saveGrace} disabled={busy} className="rounded-lg border border-bhodix-border bg-bhodix-surface px-2 py-1.5 text-bhodix-text"><option value="20">20 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="60">60 min</option></select></label></div>}
    </div>
    {error && <p role="alert" className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 text-xs text-rose-400">{error}</p>}
    <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-bhodix-text"><CheckCircle2 className="h-4 w-4 text-emerald-400"/>Today's shift</div>
        <p className="mt-1 text-xs text-bhodix-textSubtle">Your check-in and work status are visible to workspace administrators.</p>
        <div className="mt-3 rounded-lg bg-bhodix-card px-3 py-2 text-xs text-bhodix-text">{shift?.checkedOutAt ? `Shift complete · ${new Date(shift.checkedInAt).toLocaleTimeString()}–${new Date(shift.checkedOutAt).toLocaleTimeString()}` : shift?.checkedInAt ? `On shift since ${new Date(shift.checkedInAt).toLocaleTimeString()}` : 'Not checked in'}</div>
        {shift?.checkedInAt && !shift.checkedOutAt && <label className="mt-2 block text-[11px] text-bhodix-textSubtle">Visible work status<select value={shift.activityStatus || 'working'} onChange={(event) => send('/api/team/field-work/activity-status', 'PUT', { status: event.target.value })} disabled={busy} className="mt-1 w-full rounded-lg border border-bhodix-border bg-bhodix-card px-2.5 py-2 text-xs capitalize text-bhodix-text"><option value="working">Working · inactivity check enabled</option><option value="break">Break · paused</option><option value="travel">Travel · paused</option></select></label>}
        {user?.role !== 'viewer' && <div className="mt-3 space-y-2"><label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-bhodix-border px-3 py-2 text-xs text-bhodix-textMuted hover:border-indigo-500"><Camera className="h-4 w-4"/>{shiftPhoto ? 'Photo ready' : 'Take check-in / check-out photo'}<input className="sr-only" type="file" accept="image/*" capture="user" onChange={(event) => setPhoto(event, setShiftPhoto)}/></label><div className="flex gap-2"><button type="button" onClick={() => submitShift('check_in')} disabled={busy || !!shift?.checkedInAt || !shiftPhoto} className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Check in</button><button type="button" onClick={() => submitShift('check_out')} disabled={busy || !shift?.checkedInAt || !!shift?.checkedOutAt || !shiftPhoto} className="flex-1 rounded-lg border border-bhodix-border px-3 py-2 text-xs font-semibold text-bhodix-text disabled:opacity-40">Check out</button></div></div>}
        {shift && <div className="mt-3 flex gap-3 text-xs">{photoButton(shift.checkInPhotoId, 'Check-in photo')}{photoButton(shift.checkOutPhotoId, 'Check-out photo')}</div>}
      </div>
      {manager && <form onSubmit={submitRoute} className="rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-bhodix-text"><MapPin className="h-4 w-4 text-indigo-400"/>Assign a daily route</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-[11px] text-bhodix-textSubtle">Employee<select required value={routeDraft.userId} onChange={(e) => setRouteDraft({ ...routeDraft, userId: e.target.value })} className="w-full rounded-lg border border-bhodix-border bg-bhodix-card px-2.5 py-2 text-xs text-bhodix-text"><option value="">Select teammate</option>{teamMembers.filter((item) => item.role !== 'viewer' && ['field', 'hybrid'].includes(item.workMode)).map((item) => <option key={item.userId} value={item.userId}>{item.name} · {item.workMode === 'field' ? 'on-ground' : 'hybrid'}</option>)}</select></label>
          <label className="space-y-1 text-[11px] text-bhodix-textSubtle">Date<input required type="date" value={routeDraft.date} onChange={(e) => setRouteDraft({ ...routeDraft, date: e.target.value })} className="w-full rounded-lg border border-bhodix-border bg-bhodix-card px-2.5 py-2 text-xs text-bhodix-text"/></label>
          <label className="space-y-1 text-[11px] text-bhodix-textSubtle">Route name<input required maxLength={120} value={routeDraft.title} onChange={(e) => setRouteDraft({ ...routeDraft, title: e.target.value })} placeholder="Client visits · North zone" className="w-full rounded-lg border border-bhodix-border bg-bhodix-card px-2.5 py-2 text-xs text-bhodix-text"/></label>
          <label className="space-y-1 text-[11px] text-bhodix-textSubtle">Project<select value={routeDraft.projectId} onChange={(e) => setRouteDraft({ ...routeDraft, projectId: e.target.value })} className="w-full rounded-lg border border-bhodix-border bg-bhodix-card px-2.5 py-2 text-xs text-bhodix-text"><option value="">General field work</option>{projectList.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label className="space-y-1 text-[11px] text-bhodix-textSubtle">Planned distance (km)<input required type="number" min="0.1" max="10000" step="0.1" value={routeDraft.plannedKm} onChange={(e) => setRouteDraft({ ...routeDraft, plannedKm: e.target.value })} className="w-full rounded-lg border border-bhodix-border bg-bhodix-card px-2.5 py-2 text-xs text-bhodix-text"/></label>
          <label className="space-y-1 text-[11px] text-bhodix-textSubtle sm:col-span-2">Stops, one per line<textarea rows="2" maxLength={4000} value={routeDraft.stops} onChange={(e) => setRouteDraft({ ...routeDraft, stops: e.target.value })} placeholder="Customer / location stop" className="w-full rounded-lg border border-bhodix-border bg-bhodix-card px-2.5 py-2 text-xs text-bhodix-text"/></label>
        </div><button disabled={busy || !teamMembers.some((item) => item.role !== 'viewer' && ['field', 'hybrid'].includes(item.workMode))} className="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Assign route</button>{!teamMembers.some((item) => item.role !== 'viewer' && ['field', 'hybrid'].includes(item.workMode)) && <p className="mt-2 text-[11px] text-bhodix-textSubtle">Set an employee’s work type to On-ground or Hybrid in Team before assigning routes.</p>}
      </form>}
    </div>
    {manager && <div className="rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-bhodix-text">Today's attendance</h3><span className="text-[10px] text-bhodix-textSubtle">Employee-submitted check-ins</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{teamMembers.filter((member) => member.role !== 'viewer').map((member) => { const record = data.shifts.find((item) => item.userId === member.userId && item.date === today()); return <div key={member.id} className="flex items-center justify-between gap-3 rounded-lg border border-bhodix-border bg-bhodix-card px-3 py-2 text-xs"><div className="min-w-0"><div className="truncate font-medium text-bhodix-text">{member.name}</div><div className="text-[10px] capitalize text-bhodix-textSubtle">{record?.checkedOutAt ? `Complete · ${new Date(record.checkedInAt).toLocaleTimeString()}–${new Date(record.checkedOutAt).toLocaleTimeString()}` : record?.checkedInAt ? `On shift · ${record.activityStatus || 'working'}${record.idleAlertAt ? ' · inactivity alert sent' : ''} · since ${new Date(record.checkedInAt).toLocaleTimeString()}` : 'Not checked in'} · {member.workMode === 'field' ? 'on-ground' : member.workMode || 'office'}</div></div><div className="flex shrink-0 gap-2">{photoButton(record?.checkInPhotoId, 'In photo')}{photoButton(record?.checkOutPhotoId, 'Out photo')}</div></div>; })}</div></div>}
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-4"><div className="flex items-center gap-2 text-sm font-semibold text-bhodix-text"><ClipboardList className="h-4 w-4 text-indigo-400"/>{manager ? 'Assigned routes' : 'My routes'}</div><div className="mt-3 space-y-3">
        {(manager ? data.routes : ownRoutes).length === 0 && <p className="text-xs text-bhodix-textSubtle">No routes assigned yet.</p>}
        {(manager ? data.routes : ownRoutes).map((route) => { const trip = data.trips.find((item) => item.routeId === route.id); const draft = tripDraft[route.id] || {}; return <article key={route.id} className="rounded-lg border border-bhodix-border bg-bhodix-card p-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="text-bhodix-text">{route.title}</strong><div className="mt-0.5 text-bhodix-textSubtle">{route.date} · {manager ? membersById.get(route.userId) || 'Former member' : 'Assigned to you'}{route.projectId ? ` · ${projectList.find((item) => item.id === route.projectId)?.name || route.projectId}` : ''}</div></div><span className="rounded-full bg-indigo-500/10 px-2 py-1 text-[10px] capitalize text-indigo-400">{route.status.replace('_', ' ')}</span></div><div className="mt-2 text-bhodix-textMuted">Planned {route.plannedKm} km{route.stops?.length ? ` · ${route.stops.length} stop${route.stops.length === 1 ? '' : 's'}` : ''}</div>{route.stops?.length > 0 && <ol className="mt-1 list-inside list-decimal text-bhodix-textSubtle">{route.stops.map((stop, index) => <li key={index}>{stop}</li>)}</ol>}
          {!manager && route.status === 'assigned' && <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-[10px] text-bhodix-textSubtle">Departure odometer<input type="number" min="0" max="10000000" step="0.1" value={draft.startOdometer || ''} onChange={(e) => setTripDraft({ ...tripDraft, [route.id]: { ...draft, startOdometer: e.target.value } })} className="mt-1 block w-36 rounded-lg border border-bhodix-border bg-bhodix-surface px-2 py-1.5 text-xs text-bhodix-text"/></label><label className="flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-bhodix-border px-2 py-1.5 text-[10px] text-bhodix-textMuted"><Camera className="h-3.5 w-3.5"/>{startPhoto ? 'Photo ready' : 'Odometer photo'}<input className="sr-only" type="file" accept="image/*" capture="environment" onChange={(event) => setPhoto(event, setStartPhoto)}/></label><button type="button" onClick={() => startTrip(route)} disabled={busy || !startPhoto || !draft.startOdometer} className="rounded-lg bg-indigo-600 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-40">Start route</button></div>}
          {!manager && route.status === 'in_progress' && trip && <div className="mt-3 flex flex-wrap items-end gap-2"><span className="text-[11px] text-bhodix-textMuted">Started at {trip.startOdometer} km</span><label className="text-[10px] text-bhodix-textSubtle">Return odometer<input type="number" min={trip.startOdometer} max="10000000" step="0.1" value={draft.endOdometer || ''} onChange={(e) => setTripDraft({ ...tripDraft, [route.id]: { ...draft, endOdometer: e.target.value } })} className="mt-1 block w-36 rounded-lg border border-bhodix-border bg-bhodix-surface px-2 py-1.5 text-xs text-bhodix-text"/></label><label className="flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-bhodix-border px-2 py-1.5 text-[10px] text-bhodix-textMuted"><Camera className="h-3.5 w-3.5"/>{returnPhoto ? 'Photo ready' : 'Odometer photo'}<input className="sr-only" type="file" accept="image/*" capture="environment" onChange={(event) => setPhoto(event, setReturnPhoto)}/></label><button type="button" onClick={() => finishTrip(trip)} disabled={busy || !returnPhoto || !draft.endOdometer} className="rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-semibold text-white text-white disabled:opacity-40">Finish route</button></div>}
          {trip && <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-bhodix-textMuted">{trip.distanceKm != null && <strong>Recorded {trip.distanceKm} km · {Number(trip.distanceKm - route.plannedKm).toFixed(1)} km vs plan</strong>}{photoButton(trip.departurePhotoId, 'Departure photo')}{photoButton(trip.returnPhotoId, 'Return photo')}</div>}
        </article>; })}</div></div>
      <div className="space-y-4">
        <form onSubmit={submitClaim} className="rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-4"><h3 className="text-sm font-semibold text-bhodix-text">Expense claim</h3><div className="mt-3 grid gap-2 sm:grid-cols-2"><select value={claimDraft.routeId} onChange={(e) => setClaimDraft({ ...claimDraft, routeId: e.target.value })} className="rounded-lg border border-bhodix-border bg-bhodix-card px-2.5 py-2 text-xs text-bhodix-text"><option value="">No specific route</option>{ownRoutes.map((route) => <option key={route.id} value={route.id}>{route.date} · {route.title}</option>)}</select><select value={claimDraft.category} onChange={(e) => setClaimDraft({ ...claimDraft, category: e.target.value })} className="rounded-lg border border-bhodix-border bg-bhodix-card px-2.5 py-2 text-xs text-bhodix-text"><option value="fuel">Fuel</option><option value="toll">Toll</option><option value="parking">Parking</option><option value="other">Other</option></select><input required type="number" min="0.01" max="10000000" step="0.01" value={claimDraft.amount} onChange={(e) => setClaimDraft({ ...claimDraft, amount: e.target.value })} placeholder="Amount (₹)" className="rounded-lg border border-bhodix-border bg-bhodix-card px-2.5 py-2 text-xs text-bhodix-text"/><input required maxLength={500} value={claimDraft.note} onChange={(e) => setClaimDraft({ ...claimDraft, note: e.target.value })} placeholder="Reason or receipt reference" className="rounded-lg border border-bhodix-border bg-bhodix-card px-2.5 py-2 text-xs text-bhodix-text"/></div><button disabled={busy} className="mt-3 rounded-lg border border-bhodix-border px-3 py-2 text-xs font-semibold text-bhodix-text disabled:opacity-40">Submit claim</button></form>
        <div className="rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-4"><h3 className="text-sm font-semibold text-bhodix-text">{manager ? 'Team expense claims' : 'My expense claims'}</h3><div className="mt-3 space-y-2">{data.claims.slice(0, 30).map((claim) => <div key={claim.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-bhodix-border bg-bhodix-card px-3 py-2 text-xs"><span className="min-w-0 flex-1 text-bhodix-text">{manager ? `${membersById.get(claim.userId) || 'Former member'} · ` : ''}{claim.category} · ₹{Number(claim.amount).toLocaleString('en-IN')}<span className="block truncate text-[10px] text-bhodix-textSubtle">{claim.note}</span></span><span className="capitalize text-bhodix-textMuted">{claim.status}</span>{manager && claim.status === 'pending' && <><button type="button" onClick={() => reviewClaim(claim, 'approved')} disabled={busy} className="text-emerald-400">Approve</button><button type="button" onClick={() => reviewClaim(claim, 'rejected')} disabled={busy} className="text-rose-400">Reject</button></>}</div>)}{data.claims.length === 0 && <p className="text-xs text-bhodix-textSubtle">No expense claims yet.</p>}</div></div>
      </div>
    </div>
    {photoPreview && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Field-work photo" onClick={() => { URL.revokeObjectURL(photoPreview); setPhotoPreview(''); }}><div className="relative max-h-full max-w-3xl rounded-xl bg-bhodix-card p-2" onClick={(event) => event.stopPropagation()}><button type="button" aria-label="Close photo" className="absolute -right-3 -top-3 rounded-full bg-bhodix-card p-2 text-bhodix-text" onClick={() => { URL.revokeObjectURL(photoPreview); setPhotoPreview(''); }}><X className="h-4 w-4"/></button><img src={photoPreview} alt="Submitted field-work record" className="max-h-[85vh] max-w-full rounded-lg object-contain"/></div></div>}
  </section>;
}
