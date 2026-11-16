import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { CheckCircle2, AlertCircle, Info, Bell, X, Mail, CalendarDays, ListChecks } from 'lucide-react';
import { useVault } from '../context/VaultContext';

const ToastContext = createContext();

const TYPES = {
  success: { Icon: CheckCircle2, color: 'text-emerald-500' },
  error: { Icon: AlertCircle, color: 'text-rose-500' },
  info: { Icon: Info, color: 'text-indigo-500' }
};

const NOTIFICATIONS = {
  mail: { label: 'Mail', Icon: Mail, color: 'text-sky-400', surface: 'bg-sky-500/10', border: 'border-sky-500/20' },
  meeting: { label: 'Meeting', Icon: CalendarDays, color: 'text-violet-400', surface: 'bg-violet-500/10', border: 'border-violet-500/20' },
  task: { label: 'Task', Icon: ListChecks, color: 'text-amber-400', surface: 'bg-amber-500/10', border: 'border-amber-500/20' },
  system: { label: 'Bhodhix', Icon: Bell, color: 'text-indigo-400', surface: 'bg-indigo-500/10', border: 'border-indigo-500/20' }
};
const decodePushKey = (value) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), (character) => character.charCodeAt(0));

export const ToastProvider = ({ children }) => {
  const { isAuthenticated, user, vault, apiFetch } = useVault();
  const apiFetchRef = useRef(apiFetch);
  apiFetchRef.current = apiFetch;
  const [toasts, setToasts] = useState([]);
  const [history, setHistory] = useState(() => { try { return JSON.parse(localStorage.getItem('bhodix_notifications') || '[]'); } catch { return []; } });
  const [readAt, setReadAt] = useState(() => Number(localStorage.getItem('bhodix_notifications_read_at')) || 0);
  const [showNotifications, setShowNotifications] = useState(false);
  const prefsKey = `bhodhix_notification_prefs_${user?.organization?.slug || 'local'}_${user?.id || 'guest'}`;
  const [notificationPrefs, setNotificationPrefs] = useState({ quietHours: false, quietStart: '22:00', quietEnd: '08:00', categories: { mail: true, meeting: true, task: true, system: true } });
  const [prefsReady, setPrefsReady] = useState(false);
  const notificationPrefsRef = useRef(notificationPrefs);
  const [remindersEnabled, setRemindersEnabled] = useState(() => typeof window !== 'undefined' && 'Notification' in window && window.localStorage.getItem('bhodix_due_reminders') === 'true' && Notification.permission === 'granted');

  useEffect(() => { try { localStorage.setItem('bhodix_notifications', JSON.stringify(history)); } catch { /* storage unavailable */ } }, [history]);
  useEffect(() => {
    let current = true;
    setPrefsReady(false);
    try {
      const saved = JSON.parse(localStorage.getItem(prefsKey) || 'null');
      if (saved) setNotificationPrefs((current) => ({ ...current, ...saved, categories: { ...current.categories, ...saved.categories } }));
    } catch { /* use defaults */ }
    if (!isAuthenticated) { setPrefsReady(true); return () => { current = false; }; }
    apiFetchRef.current('/api/push/preferences').then((response) => response.json()).then((data) => {
      const saved = data?.preferences;
      if (current && saved?.categories) setNotificationPrefs((value) => ({ ...value, ...saved, categories: { ...value.categories, ...saved.categories } }));
    }).catch(() => {}).finally(() => { if (current) setPrefsReady(true); });
    return () => { current = false; };
  }, [prefsKey, isAuthenticated]);
  useEffect(() => {
    notificationPrefsRef.current = notificationPrefs;
    if (!prefsReady) return;
    try { localStorage.setItem(prefsKey, JSON.stringify(notificationPrefs)); } catch { /* storage unavailable */ }
  }, [notificationPrefs, prefsKey, prefsReady]);
  useEffect(() => {
    if (!prefsReady || !isAuthenticated) return undefined;
    const timer = setTimeout(() => {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      apiFetchRef.current('/api/push/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences: { ...notificationPrefs, timeZone } }) }).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [notificationPrefs, prefsReady, isAuthenticated]);
  const showToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = Math.random().toString(36).slice(2, 11);
    setHistory((prev) => [{ id, message, type, time: Date.now() }, ...prev].slice(0, 20));
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
  }, []);

  const notify = useCallback(({ kind = 'system', title, body, data = {}, tag: requestedTag }) => {
    const category = NOTIFICATIONS[kind] ? kind : 'system';
    const item = { id: Math.random().toString(36).slice(2, 11), kind: category, title: String(title || NOTIFICATIONS[category].label).slice(0, 120), body: String(body || '').slice(0, 500), data, time: Date.now() };
    setHistory((prev) => [item, ...prev].slice(0, 30));
    const prefs = notificationPrefsRef.current;
    const minuteNow = new Date().getHours() * 60 + new Date().getMinutes();
    const parseTime = (value, fallback) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : fallback;
    const quietStart = parseTime(prefs.quietStart, 22 * 60);
    const quietEnd = parseTime(prefs.quietEnd, 8 * 60);
    const inQuietHours = prefs.quietHours && quietStart !== quietEnd && (quietStart < quietEnd ? minuteNow >= quietStart && minuteNow < quietEnd : minuteNow >= quietStart || minuteNow < quietEnd);
    if (prefs.categories[category] === false || inQuietHours) return item.id;
    const tag = requestedTag || `bhodhix-${category}-${item.id}`;
    if (window.bhodhixDesktop?.notify) {
      window.bhodhixDesktop.notify({ ...item, tag });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      const options = { body: item.body, tag, data };
      if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then((registration) => registration ? registration.showNotification(item.title, options) : new Notification(item.title, options)).catch(() => new Notification(item.title, options));
      else new Notification(item.title, options);
    }
    return item.id;
  }, []);

  useEffect(() => {
    const receive = (event) => { const item = event.detail || {}; notify({ kind: item.kind, title: item.title, body: item.body, tag: item.tag, data: { url: item.url } }); };
    window.addEventListener('bhodhix:server-notification', receive);
    return () => window.removeEventListener('bhodhix:server-notification', receive);
  }, [notify]);

  const setDueReminders = async (enabled) => {
    if (!enabled) {
      try {
        const registration = await navigator.serviceWorker?.getRegistration();
        const subscription = await registration?.pushManager?.getSubscription();
        if (subscription) {
          await apiFetch('/api/push/subscription', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
          await subscription.unsubscribe();
        }
      } catch { /* local reminders can still be disabled when push service is offline */ }
      localStorage.setItem('bhodix_due_reminders', 'false');
      setRemindersEnabled(false);
      return;
    }
    if (!('Notification' in window)) return showToast('Browser notifications are not supported on this device', 'error');
    try {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') return showToast('Allow notifications in browser settings to receive task reminders', 'error');
      try {
        const configResponse = await apiFetch('/api/push/config');
        const config = await configResponse.json();
        if (config.configured && config.publicKey && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window) {
          let registration = await navigator.serviceWorker.getRegistration();
          if (!registration) await navigator.serviceWorker.register('/sw.js');
          registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodePushKey(config.publicKey) });
          const saved = await apiFetch('/api/push/subscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON() }) });
          if (!saved.ok) throw new Error('Could not save this device for push notifications');
        } else showToast('Device reminders will work while Bhodhix is open; background push is not configured for this server', 'info', 5000);
      } catch (error) { showToast(error.message || 'Background push could not be enabled; in-app reminders remain available', 'info', 5000); }
      localStorage.setItem('bhodix_due_reminders', 'true');
      setRemindersEnabled(true);
      showToast('Notifications enabled on this device', 'success');
    } catch { showToast('Could not enable browser notifications', 'error'); }
  };

  // shortcut: reminders run while the app is active; use scheduled push when unattended delivery is required.
  useEffect(() => {
    if (!isAuthenticated || !remindersEnabled || Notification.permission !== 'granted') return undefined;
    const checkDueTasks = () => {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const myNames = [user?.name, user?.email].filter(Boolean).map((value) => value.toLowerCase());
      const assignedToMe = (task) => !task.assignee || myNames.includes(String(task.assignee).toLowerCase());
      if (document.visibilityState === 'visible' && localStorage.getItem('bhodix_due_reminder_sent') !== today) {
        const due = Object.entries(vault?.projects || {}).flatMap(([project, item]) => (item.tasks || []).filter((task) => task.status !== 'done' && task.dueDate === today && assignedToMe(task)).map((task) => ({ ...task, project })));
        if (due.length) {
          localStorage.setItem('bhodix_due_reminder_sent', today);
          const titles = due.slice(0, 3).map((task) => task.title).join(', ');
          const body = `${due.length} open task${due.length === 1 ? '' : 's'} due today: ${titles}${due.length > 3 ? `, and ${due.length - 3} more` : ''}`;
          notify({ kind: 'task', title: 'Due today', body, tag: `bhodhix-due-${today}`, data: { category: 'due_tasks' } });
        }
      }

      const storageKey = `bhodhix_task_reminders_sent_${user?.organization?.slug || 'local'}`;
      const orgSlug = user?.organization?.slug || 'local';
      let sent = {};
      try { sent = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { sent = {}; }
      const cutoff = now.getTime() - 90 * 24 * 60 * 60 * 1000;
      sent = Object.fromEntries(Object.entries(sent).filter(([, sentAt]) => Number(sentAt) > cutoff));
      const pending = Object.entries(vault?.projects || {}).flatMap(([project, item]) => (item.tasks || []).filter((task) => task.reminderAt && task.status !== 'done' && assignedToMe(task)).map((task) => ({ ...task, project })))
        .filter((task) => Number.isFinite(Date.parse(task.reminderAt)) && Date.parse(task.reminderAt) <= now.getTime())
        .filter((task) => !sent[`${task.project}:${task.id}:${task.reminderAt}`]);
      pending.slice(0, 5).forEach((task) => {
        const key = `${task.project}:${task.id}:${task.reminderAt}`;
        sent[key] = now.getTime();
        if (now.getTime() - Date.parse(task.reminderAt) > 24 * 60 * 60 * 1000) return;
        const body = `${task.title} · ${task.project}`;
        notify({ kind: 'task', title: 'Task reminder', body, tag: `bhodhix-${orgSlug}-task-${task.id}-${Date.parse(task.reminderAt)}`, data: { organizationSlug: orgSlug, projectId: task.project, taskId: task.id } });
      });
      try { localStorage.setItem(storageKey, JSON.stringify(sent)); } catch { /* storage unavailable */ }
    };
    checkDueTasks();
    const timer = window.setInterval(checkDueTasks, 60_000);
    document.addEventListener('visibilitychange', checkDueTasks);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', checkDueTasks); };
  }, [isAuthenticated, remindersEnabled, user?.name, user?.email, user?.organization?.slug, vault, notify]);

  return (
    <ToastContext.Provider value={{ showToast, notify }}>
      {children}
      <div className="fixed right-3 top-[4.25rem] z-[80] md:right-6 md:top-4">
        <button aria-label="Open notification center" aria-expanded={showNotifications} onClick={() => { setShowNotifications((open) => !open); const now = Date.now(); setReadAt(now); try { localStorage.setItem('bhodix_notifications_read_at', String(now)); } catch { /* storage unavailable */ } }} className="relative rounded-lg border border-bhodix-border bg-bhodix-card p-2 text-bhodix-textMuted shadow-sm hover:text-indigo-500"><Bell className="h-4 w-4" />{history.some((item) => item.time > readAt) && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-rose-500" />}</button>
        {showNotifications && <NotificationCenter history={history} setHistory={setHistory} onClose={() => setShowNotifications(false)} remindersEnabled={remindersEnabled} setDueReminders={setDueReminders} notificationPrefs={notificationPrefs} setNotificationPrefs={setNotificationPrefs} />}
      </div>
      <div className="pointer-events-none fixed right-3 top-20 z-[70] flex flex-col items-end gap-2 md:right-6">
        {toasts.map(({ id, message, type }) => {
          const { Icon, color } = TYPES[type] || TYPES.info;
          return (
            <div
              key={id}
              className="toast-in pointer-events-auto flex items-center gap-2.5 pl-3 pr-4 py-2.5 rounded-xl border border-bhodix-border bg-bhodix-card text-bhodix-text text-xs font-medium shadow-xl shadow-black/10"
            >
              <Icon className={`w-4 h-4 shrink-0 ${color}`} />
              <span>{message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);

function NotificationCenter({ history, setHistory, onClose, remindersEnabled, setDueReminders, notificationPrefs, setNotificationPrefs }) {
  const [filter, setFilter] = useState('all');
  const filters = [{ id: 'all', label: 'All' }, { id: 'mail', label: 'Mail' }, { id: 'meeting', label: 'Meetings' }, { id: 'task', label: 'Tasks' }, { id: 'system', label: 'System' }];
  const visible = history.filter((item) => filter === 'all' || (item.kind || 'system') === filter);
  return (
    <div role="region" aria-label="Notification center" className="absolute right-0 top-11 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-bhodix-border bg-bhodix-card shadow-2xl">
      <div className="flex items-center justify-between border-b border-bhodix-border px-4 py-3"><div><h2 className="text-sm font-bold text-bhodix-text">Notification hub</h2><p className="text-[10px] text-bhodix-textSubtle">Mail · meetings · tasks · system</p></div><button onClick={onClose} aria-label="Close notifications" className="rounded-lg p-1.5 text-bhodix-textSubtle hover:bg-bhodix-hover"><X className="h-4 w-4" /></button></div>
      <div className="flex gap-1 overflow-x-auto border-b border-bhodix-border px-3 py-2">{filters.map((item) => <button key={item.id} onClick={() => setFilter(item.id)} className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${filter === item.id ? 'bg-indigo-500/15 text-indigo-400' : 'text-bhodix-textSubtle hover:bg-bhodix-hover'}`}>{item.label}{item.id !== 'all' && <span className="ml-1 opacity-60">{history.filter((entry) => (entry.kind || 'system') === item.id).length}</span>}</button>)}</div>
      <div className="max-h-80 space-y-2 overflow-y-auto p-3">
        {visible.map((item) => {
          const meta = NOTIFICATIONS[item.kind] || NOTIFICATIONS.system;
          const Icon = item.Icon || meta.Icon;
          const title = item.title || item.message || meta.label;
          const body = item.body || item.message || '';
          return <article key={item.id} className={`flex gap-3 rounded-xl border ${meta.border} ${meta.surface} p-3`}><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-bhodix-card/80"><Icon className={`h-4 w-4 ${meta.color}`} /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className={`text-[9px] font-bold uppercase tracking-wider ${meta.color}`}>{meta.label}</span><time className="text-[9px] text-bhodix-textSubtle">{new Date(item.time).toLocaleString()}</time></div><p className="mt-1 truncate text-xs font-semibold text-bhodix-text">{title}</p><p className="mt-0.5 line-clamp-2 text-[10px] text-bhodix-textMuted">{body}</p></div></article>;
        })}
        {!visible.length && <div className="px-3 py-7 text-center"><p className="text-xs font-semibold text-bhodix-text">Nothing here yet</p><p className="mt-1 text-[10px] text-bhodix-textSubtle">{filter === 'mail' ? 'Mail alerts will appear when an inbox is connected.' : filter === 'meeting' ? 'Meeting alerts will appear when a calendar is connected.' : 'New alerts will appear here.'}</p></div>}
      </div>
      <div className="border-t border-bhodix-border p-3 space-y-3"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold text-bhodix-text">Device notifications</p><p className="mt-0.5 text-[9px] text-bhodix-textSubtle">Task, mail, and meeting alerts; background delivery needs server push setup</p></div><button onClick={() => setDueReminders(!remindersEnabled)} className="rounded-lg border border-bhodix-border px-2.5 py-1.5 text-[10px] font-semibold text-indigo-400">{remindersEnabled ? 'Turn off' : 'Enable'}</button></div><div className="rounded-lg bg-bhodix-surface p-3"><label className="flex items-center justify-between gap-2 text-[10px] font-semibold text-bhodix-text"><span>Quiet hours</span><input type="checkbox" checked={notificationPrefs.quietHours} onChange={(event) => setNotificationPrefs((current) => ({ ...current, quietHours: event.target.checked }))} className="accent-indigo-500" /></label>{notificationPrefs.quietHours && <div className="mt-2 flex items-center gap-2 text-[9px] text-bhodix-textMuted"><input aria-label="Quiet hours start" type="time" value={notificationPrefs.quietStart} onChange={(event) => setNotificationPrefs((current) => ({ ...current, quietStart: event.target.value }))} className="rounded border border-bhodix-border bg-bhodix-card px-2 py-1" /><span>to</span><input aria-label="Quiet hours end" type="time" value={notificationPrefs.quietEnd} onChange={(event) => setNotificationPrefs((current) => ({ ...current, quietEnd: event.target.value }))} className="rounded border border-bhodix-border bg-bhodix-card px-2 py-1" /></div>}<div className="mt-3 flex flex-wrap gap-2">{filters.filter((item) => item.id !== 'all').map((item) => <label key={item.id} className="inline-flex items-center gap-1.5 text-[9px] text-bhodix-textMuted"><input type="checkbox" checked={notificationPrefs.categories[item.id] !== false} onChange={(event) => setNotificationPrefs((current) => ({ ...current, categories: { ...current.categories, [item.id]: event.target.checked } }))} className="accent-indigo-500" />{item.label}</label>)}</div></div><button onClick={() => setHistory([])} className="w-full rounded-lg px-2 py-1 text-left text-[9px] text-bhodix-textSubtle hover:bg-bhodix-hover">Clear notification history</button></div>
    </div>
  );
}
