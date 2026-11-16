import React, { useState, useEffect, useRef } from 'react';
import { Plus, Kanban, List, CheckSquare, Square, X, AlertTriangle, ArrowRight, CalendarDays, Users, ChevronLeft, ChevronRight, MessageSquare, Clock3, Link2, Send, Trash2, RotateCcw, Flag, Calendar, User, Bell, CheckCircle2 } from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { useToast } from '../components/ToastProvider';
import ThemedSelect from '../components/ThemedSelect';
import { getPriorityStyle, BOARD_COLUMNS, STATUS_LABELS, PRIORITY_ORDER, DONE_VISIBLE_DAYS } from '../lib/constants';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import useDialogFocus from '../lib/useDialogFocus';

const COLUMN_IDS = BOARD_COLUMNS.map((c) => c.id);
const DAY_MS = 86400000;
const TODAY = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const EMPTY_FILTERS = { project: '', status: '', priority: '', assignee: '', title: '', tag: '', due: '' };
const localDateTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

// Tasks with an unknown status still show up (as To Do) rather than vanishing.
const colOf = (t) => (COLUMN_IDS.includes(t.status) ? t.status : 'todo');
const byPriority = (a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) || a.id.localeCompare(b.id);
// Fit model: sized from measured card heights so every column stays on screen.
// A column shows full cards if they fit, else compact cards in 1-4 inner columns (more width for busy columns).
const FULL_CARD_H = 215; // card + gap
const COMPACT_CARD_H = 115;
const COLUMN_CHROME_H = 53 + 20; // header + body padding
const MAX_INNER_COLS = 4;
const EMPTY_COLUMN_WEIGHT = 0.8;

function layoutFor(count, boardH) {
  const usable = Math.max(200, boardH - COLUMN_CHROME_H);
  if (count * FULL_CARD_H <= usable + 10) return { weight: 1, compact: false };
  const perColumn = Math.max(1, Math.floor(usable / COMPACT_CARD_H));
  return { weight: Math.min(MAX_INNER_COLS, Math.ceil(count / perColumn)), compact: true };
}

function SortableTask({ task, compact, onClick }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const totalSub = task.subtasks?.length || 0;
  const doneSub = task.subtasks?.filter((s) => s.completed).length || 0;
  const style = getPriorityStyle(task.priority);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : 1 }}
      {...attributes}
      {...listeners}
      className={`bg-bhodix-card hover:bg-bhodix-hover border border-bhodix-border hover:border-bhodix-borderHover rounded-xl ${compact ? 'p-2.5 space-y-1.5' : 'p-3.5 space-y-2.5'} transition-colors shadow-sm cursor-pointer group min-w-0 ${isDragging ? 'opacity-50 ring-2 ring-indigo-500' : ''}`}
      onClick={() => { if (!isDragging) onClick(task); }}
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-mono text-indigo-500 dark:text-indigo-400 font-semibold shrink-0">{task.id}</span>
          {compact && <span className="px-1 rounded bg-bhodix-surface uppercase font-bold text-[8px] text-indigo-500 dark:text-indigo-300 truncate">{task.project}</span>}
        </div>
        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase font-medium shrink-0 ${style.badge}`}>{task.priority}</span>
      </div>
      <div className="text-xs font-semibold text-bhodix-text group-hover:text-indigo-500 transition-colors line-clamp-2">{task.title}</div>

      {task.status === 'hold' && (
        task.note
          ? <div className={`text-[10px] text-amber-600 dark:text-amber-300 ${compact ? 'line-clamp-1' : 'line-clamp-2'}`}>⏸ {task.note}</div>
          : <div className="text-[10px] text-rose-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />note missing</div>
      )}

      {!compact && task.description && (
        <div className="text-[11px] text-bhodix-textMuted line-clamp-2">{task.description}</div>
      )}
      {!compact && totalSub > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] font-mono text-bhodix-textSubtle">
            <span>Subtasks</span><span>{doneSub}/{totalSub}</span>
          </div>
          <div className="w-full bg-bhodix-surface rounded-full h-1 overflow-hidden">
            <div className="bg-emerald-500 h-1 rounded-full" style={{ width: `${(doneSub / totalSub) * 100}%` }} />
          </div>
        </div>
      )}
      {!compact && (
        <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-bhodix-textSubtle">
          <span className="px-1.5 py-0.5 rounded bg-bhodix-surface uppercase font-bold text-[9px] text-indigo-500 dark:text-indigo-300 truncate">{task.project}</span>
          <span className="shrink-0">{task.startAt ? `Starts ${new Date(task.startAt).toLocaleString()}` : task.dueDate}</span>
        </div>
      )}
    </div>
  );
}

function Column({ col, tasks, layout, onOpen, onAdd, footer }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-0 min-w-0 flex flex-col rounded-2xl border border-bhodix-border border-t-2 ${col.accent} bg-bhodix-card/60 ${isOver ? 'ring-2 ring-indigo-500/60' : ''}`}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2 border-b border-bhodix-borderSubtle">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-bhodix-text uppercase tracking-wider font-mono truncate">{col.title}</span>
            <span className="text-[10px] font-mono px-1.5 rounded bg-bhodix-surface text-bhodix-textSubtle border border-bhodix-borderSubtle">{tasks.length}</span>
          </div>
          {col.hint && <div className="text-[10px] text-bhodix-textSubtle truncate">{col.hint}</div>}
        </div>
        {onAdd && (
          <button onClick={() => onAdd(col.id)} className="p-1 rounded text-bhodix-textSubtle hover:text-indigo-500 hover:bg-bhodix-surface" title={`Add to ${col.title}`}>
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2.5">
        <SortableContext items={tasks.map((t) => t.id)} strategy={rectSortingStrategy}>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${layout.weight}, minmax(0, 1fr))` }}>
            {tasks.map((t) => <SortableTask key={t.id} task={t} compact={layout.compact} onClick={onOpen} />)}
          </div>
        </SortableContext>
      </div>
      {footer}
    </div>
  );
}

const SELECT_CLS = 'w-full p-1 rounded bg-bhodix-surface border border-bhodix-border text-[10px] text-bhodix-text normal-case font-normal';

export default function PlannerView() {
  const { vault, selectedProject, projectList, teamMembers, user, getAllTasks, updateTaskStatus, toggleSubtask, createTask, deleteTask, getDeletedTasks, restoreTask, apiFetch, refreshVault, saveFile } = useVault();
  const { showToast } = useToast();
  const canEdit = user?.role !== 'viewer';
  const canManageAi = ['owner', 'admin'].includes(user?.role);

  const [viewMode, setViewMode] = useState('kanban');
  const [showNewModal, setShowNewModal] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [taskActivity, setTaskActivity] = useState([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [timeDraft, setTimeDraft] = useState({ minutes: '', note: '' });
  const [linkDraft, setLinkDraft] = useState({ label: '', url: '' });
  const [reminderDraft, setReminderDraft] = useState('');
  const [activeTool, setActiveTool] = useState(null); // 'time' | 'link' | 'reminder' | null
  const [optimistic, setOptimistic] = useState({});
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [savedTaskViews, setSavedTaskViews] = useState([]);
  const [showSavedViews, setShowSavedViews] = useState(false);
  const [holdPrompt, setHoldPrompt] = useState(null); // { tasks, note }
  const [deletePrompt, setDeletePrompt] = useState(null); // { task, reason }
  const [showTrash, setShowTrash] = useState(false);
  const [trashItems, setTrashItems] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashBusy, setTrashBusy] = useState(false);
  const [dragOverDate, setDragOverDate] = useState(null);
  const [boardH, setBoardH] = useState(800);
  const boardRef = useRef(null);
  const hasBoard = viewMode === 'kanban';

  const handleUpdatePriority = async (task, newPriority) => {
    if (!canEdit || !task) return;
    try {
      const relPath = `projects/${task.project}/tasks.md`;
      const res = await apiFetch(`/api/vault/file?path=${encodeURIComponent(relPath)}`);
      const data = await res.json();
      if (!data.success || typeof data.content !== 'string') throw new Error('Could not read task file');

      const c = data.content;
      const start = c.indexOf(`### ${task.id}:`);
      if (start === -1) throw new Error('Task not found in file');
      const next = c.indexOf('\n### ', start + 3);
      const end = next === -1 ? c.length : next + 1;
      const b = c.slice(start, end);

      let up = b;
      if (/^- \*\*priority\*\*:/m.test(b)) {
        up = up.replace(/^(- \*\*priority\*\*:).*$/m, `$1 ${newPriority}`);
      } else {
        up = up.replace(/^(- \*\*status\*\*:.*)$/m, `$1\n- **priority**: ${newPriority}`);
      }

      const newContent = c.slice(0, start) + up + c.slice(end);
      const ok = await saveFile(relPath, newContent);
      if (ok) {
        setOptimistic((prev) => ({
          ...prev,
          [task.id]: { ...(prev[task.id] || {}), priority: newPriority }
        }));
        await addTaskActivity('comment', `Changed priority to ${newPriority}`);
        showToast(`Priority updated to ${newPriority}`, 'success');
      }
    } catch (err) {
      showToast(err.message || 'Could not update priority', 'error');
    }
  };

  const handleRescheduleTask = async (project, taskId, newDate) => {
    if (!canEdit) return;
    try {
      const relPath = `projects/${project}/tasks.md`;
      const res = await apiFetch(`/api/vault/file?path=${encodeURIComponent(relPath)}`);
      const data = await res.json();
      if (!data.success || typeof data.content !== 'string') throw new Error('Could not read task file');

      const c = data.content;
      const start = c.indexOf(`### ${taskId}:`);
      if (start === -1) throw new Error('Task not found in file');
      const next = c.indexOf('\n### ', start + 3);
      const end = next === -1 ? c.length : next + 1;
      const b = c.slice(start, end);

      let up = b;
      if (/^- \*\*due_date\*\*:/m.test(b)) {
        up = up.replace(/^(- \*\*due_date\*\*:).*$/m, `$1 ${newDate}`);
      } else {
        up = up.replace(/^(- \*\*status\*\*:.*)$/m, `$1\n- **due_date**: ${newDate}`);
      }

      const newContent = c.slice(0, start) + up + c.slice(end);
      const ok = await saveFile(relPath, newContent);
      if (ok) {
        setOptimistic((prev) => ({
          ...prev,
          [taskId]: { ...(prev[taskId] || {}), dueDate: newDate }
        }));
        await addTaskActivity('comment', `Rescheduled due date to ${newDate}`);
        showToast(`Task ${taskId} moved to ${newDate}`, 'success');
      }
    } catch (err) {
      showToast(err.message || 'Could not reschedule task', 'error');
    }
  };

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setBoardH(el.clientHeight));
    ro.observe(el);
    setBoardH(el.clientHeight);
    return () => ro.disconnect();
  }, [hasBoard]);

  const [newProject, setNewProject] = useState(selectedProject !== 'all' ? selectedProject : (projectList[0]?.id || ''));
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newStatus, setNewStatus] = useState('todo');
  const [newNote, setNewNote] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [newDueDate, setNewDueDate] = useState(TODAY());
  const [newStartAt, setNewStartAt] = useState('');
  const [newReminderAt, setNewReminderAt] = useState('');
  const [aiProviders, setAiProviders] = useState([]);
  const [newAiProvider, setNewAiProvider] = useState('');
  const [newAiInstructions, setNewAiInstructions] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newSubtasks, setNewSubtasks] = useState('');
  const [newTags, setNewTags] = useState('');
  const [newBlockedBy, setNewBlockedBy] = useState('');
  const [newRecurrence, setNewRecurrence] = useState('');
  const [newCustomFields, setNewCustomFields] = useState('');
  const [sortBy, setSortBy] = useState('dueDate');
  const [sortDirection, setSortDirection] = useState('asc');
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [taskTemplates, setTaskTemplates] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bhodix_task_templates') || '[]'); } catch { return []; }
  });
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [showTemplateSave, setShowTemplateSave] = useState(false);

  useEffect(() => {
    if (!user?.token) return;
    let active = true;
    fetch('/api/tasks/templates', { headers: { 'x-bhodix-token': user.token } })
      .then((res) => res.json())
      .then((data) => {
        if (!active || !data.success) return;
        setTaskTemplates((local) => {
          const names = new Set(data.templates.map((template) => template.name.toLowerCase()));
          const merged = [...data.templates, ...local.filter((template) => !names.has(template.name.toLowerCase()))];
          try { localStorage.setItem('bhodix_task_templates', JSON.stringify(merged)); } catch { /* storage unavailable */ }
          return merged;
        });
      }).catch(() => {});
    return () => { active = false; };
  }, [user?.token]);

  useEffect(() => {
    if (!user?.token || !canManageAi) { setAiProviders([]); return undefined; }
    let active = true;
    fetch('/api/tasks/ai/providers', { headers: { 'x-bhodix-token': user.token } })
      .then((res) => res.json())
      .then((data) => { if (active && data.success) setAiProviders(data.providers || []); })
      .catch(() => {});
    return () => { active = false; };
  }, [user?.token, canManageAi]);

  const savedViewsKey = `bhodix_saved_task_views_${user?.organization?.slug || 'local'}`;
  useEffect(() => {
    try { setSavedTaskViews(JSON.parse(localStorage.getItem(savedViewsKey) || '[]')); } catch { setSavedTaskViews([]); }
  }, [savedViewsKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Optimistic edits only bridge the gap until the vault reports the real change.
  useEffect(() => { setOptimistic({}); }, [vault]);

  useEffect(() => {
    const openTask = (wanted) => {
      if (!wanted?.taskId) return;
      setSelectedId(wanted.taskId);
      setViewMode('list');
      localStorage.removeItem('bhodix_task_to_open');
    };
    const raw = localStorage.getItem('bhodix_task_to_open');
    if (raw) {
      try { openTask(JSON.parse(raw)); } catch { localStorage.removeItem('bhodix_task_to_open'); }
    }
    const requested = (e) => openTask(e.detail);
    window.addEventListener('bhodix:open-task', requested);
    return () => window.removeEventListener('bhodix:open-task', requested);
  }, []);

  useEffect(() => {
    const requested = localStorage.getItem('bhodix_planner_mode');
    if (['calendar', 'timeline', 'workload'].includes(requested)) setViewMode(requested);
    localStorage.removeItem('bhodix_planner_mode');
    const changeMode = (event) => { if (['kanban', 'list', 'today', 'calendar', 'timeline', 'workload'].includes(event.detail)) setViewMode(event.detail); };
    window.addEventListener('bhodix:planner-mode', changeMode);
    return () => window.removeEventListener('bhodix:planner-mode', changeMode);
  }, []);

  useEffect(() => {
    const closeOnEscape = (e) => {
      if (e.key !== 'Escape') return;
      setSelectedId(null);
      setShowNewModal(false);
      setHoldPrompt(null);
      setDeletePrompt(null);
      setShowTrash(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const allTasks = getAllTasks().map((t) => ({ ...t, ...(optimistic[t.id] || {}) }));
  const selected = allTasks.find((t) => t.id === selectedId) || null;
  const taskDetailRef = useDialogFocus(!!selected);
  const holdDialogRef = useDialogFocus(!!holdPrompt);
  const deleteDialogRef = useDialogFocus(!!deletePrompt);
  const trashDialogRef = useDialogFocus(showTrash);
  const newTaskDialogRef = useDialogFocus(showNewModal);

  useEffect(() => {
    if (!selected) { setTaskActivity([]); return undefined; }
    let active = true;
    const refresh = async () => {
      try {
        const res = await apiFetch(`/api/tasks/${encodeURIComponent(selected.project)}/${encodeURIComponent(selected.id)}/activity`);
        const data = await res.json();
        if (active && data.success) setTaskActivity(data.entries);
      } catch { if (active) setTaskActivity([]); }
    };
    const onActivity = (event) => {
      if (event.detail?.projectId === selected.project && event.detail?.taskId === selected.id) refresh();
    };
    refresh();
    window.addEventListener('bhodix:task-activity-update', onActivity);
    return () => { active = false; window.removeEventListener('bhodix:task-activity-update', onActivity); };
  }, [selected?.project, selected?.id, user?.token]);

  useEffect(() => { setReminderDraft(localDateTime(selected?.reminderAt)); }, [selected?.project, selected?.id, selected?.reminderAt]);

  const saveTaskReminder = async (e, value = reminderDraft) => {
    e.preventDefault();
    if (!selected || !canEdit) return;
    try {
      const res = await apiFetch('/api/tasks/reminder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: selected.project, taskId: selected.id, reminderAt: value ? new Date(value).toISOString() : '' })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await refreshVault();
      showToast(value ? 'Task reminder saved' : 'Task reminder cleared', 'success');
    } catch (error) { showToast(error.message || 'Could not save task reminder', 'error'); }
  };

  const addTaskActivity = async (type, content, value = '') => {
    if (!selected || !canEdit) return false;
    try {
      const res = await apiFetch(`/api/tasks/${encodeURIComponent(selected.project)}/${encodeURIComponent(selected.id)}/activity`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, content, value })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setTaskActivity((entries) => [data.entry, ...entries]);
      return true;
    } catch (error) {
      showToast(error.message || 'Could not save task update', 'error');
      return false;
    }
  };

  // Board: done tasks disappear after a week and live on in the sheet.
  const recentDone = (t) => !t.doneAt || Date.now() - new Date(t.doneAt).getTime() < DONE_VISIBLE_DAYS * DAY_MS;
  const boardTasks = allTasks.filter((t) => t.status !== 'done' || recentDone(t));
  const archivedCount = allTasks.length - boardTasks.length;
  const columnTasks = Object.fromEntries(
    BOARD_COLUMNS.map((c) => [c.id, boardTasks.filter((t) => colOf(t) === c.id).sort(byPriority)])
  );
  const layouts = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.id, layoutFor(columnTasks[c.id].length, boardH)]));
  const gridCols = BOARD_COLUMNS
    .map((c) => `minmax(0, ${columnTasks[c.id].length ? layouts[c.id].weight : EMPTY_COLUMN_WEIGHT}fr)`)
    .join(' ');

  const applyStatus = async (task, status, note) => {
    if (!canEdit) return;
    if (task.status === 'review' && status === 'done' && !['owner', 'admin'].includes(user?.role)) return showToast('A workspace admin must approve work in review', 'error');
    setOptimistic((prev) => ({
      ...prev,
      [task.id]: { status, ...(note !== undefined ? { note } : {}), doneAt: status === 'done' ? TODAY() : undefined }
    }));
    const ok = await updateTaskStatus(task.project, task.id, status, note);
    if (!ok) setOptimistic((prev) => { const next = { ...prev }; delete next[task.id]; return next; });
  };

  const approveTask = async (task) => {
    try {
      const res = await apiFetch('/api/tasks/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: task.project, taskId: task.id }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await refreshVault();
      showToast('Task approved and completed', 'success');
    } catch (error) { showToast(error.message || 'Could not approve task', 'error'); }
  };

  // Hold/Paused always asks for the reason, so the next reader knows why.
  const requestMove = (tasks, status) => {
    if (!canEdit) return;
    if (status === 'hold') setHoldPrompt({ tasks, note: tasks.length === 1 ? tasks[0].note || '' : '' });
    else tasks.forEach((t) => applyStatus(t, status));
  };

  const saveHold = (e) => {
    e.preventDefault();
    if (!holdPrompt.note.trim()) return;
    holdPrompt.tasks.forEach((t) => applyStatus(t, 'hold', holdPrompt.note.trim()));
    setHoldPrompt(null);
    setSelectedTaskIds([]);
  };

  const confirmDeleteTask = async (e) => {
    e.preventDefault();
    const { task, reason } = deletePrompt || {};
    if (!task || !reason?.trim()) return;
    setTrashBusy(true);
    const ok = await deleteTask(task.project, task.id, reason.trim());
    setTrashBusy(false);
    if (!ok) return showToast('Could not move task to Recently deleted', 'error');
    setSelectedId(null); setDeletePrompt(null);
    await refreshVault();
    showToast('Task moved to Recently deleted for 7 days', 'success');
  };

  const openTrash = async () => {
    setShowTrash(true); setTrashLoading(true);
    const items = await getDeletedTasks();
    setTrashLoading(false);
    if (items === null) showToast('Could not load deleted tasks', 'error');
    else setTrashItems(items);
  };

  const restoreDeletedTask = async (item) => {
    setTrashBusy(true);
    const ok = await restoreTask(item.project, item.id);
    setTrashBusy(false);
    if (!ok) return showToast('Could not restore this task; its 7-day recovery period may have ended', 'error');
    setTrashItems((items) => items.filter((task) => task.id !== item.id));
    await refreshVault();
    showToast('Task restored', 'success');
  };

  const handleToggleSubtask = async (task, text, completed) => {
    if (!canEdit) return;
    setOptimistic((prev) => ({
      ...prev,
      [task.id]: { subtasks: task.subtasks.map((s) => (s.text === text ? { ...s, completed } : s)) }
    }));
    const ok = await toggleSubtask(task.project, task.id, text, completed);
    if (!ok) setOptimistic((prev) => { const next = { ...prev }; delete next[task.id]; return next; });
  };

  const openNew = (status = 'todo') => {
    if (!canEdit) return;
    setNewStatus(status);
    setShowTemplateSave(viewMode !== 'kanban');
    setShowNewModal(true);
  };

  const useTaskTemplate = (template) => {
    setNewProject(projectList.some((project) => project.id === template.project) ? template.project : (selectedProject !== 'all' ? selectedProject : projectList[0]?.id || ''));
    setNewTitle(template.title || ''); setNewPriority(template.priority || 'medium'); setNewStatus(template.status || 'todo');
    setNewNote(template.note || ''); setNewAssignee(template.assignee || ''); setNewDueDate(TODAY()); setNewDescription(template.description || '');
    setNewTags((template.tags || []).join(', ')); setNewSubtasks((template.subtasks || []).join('\n')); setNewRecurrence(template.recurrence || ''); setNewCustomFields(Object.entries(template.customFields || {}).map(([key, value]) => `${key}=${value}`).join('\n')); setNewBlockedBy(''); setShowNewModal(true); setShowTemplateMenu(false);
  };

  const saveTaskTemplate = async () => {
    const name = window.prompt('Name this task template');
    if (!name?.trim()) return;
    const customFields = Object.fromEntries(newCustomFields.split('\n').map((line) => line.split(/=(.*)/s)).filter(([key, value]) => key?.trim() && value?.trim()).map(([key, value]) => [key.trim(), value.trim()]));
    const next = [...taskTemplates, { name: name.trim(), project: newProject, title: newTitle, priority: newPriority, status: newStatus, note: newNote, assignee: newAssignee, description: newDescription, tags: newTags.split(',').map((tag) => tag.trim()).filter(Boolean), subtasks: newSubtasks.split('\n').map((item) => item.trim()).filter(Boolean), recurrence: newRecurrence, customFields }];
    try {
      const res = await fetch('/api/tasks/templates', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-bhodix-token': user?.token || '' }, body: JSON.stringify({ templates: next }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setTaskTemplates(data.templates);
      try { localStorage.setItem('bhodix_task_templates', JSON.stringify(data.templates)); } catch { /* storage unavailable */ }
      showToast('Shared task template saved', 'success');
    } catch (error) { showToast(error.message || 'Could not save template', 'error'); }
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    if (!newTitle.trim() || !newProject) return;
    if (newStatus === 'hold' && !newNote.trim()) return;
    const subtasks = newSubtasks.split('\n').map((s) => s.trim()).filter(Boolean).map((text) => ({ text, completed: false }));
    const customFields = Object.fromEntries(newCustomFields.split('\n').map((line) => line.split(/=(.*)/s)).filter(([key, value]) => key?.trim() && value?.trim()).map(([key, value]) => [key.trim(), value.trim()]));
    const ok = await createTask(newProject, {
      title: newTitle, priority: newPriority, status: newStatus, note: newStatus === 'hold' ? newNote : '',
      assignee: newAssignee, dueDate: newDueDate, startAt: newStartAt ? new Date(newStartAt).toISOString() : '', reminderAt: newReminderAt ? new Date(newReminderAt).toISOString() : '', description: newDescription,
      tags: newTags.split(',').map((tag) => tag.trim()).filter(Boolean), subtasks, blockedBy: newBlockedBy.trim(), recurrence: newRecurrence, customFields,
      aiProvider: newAiProvider, aiInstructions: newAiInstructions
    });
    if (ok) {
      setShowNewModal(false);
      setNewTitle(''); setNewDescription(''); setNewSubtasks(''); setNewNote(''); setNewTags(''); setNewBlockedBy(''); setNewRecurrence(''); setNewCustomFields(''); setNewStartAt(''); setNewReminderAt(''); setNewAiProvider(''); setNewAiInstructions('');
    }
  };

  const retryAiRun = async (task) => {
    try {
      const res = await apiFetch(`/api/tasks/${encodeURIComponent(task.project)}/${encodeURIComponent(task.id)}/ai/retry`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      await refreshVault();
      showToast('AI report queued to run now', 'success');
    } catch (error) { showToast(error.message || 'Could not retry AI report', 'error'); }
  };

  const onDragEnd = ({ active, over }) => {
    if (!over) return;
    const task = allTasks.find((t) => t.id === active.id);
    const overTask = allTasks.find((t) => t.id === over.id);
    const target = COLUMN_IDS.includes(over.id) ? over.id : overTask && colOf(overTask);
    if (task && target && colOf(task) !== target) requestMove([task], target);
  };

  const showArchive = () => { setFilters({ ...EMPTY_FILTERS, status: 'done' }); setViewMode('list'); };

  // ----- sheet filters -----
  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const saveCurrentTaskView = () => {
    const name = window.prompt('Name this task view');
    if (!name?.trim()) return;
    const next = [...savedTaskViews.filter((view) => view.name.toLowerCase() !== name.trim().toLowerCase()), { name: name.trim(), filters, mode: viewMode }];
    setSavedTaskViews(next);
    try { localStorage.setItem(savedViewsKey, JSON.stringify(next)); } catch { showToast('Could not save this view on this device', 'error'); }
  };
  const removeSavedTaskView = (name) => {
    const next = savedTaskViews.filter((view) => view.name !== name);
    setSavedTaskViews(next);
    try { localStorage.setItem(savedViewsKey, JSON.stringify(next)); } catch { showToast('Could not update saved views', 'error'); }
  };
  const uniq = (key) => [...new Set(allTasks.map((t) => t[key]).filter(Boolean))].sort();
  const today = TODAY();
  const taskTags = [...new Set(allTasks.flatMap((t) => Array.isArray(t.tags) ? t.tags : []).filter(Boolean))].sort();
  const shownTasks = allTasks.filter((t) =>
    (!filters.project || t.project === filters.project) &&
    (!filters.status || colOf(t) === filters.status) &&
    (!filters.priority || t.priority === filters.priority) &&
    (!filters.assignee || t.assignee === filters.assignee) &&
    (!filters.tag || (Array.isArray(t.tags) && t.tags.includes(filters.tag))) &&
    (!filters.due || (filters.due === 'overdue' && t.dueDate && t.dueDate < today && t.status !== 'done') || (filters.due === 'today' && t.dueDate === today) || (filters.due === 'week' && t.dueDate >= today && t.dueDate <= new Date(Date.now() + 7 * DAY_MS).toISOString().slice(0, 10))) &&
    (!filters.title || `${t.id} ${t.title}`.toLowerCase().includes(filters.title.toLowerCase()))
  );
  const compareTasks = (a, b) => {
    let result = 0;
    if (sortBy === 'priority') result = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
    else if (sortBy === 'status') result = COLUMN_IDS.indexOf(colOf(a)) - COLUMN_IDS.indexOf(colOf(b));
    else if (sortBy === 'title' || sortBy === 'project' || sortBy === 'assignee') result = String(a[sortBy] || '').localeCompare(String(b[sortBy] || ''));
    else if (sortBy === 'startAt') result = String(a.startAt || '9999').localeCompare(String(b.startAt || '9999'));
    else result = String(a.dueDate || '9999-99-99').localeCompare(String(b.dueDate || '9999-99-99'));
    return (sortDirection === 'asc' ? result : -result) || a.id.localeCompare(b.id);
  };
  const sheetTasks = [...shownTasks].sort(compareTasks);
  const myDayTasks = [...shownTasks].filter((t) => t.status !== 'done' && t.dueDate && t.dueDate <= today).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || byPriority(a, b));
  const visibleSheetTasks = viewMode === 'today' ? myDayTasks : sheetTasks;
  const filtersActive = Object.values(filters).some(Boolean);
  const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  const monthDays = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  const calendarCells = Array.from({ length: Math.ceil((monthStart.getDay() + monthDays) / 7) * 7 }, (_, i) => {
    const day = i - monthStart.getDay() + 1;
    const date = day > 0 && day <= monthDays ? `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
    return { day, date, tasks: date ? allTasks.filter((task) => task.dueDate === date && task.status !== 'done') : [] };
  });
  const workload = Object.entries(allTasks.filter((task) => task.status !== 'done').reduce((counts, task) => {
    const owner = task.assignee?.trim() || 'Unassigned';
    counts[owner] = (counts[owner] || 0) + 1;
    return counts;
  }, {})).sort((a, b) => b[1] - a[1]);
  const download = (name, type, content) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportTasksCsv = () => {
    const csvCell = (value) => {
      const safe = String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/^([=+@\-])/,'\'$1');
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const columns = ['id', 'title', 'project', 'status', 'priority', 'assignee', 'startAt', 'dueDate'];
    download('bhodhix-tasks.csv', 'text/csv;charset=utf-8', [columns, ...visibleSheetTasks.map((task) => columns.map((key) => task[key] || ''))].map((row) => row.map(csvCell).join(',')).join('\r\n'));
  };
  const exportTasksCalendar = () => {
    const tasks = visibleSheetTasks.filter((task) => task.startAt || (task.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)));
    if (!tasks.length) return showToast('No dated tasks to export from this view', 'info');
    const escapeIcs = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const events = tasks.map((task) => {
      const startTime = task.startAt ? new Date(task.startAt) : null;
      const start = startTime ? startTime.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '') : task.dueDate.replace(/-/g, '');
      const endDate = startTime ? new Date(startTime.getTime() + 60 * 60 * 1000) : new Date(`${task.dueDate}T00:00:00`);
      if (!startTime) endDate.setDate(endDate.getDate() + 1);
      const end = startTime ? endDate.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '') : `${endDate.getFullYear()}${String(endDate.getMonth() + 1).padStart(2, '0')}${String(endDate.getDate()).padStart(2, '0')}`;
      return `BEGIN:VEVENT\nUID:${escapeIcs(task.id)}@bhodhix\nDTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}\n${startTime ? `DTSTART:${start}\nDTEND:${end}` : `DTSTART;VALUE=DATE:${start}\nDTEND;VALUE=DATE:${end}`}\nSUMMARY:${escapeIcs(task.title)}\nDESCRIPTION:${escapeIcs(`${task.project} · ${task.status} · ${task.assignee || 'Unassigned'}`)}\nEND:VEVENT`;
    });
    download('bhodhix-tasks.ics', 'text/calendar;charset=utf-8', `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Bhodhix//Planner//EN\n${events.join('\n')}\nEND:VCALENDAR\n`);
  };

  const tab = (mode, Icon, label) => (
    <button
      onClick={() => setViewMode(mode)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${viewMode === mode ? 'bg-indigo-600 text-white font-medium shadow-sm' : 'text-bhodix-textMuted hover:text-bhodix-text'}`}
    >
      <Icon className="w-3.5 h-3.5" /><span>{label}</span>
    </button>
  );

  return (
    <div className="h-full flex flex-col gap-4 p-5 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-bhodix-border pb-3 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-bhodix-text tracking-tight flex items-center gap-2">
            Sprint & Feature Planner
            <span className="text-xs font-mono font-normal text-bhodix-textSubtle">({allTasks.length} tasks)</span>
          </h1>
          <p className="text-xs text-bhodix-textMuted mt-0.5">
            Synchronized with <code className="text-indigo-500 font-mono">vault/projects/*/tasks.md</code>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {archivedCount > 0 && viewMode === 'kanban' && (
            <button onClick={showArchive} className="flex items-center gap-1 text-[11px] font-mono text-bhodix-textSubtle hover:text-indigo-500">
              Done archive ({archivedCount}) <ArrowRight className="w-3 h-3" />
            </button>
          )}
          <div className="flex items-center bg-bhodix-card border border-bhodix-border rounded-xl p-0.5 text-xs">
            {tab('kanban', Kanban, 'Board')}
            {tab('list', List, 'Sheet')}
            {tab('today', CalendarDays, `My Day (${myDayTasks.length})`)}
          </div>
          {viewMode !== 'kanban' && <div className="flex items-center gap-2">{tab('calendar', CalendarDays, 'Calendar')}{tab('timeline', ArrowRight, 'Timeline')}{tab('workload', Users, 'Workload')}</div>}
          {viewMode !== 'kanban' && <div className="flex items-center gap-1"><button onClick={exportTasksCsv} className="rounded-lg border border-bhodix-border px-2 py-1.5 text-[10px] text-bhodix-textMuted hover:text-indigo-500">Export CSV</button><button onClick={exportTasksCalendar} className="rounded-lg border border-bhodix-border px-2 py-1.5 text-[10px] text-bhodix-textMuted hover:text-indigo-500">Export calendar</button></div>}
          {canEdit && <button onClick={openTrash} className="inline-flex items-center gap-1.5 rounded-lg border border-bhodix-border px-2.5 py-1.5 text-[10px] text-bhodix-textMuted hover:text-indigo-500"><Trash2 className="h-3.5 w-3.5" />Recently deleted</button>}
          {viewMode !== 'kanban' && taskTemplates.length > 0 && <div className="relative"><button onClick={() => setShowTemplateMenu((open) => !open)} className="rounded-xl border border-bhodix-border bg-bhodix-card px-3 py-2 text-xs text-bhodix-textMuted hover:bg-bhodix-hover">Templates</button>{showTemplateMenu && <div className="absolute right-0 top-full z-20 mt-1 min-w-44 rounded-xl border border-bhodix-border bg-bhodix-surface p-1 shadow-xl">{taskTemplates.map((template, index) => <button key={`${template.name}-${index}`} onClick={() => useTaskTemplate(template)} className="block w-full rounded-lg px-3 py-2 text-left text-xs text-bhodix-text hover:bg-bhodix-hover">{template.name}</button>)}</div>}</div>}
          {viewMode !== 'kanban' && <div className="relative"><div className="flex overflow-hidden rounded-lg border border-bhodix-border"><button onClick={saveCurrentTaskView} className="bg-bhodix-card px-2 py-1.5 text-[10px] text-bhodix-textMuted hover:text-indigo-500">Save view</button><button aria-label="Open saved task views" aria-expanded={showSavedViews} onClick={() => setShowSavedViews((open) => !open)} className="border-l border-bhodix-border bg-bhodix-card px-2 py-1.5 text-[10px] text-bhodix-textMuted hover:text-indigo-500">Saved ({savedTaskViews.length})</button></div>{showSavedViews && <div className="absolute right-0 top-full z-20 mt-1 min-w-48 rounded-xl border border-bhodix-border bg-bhodix-surface p-1 shadow-xl">{savedTaskViews.map((view) => <div key={view.name} className="flex items-center"><button onClick={() => { setFilters(view.filters); setViewMode(view.mode); setShowSavedViews(false); }} className="min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-xs text-bhodix-text hover:bg-bhodix-hover">{view.name}</button><button aria-label={`Delete saved view ${view.name}`} onClick={() => removeSavedTaskView(view.name)} className="rounded px-2 py-1 text-xs text-bhodix-textSubtle hover:text-rose-500">×</button></div>)}{!savedTaskViews.length && <p className="px-3 py-2 text-[10px] text-bhodix-textSubtle">Save your current filters to reuse them.</p>}</div>}</div>}
          {viewMode !== 'kanban' && <button onClick={() => openNew('todo')} className="rounded-xl border border-indigo-500/20 px-3 py-2 text-xs text-indigo-500">New task</button>}
          {viewMode === 'kanban' && <button onClick={() => openNew('todo')} className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-sm">
            <Plus className="w-4 h-4" /><span>New Task</span>
          </button>}
        </div>
      </div>

      {viewMode === 'kanban' && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <div ref={boardRef} className="flex-1 min-h-0 overflow-x-auto">
            <div className="h-full grid gap-3 min-w-[960px]" style={{ gridTemplateColumns: gridCols }}>
              {BOARD_COLUMNS.map((col) => (
                <Column
                  key={col.id}
                  col={col}
                  tasks={columnTasks[col.id]}
                  layout={layouts[col.id]}
                  onOpen={(t) => setSelectedId(t.id)}
                  onAdd={openNew}
                  footer={col.id === 'done' && archivedCount > 0 && (
                    <button onClick={showArchive} className="px-3 py-2 border-t border-bhodix-borderSubtle text-[10px] font-mono text-bhodix-textSubtle hover:text-indigo-500 text-left">
                      {archivedCount} older than {DONE_VISIBLE_DAYS} days in list →
                    </button>
                  )}
                />
              ))}
            </div>
          </div>
        </DndContext>
      )}

      {(viewMode === 'list' || viewMode === 'today') && (
        <div className="relative flex-1 min-h-0 overflow-auto bg-bhodix-card border border-bhodix-border rounded-2xl p-4 shadow-sm">
          {viewMode === 'today' && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-3 py-2">
              <div><div className="text-xs font-semibold text-bhodix-text">Due today or overdue</div><div className="text-[10px] text-bhodix-textSubtle">Open tasks with a due date through today. Use the filters below to narrow the list.</div></div>
              <span className="font-mono text-xs text-indigo-500">{myDayTasks.filter((t) => t.dueDate < today).length} overdue · {myDayTasks.filter((t) => t.dueDate === today).length} due today</span>
            </div>
          )}
          {selectedTaskIds.length > 0 && (
            <div className="sticky top-0 z-10 float-right flex items-center gap-2 p-2 rounded-xl bg-indigo-600 text-white shadow-xl">
              <span className="text-xs font-medium px-2">{selectedTaskIds.length} selected</span>
              <div className="flex items-center gap-1 border-l border-indigo-400 pl-2">
                {COLUMN_IDS.map((st) => (
                  <button
                    key={st}
                    onClick={() => {
                      requestMove(allTasks.filter((t) => selectedTaskIds.includes(t.id)), st);
                      if (st !== 'hold') setSelectedTaskIds([]);
                    }}
                    className="px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-800 text-[10px] font-mono uppercase"
                  >
                    {st.split('_')[0]}
                  </button>
                ))}
                <button onClick={() => setSelectedTaskIds([])} className="p-1 hover:bg-indigo-800 rounded"><X className="w-3 h-3" /></button>
              </div>
            </div>
          )}
          <table className="w-full min-w-[1100px] text-left text-xs">
            <thead className="text-bhodix-textSubtle uppercase tracking-wider font-mono text-[11px]">
              <tr>
                <th className="pb-1 w-10 align-top">
                  <input
                    type="checkbox"
                    aria-label="Select all visible tasks"
                    className="rounded border-bhodix-border bg-bhodix-surface"
                    checked={visibleSheetTasks.length > 0 && visibleSheetTasks.every((t) => selectedTaskIds.includes(t.id))}
                    onChange={(e) => setSelectedTaskIds(e.target.checked ? visibleSheetTasks.map((t) => t.id) : [])}
                  />
                </th>
                {[
                  ['title', 'Task / Title'], ['project', 'Project'], ['status', 'Status'], ['priority', 'Priority'], ['assignee', 'Assignee'], ['startAt', 'Starts'], ['dueDate', 'Due']
                ].map(([key, label]) => <th key={key} className="pb-1 align-top"><button onClick={() => { setSortDirection(sortBy === key && sortDirection === 'asc' ? 'desc' : 'asc'); setSortBy(key); }} aria-label={`Sort by ${label}`} className="hover:text-indigo-500">{label}{sortBy === key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>)}
                <th className="pb-1 align-top">Tags</th>
                <th className="pb-1 align-top">Note</th>
                <th className="pb-1 align-top">Sub</th>
              </tr>
              <tr className="border-b border-bhodix-border">
                <th className="pb-2">
                  {filtersActive && <button onClick={() => setFilters(EMPTY_FILTERS)} title="Clear filters" aria-label="Clear filters" className="text-rose-500"><X className="w-3.5 h-3.5" /></button>}
                </th>
                <th className="pb-2 pr-2">
                  <input value={filters.title} onChange={(e) => setFilter('title', e.target.value)} placeholder="Search id / title" className={SELECT_CLS} />
                </th>
                <th className="pb-2 pr-2">
                  <select value={filters.project} onChange={(e) => setFilter('project', e.target.value)} className={SELECT_CLS}>
                    <option value="">All</option>
                    {projectList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </th>
                <th className="pb-2 pr-2">
                  <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={SELECT_CLS}>
                    <option value="">All</option>
                    {COLUMN_IDS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </th>
                <th className="pb-2 pr-2">
                  <select value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)} className={SELECT_CLS}>
                    <option value="">All</option>
                    {Object.keys(PRIORITY_ORDER).map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </th>
                <th className="pb-2 pr-2">
                  <select value={filters.assignee} onChange={(e) => setFilter('assignee', e.target.value)} className={SELECT_CLS}>
                    <option value="">All</option>
                    {uniq('assignee').map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </th>
                <th className="pb-2 pr-2"><select value={filters.due} onChange={(e) => setFilter('due', e.target.value)} className={SELECT_CLS}><option value="">Any due date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Next 7 days</option></select></th>
                <th className="pb-2 pr-2"><select value={filters.tag} onChange={(e) => setFilter('tag', e.target.value)} className={SELECT_CLS}><option value="">All tags</option>{taskTags.map((tag) => <option key={tag}>{tag}</option>)}</select></th>
                <th /><th />
              </tr>
            </thead>
            <tbody className="divide-y divide-bhodix-borderSubtle">
              {visibleSheetTasks.length === 0 && (
                <tr><td colSpan={10} className="py-8 text-center text-bhodix-textSubtle font-mono">{viewMode === 'today' ? 'No open tasks are due today or overdue.' : 'No tasks match.'}</td></tr>
              )}
              {visibleSheetTasks.map((task) => {
                const totalSub = task.subtasks?.length || 0;
                const doneSub = task.subtasks?.filter((s) => s.completed).length || 0;
                const style = getPriorityStyle(task.priority);
                const isSelected = selectedTaskIds.includes(task.id);
                return (
                  <tr
                    key={task.id}
                    className={`hover:bg-bhodix-surface/50 cursor-pointer ${isSelected ? 'bg-indigo-500/5' : ''}`}
                    onClick={(e) => { if (e.target.type !== 'checkbox') setSelectedId(task.id); }}
                  >
                    <td className="py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${task.id}`}
                        className="rounded border-bhodix-border bg-bhodix-surface"
                        checked={isSelected}
                        onChange={() => setSelectedTaskIds((prev) => (prev.includes(task.id) ? prev.filter((id) => id !== task.id) : [...prev, task.id]))}
                      />
                    </td>
                    <td className="py-2.5 pr-2 max-w-sm">
                      <span className="font-mono text-indigo-500 dark:text-indigo-400 font-semibold mr-2">{task.id}</span>
                      <span className="font-medium text-bhodix-text">{task.title}</span>
                    </td>
                    <td className="py-2.5"><span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bhodix-surface text-indigo-500 dark:text-indigo-300 uppercase">{task.project}</span></td>
                    <td className="py-2.5"><span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bhodix-surface text-bhodix-text">{STATUS_LABELS[colOf(task)]}</span></td>
                    <td className="py-2.5"><span className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase ${style.badge}`}>{task.priority}</span></td>
                    <td className="py-2.5 text-bhodix-textMuted font-mono text-[11px]">{task.assignee}</td>
                    <td className="py-2.5 font-mono text-[11px]">{task.dueDate ? <span className={task.status !== 'done' && task.dueDate < today ? 'text-rose-500 font-semibold' : task.dueDate === today ? 'text-amber-500 font-semibold' : 'text-bhodix-textSubtle'}>{task.status !== 'done' && task.dueDate < today ? `Overdue · ${task.dueDate}` : task.dueDate === today ? 'Today' : task.dueDate}</span> : '—'}</td>
                    <td className="py-2.5"><div className="flex flex-wrap gap-1">{(task.tags || []).map((tag) => <span key={tag} className="rounded bg-bhodix-surface px-1.5 py-0.5 text-[9px] text-bhodix-textSubtle">{tag}</span>)}</div></td>
                    <td className="py-2.5 pr-2 text-[11px] max-w-xs truncate text-bhodix-textMuted" title={task.note}>
                      {task.note || (task.status === 'hold' ? <span className="text-rose-500">missing</span> : '')}
                    </td>
                    <td className="py-2.5 font-mono text-[11px] text-bhodix-textSubtle">{totalSub > 0 ? `${doneSub}/${totalSub}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewMode === 'calendar' && (
        <div className="flex-1 min-h-0 overflow-auto rounded-2xl border border-bhodix-border bg-bhodix-card p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-bhodix-text">Task calendar</h2>
              <p className="text-[11px] text-bhodix-textSubtle">Open tasks with due dates · Drag and drop tasks to reschedule</p>
            </div>
            <div className="flex items-center gap-2">
              <button aria-label="Previous month" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} className="rounded-lg border border-bhodix-border p-1.5 text-bhodix-textMuted hover:bg-bhodix-hover">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-32 text-center text-xs font-semibold text-bhodix-text">
                {calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </span>
              <button aria-label="Next month" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} className="rounded-lg border border-bhodix-border p-1.5 text-bhodix-textMuted hover:bg-bhodix-hover">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 border-l border-t border-bhodix-border text-xs">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="border-b border-r border-bhodix-border p-2 text-center font-mono text-[10px] uppercase text-bhodix-textSubtle">
                {day}
              </div>
            ))}
            {calendarCells.map((cell, i) => (
              <div
                key={i}
                onDragOver={(e) => {
                  if (cell.date) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }
                }}
                onDragEnter={() => {
                  if (cell.date) setDragOverDate(cell.date);
                }}
                onDragLeave={() => {
                  if (dragOverDate === cell.date) setDragOverDate(null);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  setDragOverDate(null);
                  if (!cell.date) return;
                  try {
                    const raw = e.dataTransfer.getData('text/plain');
                    if (!raw) return;
                    const { taskId, project } = JSON.parse(raw);
                    if (taskId && project) {
                      await handleRescheduleTask(project, taskId, cell.date);
                    }
                  } catch (err) {
                    console.error('Failed to reschedule task:', err);
                  }
                }}
                className={`min-h-24 border-b border-r border-bhodix-border p-1.5 transition-colors ${
                  dragOverDate === cell.date
                    ? 'bg-indigo-500/20 border-indigo-500 border-2 border-dashed'
                    : cell.date
                    ? 'hover:bg-bhodix-hover/40'
                    : 'bg-bhodix-surface/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-mono ${cell.date === today ? 'font-bold px-1.5 py-0.5 rounded-full bg-indigo-600 text-white' : 'text-bhodix-textSubtle'}`}>
                    {cell.date ? cell.day : ''}
                  </span>
                  {cell.tasks.length > 0 && (
                    <span className="text-[9px] text-bhodix-textSubtle font-mono">
                      {cell.tasks.length}
                    </span>
                  )}
                </div>
                <div className="mt-1 space-y-1">
                  {cell.tasks.slice(0, 4).map((task) => (
                    <div
                      key={task.id}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', JSON.stringify({ taskId: task.id, project: task.project }));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onClick={() => setSelectedId(task.id)}
                      title={`${task.id} · ${task.title} (drag to another date to reschedule)`}
                      className="block w-full truncate rounded bg-indigo-500/10 px-1.5 py-1 text-left text-[9px] text-indigo-500 hover:bg-indigo-500/20 cursor-grab active:cursor-grabbing border border-indigo-500/20 transition-all select-none hover:border-indigo-500/40"
                    >
                      <span className="font-mono font-medium mr-1">{task.id}</span>
                      {task.title}
                    </div>
                  ))}
                  {cell.tasks.length > 4 && (
                    <span className="text-[9px] text-bhodix-textSubtle font-mono">
                      +{cell.tasks.length - 4} more
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {viewMode === 'timeline' && (
        <div className="flex-1 min-h-0 overflow-auto rounded-2xl border border-bhodix-border bg-bhodix-card p-5 shadow-sm"><div className="mb-4"><h2 className="text-sm font-bold text-bhodix-text">Upcoming work</h2><p className="text-[11px] text-bhodix-textSubtle">Scheduled start appears before the due date; tasks without dates appear at the end.</p></div><div className="space-y-3">{[...allTasks].filter((task) => task.status !== 'done').sort((a, b) => String(a.startAt || a.dueDate || '9999').localeCompare(String(b.startAt || b.dueDate || '9999'))).map((task) => <button key={task.id} onClick={() => setSelectedId(task.id)} className="flex w-full items-start gap-3 rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-3 text-left hover:border-indigo-500/40"><span className="w-32 shrink-0 font-mono text-[10px] text-indigo-500">{task.startAt ? `Starts ${new Date(task.startAt).toLocaleString()}` : task.dueDate || 'No date'}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-bhodix-text">{task.title}</span><span className="mt-1 block text-[10px] text-bhodix-textSubtle">{task.project} · {STATUS_LABELS[colOf(task)]} · {task.assignee || 'Unassigned'}</span></span><span className="rounded bg-bhodix-card px-2 py-1 text-[9px] uppercase text-bhodix-textMuted">{task.priority}</span></button>)}{allTasks.filter((task) => task.status !== 'done').length === 0 && <p className="py-8 text-center text-xs text-bhodix-textSubtle">No open tasks.</p>}</div></div>
      )}

      {viewMode === 'workload' && (
        <div className="flex-1 min-h-0 overflow-auto rounded-2xl border border-bhodix-border bg-bhodix-card p-5 shadow-sm"><div className="mb-4"><h2 className="text-sm font-bold text-bhodix-text">Open work by assignee</h2><p className="text-[11px] text-bhodix-textSubtle">A simple count of unfinished tasks; it does not estimate effort.</p></div><div className="space-y-3">{workload.map(([owner, count]) => <div key={owner} className="grid grid-cols-[9rem_1fr_2rem] items-center gap-3"><span className="truncate text-xs text-bhodix-text">{owner}</span><div className="h-2 rounded-full bg-bhodix-surface"><div className="h-2 rounded-full bg-indigo-500" style={{ width: `${Math.max(5, count / Math.max(...workload.map((item) => item[1])) * 100)}%` }} /></div><span className="text-right font-mono text-xs text-bhodix-textSubtle">{count}</span></div>)}{workload.length === 0 && <p className="py-8 text-center text-xs text-bhodix-textSubtle">No open work.</p>}</div></div>
      )}

      {selected && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in-0 duration-150"
          onClick={() => setSelectedId(null)}
        >
          <div
            ref={taskDetailRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-detail-title"
            onClick={(e) => e.stopPropagation()}
            className="bg-bhodix-card border border-bhodix-border rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-5 shadow-2xl animate-in zoom-in-95 duration-150"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-bhodix-border pb-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-indigo-500 dark:text-indigo-400 font-semibold">{selected.id}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-500 dark:text-indigo-300 uppercase font-bold border border-indigo-500/20">{selected.project}</span>
                </div>
                <h2 id="task-detail-title" className="text-lg font-bold text-bhodix-text mt-1.5 leading-snug">{selected.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="p-1.5 rounded-lg text-bhodix-textSubtle hover:text-bhodix-text hover:bg-bhodix-hover transition-colors"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Priority Selector (Item 2) */}
            <div className="p-3 rounded-xl bg-bhodix-surface border border-bhodix-borderSubtle space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-bhodix-textSubtle font-mono uppercase text-[10px] flex items-center gap-1.5">
                  <Flag className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Task Priority</span>
                </span>
                <span className="text-[10px] font-mono text-bhodix-textSubtle">Click to switch</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'urgent', label: 'Urgent', dot: 'bg-rose-500', active: 'bg-rose-500/15 border-rose-500/40 text-rose-500 font-semibold shadow-sm' },
                  { id: 'high', label: 'High', dot: 'bg-amber-500', active: 'bg-amber-500/15 border-amber-500/40 text-amber-500 font-semibold shadow-sm' },
                  { id: 'medium', label: 'Medium', dot: 'bg-indigo-500', active: 'bg-indigo-500/15 border-indigo-500/40 text-indigo-500 font-semibold shadow-sm' },
                  { id: 'low', label: 'Low', dot: 'bg-emerald-500', active: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-500 font-semibold shadow-sm' }
                ].map((p) => {
                  const isCurrent = (selected.priority || 'medium') === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => handleUpdatePriority(selected, p.id)}
                      className={`py-1.5 px-2 rounded-lg border text-xs flex items-center justify-center gap-1.5 transition-all ${
                        isCurrent
                          ? p.active
                          : 'border-bhodix-border bg-bhodix-card/60 text-bhodix-textMuted hover:bg-bhodix-hover hover:text-bhodix-text'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${p.dot}`} />
                      <span>{p.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Status Switcher (Move to) */}
            <div className="p-3 rounded-xl bg-bhodix-surface border border-bhodix-borderSubtle space-y-2">
              <span className="text-bhodix-textSubtle font-mono uppercase text-[10px] block">Workflow Status</span>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {BOARD_COLUMNS.filter((c) => !(colOf(selected) === 'review' && c.id === 'done')).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => requestMove([selected], c.id)}
                    className={`px-3 py-1.5 rounded-lg font-mono text-[11px] transition-all ${
                      colOf(selected) === c.id
                        ? 'bg-indigo-600 text-white font-medium shadow-sm'
                        : 'bg-bhodix-card/60 border border-bhodix-border text-bhodix-textMuted hover:bg-bhodix-hover hover:text-bhodix-text'
                    }`}
                  >
                    {c.title}
                  </button>
                ))}
                {colOf(selected) === 'review' && ['owner', 'admin'].includes(user?.role) && (
                  <button
                    type="button"
                    onClick={() => approveTask(selected)}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 shadow-sm transition-colors"
                  >
                    Approve & complete
                  </button>
                )}
              </div>
            </div>

            {/* Metadata 4-Card Grid (Item 1 Layout Fix) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-xl bg-bhodix-surface border border-bhodix-borderSubtle">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-bhodix-textSubtle">
                  <User className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Assignee</span>
                </div>
                <div className="mt-1 text-xs font-semibold text-bhodix-text truncate" title={selected.assignee || 'Unassigned'}>
                  {selected.assignee || 'Unassigned'}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-bhodix-surface border border-bhodix-borderSubtle">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-bhodix-textSubtle">
                  <Flag className="w-3.5 h-3.5 text-amber-400" />
                  <span>Priority</span>
                </div>
                <div className="mt-1 text-xs font-semibold capitalize text-bhodix-text flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${selected.priority === 'urgent' ? 'bg-rose-500' : selected.priority === 'high' ? 'bg-amber-500' : selected.priority === 'low' ? 'bg-emerald-500' : 'bg-indigo-500'}`} />
                  <span>{selected.priority || 'medium'}</span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-bhodix-surface border border-bhodix-borderSubtle">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-bhodix-textSubtle">
                  <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Due Date</span>
                </div>
                <div className="mt-1 text-xs font-semibold text-bhodix-text truncate">
                  {selected.dueDate || 'No due date'}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-bhodix-surface border border-bhodix-borderSubtle">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-bhodix-textSubtle">
                  <Clock3 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Scheduled</span>
                </div>
                <div className="mt-1 text-xs font-semibold text-bhodix-text truncate">
                  {selected.startAt ? new Date(selected.startAt).toLocaleDateString() : 'Not scheduled'}
                </div>
              </div>
            </div>

            {colOf(selected) === 'hold' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs font-mono uppercase text-bhodix-textSubtle">
                  <span>Why it is on hold</span>
                  <button onClick={() => requestMove([selected], 'hold')} className="normal-case text-indigo-500 font-medium hover:underline">edit note</button>
                </div>
                <p className={`text-xs leading-relaxed p-3.5 rounded-xl border ${selected.note ? 'bg-amber-500/5 border-amber-500/20 text-bhodix-text' : 'bg-rose-500/5 border-rose-500/20 text-rose-500'}`}>
                  {selected.note || 'No note yet. Whoever paused this must say why.'}
                </p>
              </div>
            )}

            {selected.description && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-mono uppercase text-bhodix-textSubtle">Description</div>
                <p className="text-xs text-bhodix-text leading-relaxed bg-bhodix-surface p-3.5 rounded-xl border border-bhodix-borderSubtle whitespace-pre-wrap">{selected.description}</p>
              </div>
            )}

            {(selected.blocked_by || selected.recurrence || Object.keys(selected.custom_fields || {}).length > 0) && (
              <div className="space-y-1 rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-3 text-xs text-bhodix-textMuted">
                {selected.blocked_by && <div>Blocked by task: <span className="font-mono text-indigo-500">{selected.blocked_by}</span></div>}
                {selected.recurrence && <div>Repeats {selected.recurrence}</div>}
                {Object.entries(selected.custom_fields || {}).map(([key, value]) => <div key={key}>{key}: {value}</div>)}
              </div>
            )}

            {/* Subtasks */}
            {selected.subtasks?.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] font-mono uppercase text-bhodix-textSubtle">
                  <span>Subtasks</span>
                  <span>{selected.subtasks.filter((s) => s.completed).length} of {selected.subtasks.length} done</span>
                </div>
                <div className="space-y-1.5">
                  {selected.subtasks.map((st, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleToggleSubtask(selected, st.text, !st.completed)}
                      className="flex items-center gap-2.5 p-2.5 rounded-lg bg-bhodix-surface/60 hover:bg-bhodix-surface border border-bhodix-borderSubtle cursor-pointer text-xs transition-colors"
                    >
                      {st.completed ? <CheckSquare className="w-4 h-4 text-emerald-500 shrink-0" /> : <Square className="w-4 h-4 text-bhodix-textSubtle shrink-0" />}
                      <span className={st.completed ? 'line-through text-bhodix-textSubtle' : 'text-bhodix-text'}>{st.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Discussion & Activity Section */}
            <section className="space-y-3 border-t border-bhodix-border pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-mono uppercase text-bhodix-textSubtle">
                  <MessageSquare className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Discussion & Activity</span>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setActiveTool((curr) => curr === 'time' ? null : 'time')}
                      className={`px-2 py-1 rounded-md border text-[10px] transition-colors flex items-center gap-1 ${activeTool === 'time' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-bhodix-surface border-bhodix-border text-bhodix-textMuted hover:text-bhodix-text'}`}
                    >
                      <Clock3 className="w-3 h-3" />
                      <span>Log Time</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTool((curr) => curr === 'link' ? null : 'link')}
                      className={`px-2 py-1 rounded-md border text-[10px] transition-colors flex items-center gap-1 ${activeTool === 'link' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-bhodix-surface border-bhodix-border text-bhodix-textMuted hover:text-bhodix-text'}`}
                    >
                      <Link2 className="w-3 h-3" />
                      <span>Add Link</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTool((curr) => curr === 'reminder' ? null : 'reminder')}
                      className={`px-2 py-1 rounded-md border text-[10px] transition-colors flex items-center gap-1 ${activeTool === 'reminder' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-bhodix-surface border-bhodix-border text-bhodix-textMuted hover:text-bhodix-text'}`}
                    >
                      <Bell className="w-3 h-3" />
                      <span>Reminder</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Active Tool Sub-forms */}
              {activeTool === 'time' && canEdit && (
                <form onSubmit={async (e) => { e.preventDefault(); if (await addTaskActivity('time', timeDraft.note.trim(), timeDraft.minutes)) { setTimeDraft({ minutes: '', note: '' }); setActiveTool(null); } }} className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 animate-in fade-in-0 duration-100">
                  <span className="text-xs font-semibold text-indigo-400">Log time:</span>
                  <input aria-label="Minutes worked" required type="number" min="1" max="1440" value={timeDraft.minutes} onChange={(e) => setTimeDraft((draft) => ({ ...draft, minutes: e.target.value }))} placeholder="Minutes" className="w-24 rounded-lg border border-bhodix-border bg-bhodix-surface px-2.5 py-1.5 text-xs text-bhodix-text focus:outline-none focus:border-indigo-500" />
                  <input aria-label="Time log note" value={timeDraft.note} onChange={(e) => setTimeDraft((draft) => ({ ...draft, note: e.target.value }))} placeholder="What did you work on?" className="min-w-0 flex-1 rounded-lg border border-bhodix-border bg-bhodix-surface px-2.5 py-1.5 text-xs text-bhodix-text focus:outline-none focus:border-indigo-500" />
                  <button type="submit" className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium">Log Time</button>
                </form>
              )}

              {activeTool === 'link' && canEdit && (
                <form onSubmit={async (e) => { e.preventDefault(); if (await addTaskActivity('link', linkDraft.label.trim(), linkDraft.url.trim())) { setLinkDraft({ label: '', url: '' }); setActiveTool(null); } }} className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 animate-in fade-in-0 duration-100">
                  <span className="text-xs font-semibold text-indigo-400">Attach link:</span>
                  <input aria-label="Link label" required value={linkDraft.label} onChange={(e) => setLinkDraft((draft) => ({ ...draft, label: e.target.value }))} placeholder="Label (e.g. PR, design)" className="w-36 rounded-lg border border-bhodix-border bg-bhodix-surface px-2.5 py-1.5 text-xs text-bhodix-text focus:outline-none focus:border-indigo-500" />
                  <input aria-label="Web link" required type="url" value={linkDraft.url} onChange={(e) => setLinkDraft((draft) => ({ ...draft, url: e.target.value }))} placeholder="https://…" className="min-w-0 flex-1 rounded-lg border border-bhodix-border bg-bhodix-surface px-2.5 py-1.5 text-xs text-bhodix-text focus:outline-none focus:border-indigo-500" />
                  <button type="submit" className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium">Attach Link</button>
                </form>
              )}

              {activeTool === 'reminder' && canEdit && (
                <form onSubmit={async (e) => { await saveTaskReminder(e); setActiveTool(null); }} className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 animate-in fade-in-0 duration-100">
                  <span className="text-xs font-semibold text-indigo-400">Device reminder:</span>
                  <input type="datetime-local" value={reminderDraft} onChange={(e) => setReminderDraft(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-bhodix-border bg-bhodix-surface px-2.5 py-1.5 text-xs text-bhodix-text focus:outline-none focus:border-indigo-500" />
                  <button type="submit" className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium">Save Reminder</button>
                  {selected.reminderAt && <button type="button" onClick={(e) => { setReminderDraft(''); saveTaskReminder(e, ''); setActiveTool(null); }} className="px-2.5 py-1.5 rounded-lg border border-bhodix-border text-xs text-bhodix-textMuted hover:text-rose-400">Clear</button>}
                </form>
              )}

              {canEdit && (
                <form onSubmit={async (e) => { e.preventDefault(); if (await addTaskActivity('comment', commentDraft.trim())) setCommentDraft(''); }} className="flex gap-2">
                  <input aria-label="Write a task comment" maxLength={2000} required value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="Write a comment or activity note…" className="min-w-0 flex-1 rounded-xl border border-bhodix-border bg-bhodix-surface px-3 py-2 text-xs text-bhodix-text focus:outline-none focus:border-indigo-500" />
                  <button aria-label="Post comment" className="rounded-xl bg-indigo-600 px-3.5 text-white hover:bg-indigo-500 transition-colors shadow-sm"><Send className="h-4 w-4" /></button>
                </form>
              )}

              {/* Timeline */}
              <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                {taskActivity.map((entry, index) => (
                  <div key={`${entry.createdAt}-${index}`} className="rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface/70 p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-bhodix-text">{entry.author}</span>
                      <time className="shrink-0 text-[10px] text-bhodix-textSubtle font-mono">{new Date(entry.createdAt).toLocaleString()}</time>
                    </div>
                    {entry.type === 'link' ? (
                      <a href={entry.value} target="_blank" rel="noreferrer" className="block break-all text-indigo-500 hover:underline">{entry.content}</a>
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-bhodix-textMuted leading-relaxed">
                        {entry.type === 'time' ? `Logged ${entry.value} minutes${entry.content ? ` · ${entry.content}` : ''}` : entry.content}
                      </p>
                    )}
                  </div>
                ))}
                {taskActivity.length === 0 && <p className="py-4 text-center text-xs text-bhodix-textSubtle">No comments or activity yet.</p>}
              </div>
            </section>

            {/* Scheduled AI status (if any) */}
            {selected.aiProvider && (
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs text-bhodix-textMuted">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-indigo-400">Scheduled AI · {selected.aiProvider}</span>
                  <span className="capitalize text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400">{selected.aiRunStatus === 'completed' ? 'Ready for review' : selected.aiRunStatus || 'Queued'}</span>
                </div>
                {selected.aiRunStatus === 'failed' && canManageAi && (
                  <button onClick={() => retryAiRun(selected)} className="mt-2 rounded-lg border border-indigo-500/30 px-2.5 py-1 text-xs text-indigo-400 hover:bg-indigo-500/10">Retry now</button>
                )}
              </div>
            )}

            {/* Footer with Delete and Close */}
            <div className="pt-4 border-t border-bhodix-border flex items-center justify-between">
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setDeletePrompt({ task: selected, reason: '' })}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/20 px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete task</span>
                </button>
              ) : <div />}
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="px-4 py-1.5 rounded-lg bg-bhodix-surface hover:bg-bhodix-hover border border-bhodix-border text-xs text-bhodix-text transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {holdPrompt && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-in fade-in-0 duration-150"
          onClick={() => setHoldPrompt(null)}
        >
          <form
            ref={holdDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="hold-dialog-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={saveHold}
            className="bg-bhodix-card border border-bhodix-border rounded-2xl max-w-md w-full p-5 space-y-3 shadow-2xl animate-in zoom-in-95 duration-150"
          >
            <h2 className="text-sm font-bold text-bhodix-text">
              <span id="hold-dialog-title">
              Why is {holdPrompt.tasks.length === 1 ? holdPrompt.tasks[0].id : `${holdPrompt.tasks.length} tasks`} on hold / paused?
              </span>
            </h2>
            <textarea
              autoFocus
              required
              rows={3}
              value={holdPrompt.note}
              onChange={(e) => setHoldPrompt({ ...holdPrompt, note: e.target.value })}
              placeholder="Reason, and what unblocks it"
              className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-xs text-bhodix-text focus:outline-none focus:border-indigo-500"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setHoldPrompt(null)} className="px-3 py-1.5 rounded-xl text-xs text-bhodix-textMuted hover:text-bhodix-text">Cancel</button>
              <button type="submit" className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium">Save note & hold</button>
            </div>
          </form>
        </div>
      )}

      {deletePrompt && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-in fade-in-0 duration-150"
          onClick={() => setDeletePrompt(null)}
        >
          <form
            ref={deleteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-task-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={confirmDeleteTask}
            className="bg-bhodix-card border border-bhodix-border rounded-2xl max-w-md w-full p-5 space-y-3 shadow-2xl animate-in zoom-in-95 duration-150"
          >
            <h2 id="delete-task-title" className="text-sm font-bold text-bhodix-text">Why should “{deletePrompt.task.title}” be deleted?</h2>
            <p className="text-xs text-bhodix-textMuted">Give a clear reason. The task and its activity stay recoverable for 7 days, then are permanently removed.</p>
            <textarea autoFocus required minLength={5} maxLength={1000} rows={3} value={deletePrompt.reason} onChange={(e) => setDeletePrompt({ ...deletePrompt, reason: e.target.value })} placeholder="Explain why this task is no longer needed" className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-xs text-bhodix-text focus:outline-none focus:border-rose-500" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeletePrompt(null)} className="px-3 py-1.5 rounded-xl text-xs text-bhodix-textMuted hover:text-bhodix-text">Cancel</button>
              <button type="submit" disabled={trashBusy || deletePrompt.reason.trim().length < 5} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />{trashBusy ? 'Moving…' : 'Delete for 7 days'}</button>
            </div>
          </form>
        </div>
      )}

      {showTrash && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[55] flex items-center justify-center p-4 animate-in fade-in-0 duration-150"
          onClick={() => setShowTrash(false)}
        >
          <section
            ref={trashDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-trash-title"
            onClick={(e) => e.stopPropagation()}
            className="bg-bhodix-card border border-bhodix-border rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150"
          >
            <div className="flex items-start justify-between gap-3"><div><h2 id="task-trash-title" className="text-base font-bold text-bhodix-text">Recently deleted tasks</h2><p className="mt-1 text-xs text-bhodix-textSubtle">Tasks are permanently removed after 7 days. Restore one before its expiry date to put it back in the planner.</p></div><button aria-label="Close recently deleted" onClick={() => setShowTrash(false)} className="rounded-lg p-1 text-bhodix-textSubtle hover:text-bhodix-text"><X className="h-4 w-4" /></button></div>
            {trashLoading ? <p className="py-8 text-center text-xs text-bhodix-textSubtle">Loading deleted tasks…</p> : trashItems.length ? <div className="space-y-2">{trashItems.map((item) => <article key={`${item.project}-${item.id}`} className="rounded-xl border border-bhodix-borderSubtle bg-bhodix-surface p-3"><div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><h3 className="text-xs font-semibold text-bhodix-text">{item.title} <span className="font-mono font-normal text-bhodix-textSubtle">{item.id}</span></h3><p className="mt-1 text-[10px] text-bhodix-textSubtle">{item.projectName} · deleted by {item.deletedBy || 'workspace member'} · expires {new Date(item.expiresAt).toLocaleString()}</p><p className="mt-2 whitespace-pre-wrap text-xs text-bhodix-textMuted"><span className="font-semibold text-bhodix-textSubtle">Reason: </span>{item.reason}</p></div><button disabled={trashBusy} onClick={() => restoreDeletedTask(item)} className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 px-2.5 py-1.5 text-[10px] text-indigo-400 hover:bg-indigo-500/10 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />Restore</button></div></article>)}</div> : <p className="rounded-xl border border-dashed border-bhodix-border p-8 text-center text-xs text-bhodix-textSubtle">No recently deleted tasks.</p>}
          </section>
        </div>
      )}

      {showNewModal && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in-0 duration-150"
          onClick={() => setShowNewModal(false)}
        >
          <form
            ref={newTaskDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-task-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreateTask}
            className="bg-bhodix-card border border-bhodix-border rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between border-b border-bhodix-border pb-3">
              <h2 id="new-task-title" className="text-base font-bold text-bhodix-text">New Task</h2>
              <div className="flex items-center gap-3">{showTemplateSave && <button type="button" onClick={saveTaskTemplate} className="text-[10px] text-indigo-500 hover:text-indigo-400">Save as template</button>}<button type="button" onClick={() => setShowNewModal(false)} className="text-bhodix-textSubtle hover:text-bhodix-text"><X className="w-4 h-4" /></button></div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-bhodix-textSubtle font-mono mb-1">Project</label>
                  <ThemedSelect
                    value={newProject}
                    onChange={setNewProject}
                    options={projectList.map((p) => ({ value: p.id, label: p.name }))}
                    placeholder="Select project"
                  />
                </div>
                <div>
                  <label className="block text-bhodix-textSubtle font-mono mb-1">Column</label>
                  <ThemedSelect
                    value={newStatus}
                    onChange={setNewStatus}
                    options={BOARD_COLUMNS.map((c) => ({ value: c.id, label: c.title }))}
                    placeholder="Select column"
                  />
                </div>
              </div>

              <div>
                <label className="block text-bhodix-textSubtle font-mono mb-1">Title *</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Task title…"
                  className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500"
                />
              </div>

              {newStatus === 'hold' && (
                <div>
                  <label className="block text-bhodix-textSubtle font-mono mb-1">Why on hold? *</label>
                  <textarea
                    required
                    rows={2}
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-bhodix-textSubtle font-mono mb-1">Priority</label>
                  <ThemedSelect
                    value={newPriority}
                    onChange={setNewPriority}
                    options={[
                      { value: 'urgent', label: 'Urgent', dotColor: '#ef4444' },
                      { value: 'high', label: 'High', dotColor: '#f59e0b' },
                      { value: 'medium', label: 'Medium', dotColor: '#6366f1' },
                      { value: 'low', label: 'Low', dotColor: '#10b981' }
                    ]}
                    placeholder="Select priority"
                  />
                </div>
                <div>
                  <label className="block text-bhodix-textSubtle font-mono mb-1">Due Date</label>
                  <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500" />
                </div>
              </div>

              <div>
                <label className="block text-bhodix-textSubtle font-mono mb-1">Start date &amp; time (optional)</label>
                <input type="datetime-local" required={!!newAiProvider} value={newStartAt} onChange={(e) => setNewStartAt(e.target.value)} className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500" />
              </div>

              <div>
                <label className="block text-bhodix-textSubtle font-mono mb-1">Reminder date &amp; time (optional)</label>
                <input type="datetime-local" value={newReminderAt} onChange={(e) => setNewReminderAt(e.target.value)} className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500" />
                <p className="mt-1 text-[10px] text-bhodix-textSubtle">Sends a notification on this device if reminders are enabled and Bhodhix is open.</p>
              </div>

              {canManageAi && <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 space-y-2">
                <label className="block text-bhodix-textSubtle font-mono">Scheduled AI report (optional)</label>
                {aiProviders.length > 0 ? (
                  <ThemedSelect
                    value={newAiProvider}
                    onChange={(val) => { setNewAiProvider(val); if (val) setNewRecurrence(''); }}
                    options={[
                      { value: '', label: 'No AI run' },
                      ...aiProviders.map((provider) => ({
                        value: provider.id,
                        label: `${provider.id === 'openai' ? 'OpenAI' : 'Anthropic Claude'} · ${provider.model}`
                      }))
                    ]}
                    placeholder="Choose provider"
                  />
                ) : <p className="text-[10px] text-bhodix-textSubtle">An admin must configure an OpenAI or Anthropic API key and model on the server to enable scheduled runs.</p>}
                {newAiProvider && <>
                  <textarea required minLength={5} maxLength={4000} rows={3} value={newAiInstructions} onChange={(e) => setNewAiInstructions(e.target.value)} placeholder="What should the AI report on when this task starts?" className="w-full rounded-xl border border-bhodix-border bg-bhodix-surface p-2.5 text-bhodix-text" />
                  <p className="text-[10px] text-bhodix-textSubtle">At the scheduled time, Bhodhix sends these instructions and basic task details to the selected provider. Do not include passwords or API secrets. The report is added to task activity and moved to Review.</p>
                </>}
              </div>}

              <div>
                <label className="block text-bhodix-textSubtle font-mono mb-1">Assignee</label>
                <input type="text" list="planner-team-assignees" value={newAssignee} onChange={(e) => setNewAssignee(e.target.value)} placeholder="Assignee name…" className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500" /><datalist id="planner-team-assignees">{teamMembers.map((member) => <option key={member.id} value={member.name} />)}</datalist>
              </div>

              <div>
                <label className="block text-bhodix-textSubtle font-mono mb-1">Tags (comma separated)</label>
                <input type="text" value={newTags} onChange={(e) => setNewTags(e.target.value)} placeholder="design, onboarding" className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500" />
              </div>

              <div>
                <label className="block text-bhodix-textSubtle font-mono mb-1">Description</label>
                <textarea rows={2} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Task details…" className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500" />
              </div>

              <div>
                <label className="block text-bhodix-textSubtle font-mono mb-1">Subtasks (one per line)</label>
                <textarea rows={2} value={newSubtasks} onChange={(e) => setNewSubtasks(e.target.value)} placeholder={'First step\nSecond step'} className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-bhodix-textSubtle font-mono mb-1">Repeat</label>
                  <ThemedSelect
                    value={newAiProvider ? '' : newRecurrence}
                    disabled={!!newAiProvider}
                    onChange={setNewRecurrence}
                    options={[
                      { value: '', label: 'Never' },
                      { value: 'weekly', label: 'Weekly' },
                      { value: 'monthly', label: 'Monthly' }
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-bhodix-textSubtle font-mono mb-1">Blocked by task ID</label>
                  <input type="text" value={newBlockedBy} onChange={(e) => setNewBlockedBy(e.target.value)} placeholder="TSK-123" className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-bhodix-textSubtle font-mono mb-1">Custom fields (key=value per line)</label>
                <textarea rows={2} value={newCustomFields} onChange={(e) => setNewCustomFields(e.target.value)} placeholder={'Client=Acme\nEstimate=3 days'} className="w-full p-2.5 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text focus:outline-none focus:border-indigo-500" />
              </div>
            </div>

            <div className="pt-3 border-t border-bhodix-border flex items-center justify-end gap-3">
              <button type="button" onClick={() => setShowNewModal(false)} className="px-4 py-2 rounded-xl text-xs text-bhodix-textMuted hover:text-bhodix-text">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-md">Save Task</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
