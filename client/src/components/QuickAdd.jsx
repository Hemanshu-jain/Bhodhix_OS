import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { useToast } from './ToastProvider';
import useDialogFocus from '../lib/useDialogFocus';

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export default function QuickAdd() {
  const { createTask, selectedProject, projectKeys, projectList, teamMembers } = useVault();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [targetProject, setTargetProject] = useState(selectedProject !== 'all' ? selectedProject : projectKeys[0] || '');
  const [assignee, setAssignee] = useState('Unassigned');
  const [dueDate, setDueDate] = useState(today());
  const [startAt, setStartAt] = useState('');
  const [reminderAt, setReminderAt] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const dialogRef = useDialogFocus(isOpen);

  React.useEffect(() => {
    const target = selectedProject !== 'all' ? selectedProject : projectKeys.includes(targetProject) ? targetProject : projectKeys[0] || '';
    if (target !== targetProject) setTargetProject(target);
  }, [selectedProject, projectKeys.join('|'), targetProject]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    if (!targetProject) return;

    setSaving(true);
    const ok = await createTask(targetProject, {
      title,
      priority,
      status: 'todo',
      assignee,
      dueDate,
      startAt: startAt ? new Date(startAt).toISOString() : '',
      reminderAt: reminderAt ? new Date(reminderAt).toISOString() : '',
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      subtasks: []
    });
    setSaving(false);
    showToast(ok ? 'Task added to To Do' : 'Could not add task', ok ? 'success' : 'error');

    if (ok) {
      setTitle('');
      setTags('');
      setStartAt('');
      setReminderAt('');
      setIsOpen(false);
    }
  };

  // Listen for the global shortcut (Alt+N for New Task)
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) { setIsOpen(false); return; }
      if (e.altKey && e.key === 'n') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  React.useEffect(() => {
    const open = () => setIsOpen(true);
    window.addEventListener('bhodix:open-quick-add', open);
    return () => window.removeEventListener('bhodix:open-quick-add', open);
  }, []);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-indigo-600 text-white shadow-2xl hover:bg-indigo-500 transition-all hover:scale-110 flex items-center justify-center z-40 group"
      >
        <Plus className="w-6 h-6 group-hover:rotate-90 transition-transform" />
        <span className="absolute right-16 scale-0 group-hover:scale-100 transition-all origin-right bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap font-mono">
          Quick Task (Alt+N)
        </span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end p-6 pointer-events-none">
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="quick-add-title" className="bg-bhodix-card border border-bhodix-border rounded-2xl shadow-2xl p-4 w-80 max-h-[85vh] overflow-y-auto pointer-events-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 id="quick-add-title" className="text-xs font-bold uppercase tracking-wider text-bhodix-textSubtle font-mono">Quick Add Task</h3>
          <button onClick={() => setIsOpen(false)} aria-label="Close quick add" className="p-1 hover:bg-bhodix-hover rounded">
            <X className="w-3 h-3" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            autoFocus
            required
            aria-label="Task title"
            className="w-full p-2 rounded-lg bg-bhodix-surface border border-bhodix-border text-xs text-bhodix-text outline-none focus:border-indigo-500"
            placeholder="What needs to be done?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <label className="block text-[10px] font-mono text-bhodix-textSubtle">Project
            <select required aria-label="Project for new task" value={targetProject} onChange={(e) => setTargetProject(e.target.value)} className="mt-1 w-full p-2 rounded-lg bg-bhodix-surface border border-bhodix-border text-xs text-bhodix-text">
              {projectList.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            {['low', 'medium', 'high', 'urgent'].map(p => (
              <button
                key={p}
                type="button"
                aria-pressed={priority === p}
                onClick={() => setPriority(p)}
                className={`flex-1 py-1 rounded text-[10px] capitalize transition-all border ${
                  priority === p
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-bhodix-surface text-bhodix-textSubtle border-bhodix-border hover:border-indigo-500/50'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <label className="block text-[10px] font-mono text-bhodix-textSubtle">Start date &amp; time (optional)<input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="mt-1 w-full p-2 rounded-lg bg-bhodix-surface border border-bhodix-border text-xs text-bhodix-text" /></label>
          <label className="block text-[10px] font-mono text-bhodix-textSubtle">Reminder (optional)<input type="datetime-local" value={reminderAt} onChange={(e) => setReminderAt(e.target.value)} className="mt-1 w-full p-2 rounded-lg bg-bhodix-surface border border-bhodix-border text-xs text-bhodix-text" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[10px] font-mono text-bhodix-textSubtle">Assignee<input list="team-assignees" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="mt-1 w-full p-2 rounded-lg bg-bhodix-surface border border-bhodix-border text-xs text-bhodix-text" /><datalist id="team-assignees">{teamMembers.map((member) => <option key={member.id} value={member.name} />)}</datalist></label>
            <label className="block text-[10px] font-mono text-bhodix-textSubtle">Due date<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 w-full p-2 rounded-lg bg-bhodix-surface border border-bhodix-border text-xs text-bhodix-text" /></label>
          </div>
          <label className="block text-[10px] font-mono text-bhodix-textSubtle">Tags (comma separated)<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="design, onboarding" className="mt-1 w-full p-2 rounded-lg bg-bhodix-surface border border-bhodix-border text-xs text-bhodix-text" /></label>
          <button
            type="submit"
            disabled={saving || !projectKeys.length}
            className="w-full py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-500 transition-colors shadow-sm disabled:opacity-50"
          >
            {!projectKeys.length ? 'Create a project first' : saving ? 'Adding…' : 'Add Task'}
          </button>
        </form>
      </div>
    </div>
  );
}
