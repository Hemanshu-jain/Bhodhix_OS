export const PRIORITY_COLORS = {
  urgent: {
    bg: 'bg-rose-500/10',
    text: 'text-rose-600',
    border: 'border-rose-500/30',
    badge: 'bg-rose-500 text-white',
    label: 'Urgent'
  },
  high: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-600',
    border: 'border-amber-500/30',
    badge: 'bg-amber-500 text-white',
    label: 'High'
  },
  medium: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-600',
    border: 'border-blue-500/30',
    badge: 'bg-blue-500 text-white',
    label: 'Medium'
  },
  low: {
    bg: 'bg-slate-500/10',
    text: 'text-slate-600',
    border: 'border-slate-500/30',
    badge: 'bg-slate-500 text-white',
    label: 'Low'
  }
};

export const getPriorityStyle = (priority) => {
  return PRIORITY_COLORS[priority?.toLowerCase()] || PRIORITY_COLORS.medium;
};

// Planner board columns, in display order. `status` values are what tasks.md stores.
export const BOARD_COLUMNS = [
  { id: 'upcoming', title: 'Upcoming Plans', hint: 'Ideas & plans, not started', accent: 'border-t-violet-500' },
  { id: 'todo', title: 'To Do', hint: 'Next up, pick these first', accent: 'border-t-sky-500' },
  { id: 'in_progress', title: 'In Progress', hint: '', accent: 'border-t-indigo-500' },
  { id: 'review', title: 'In Review / QA', hint: '', accent: 'border-t-amber-500' },
  { id: 'done', title: 'Done', hint: 'Last 7 days', accent: 'border-t-emerald-500' },
  { id: 'hold', title: 'Hold / Paused', hint: 'Needs a note: why', accent: 'border-t-slate-500' }
];

export const STATUS_LABELS = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.id, c.title]));

export const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

export const DONE_VISIBLE_DAYS = 7;
