const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod/v4');

const result = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

function createWorkspaceMcp(vaultManager, { canWrite = false, author = 'AI assistant', role = 'viewer', projectIds = null } = {}) {
  const server = new McpServer({ name: 'Bhodhix OS', version: '1.0.0' });
  const canAccessProject = (id) => !Array.isArray(projectIds) || projectIds.includes(id);
  const projects = () => Object.entries(vaultManager.state.projects || {}).filter(([id]) => canAccessProject(id));
  const allTasks = () => projects().flatMap(([projectId, project]) => (project.tasks || []).map((task) => ({ ...task, project: projectId })));

  server.registerTool('list_projects', {
    title: 'List workspace projects',
    description: 'List projects in the connected Bhodhix workspace. Read-only.',
    annotations: { readOnlyHint: true },
  }, async () => result(projects().map(([id, project]) => ({ id, name: project.meta?.name || id, overview: String(project.overview || '').slice(0, 1200) }))));

  server.registerTool('list_tasks', {
    title: 'List workspace tasks',
    description: 'List workspace tasks, including optional scheduled startAt timestamps, optionally filtered by project and status. Results are capped at 100. Read-only.',
    inputSchema: { project: z.string().max(100).optional(), status: z.string().max(40).optional() },
    annotations: { readOnlyHint: true },
  }, async ({ project, status }) => result(allTasks()
    .filter((task) => (!project || task.project === project) && (!status || task.status === status))
    .slice(0, 100)
    .map(({ id, title, project: projectId, status: taskStatus, priority, assignee, startAt, reminderAt, dueDate, tags, description, blocked_by }) => ({ id, title, project: projectId, status: taskStatus, priority, assignee, startAt, reminderAt, dueDate, tags, description, blocked_by }))));

  server.registerTool('get_task', {
    title: 'Get a workspace task',
    description: 'Read one task by project and task ID. Read-only.',
    inputSchema: { project: z.string().min(1).max(100), taskId: z.string().min(1).max(100) },
    annotations: { readOnlyHint: true },
  }, async ({ project, taskId }) => {
    const task = canAccessProject(project) && (vaultManager.state.projects?.[project]?.tasks || []).find((item) => item.id === taskId);
    return result(task ? { id: task.id, title: task.title, project, status: task.status, priority: task.priority, assignee: task.assignee, startAt: task.startAt, reminderAt: task.reminderAt, dueDate: task.dueDate, tags: task.tags, description: task.description, blocked_by: task.blocked_by, subtasks: task.subtasks } : { error: 'Task not found' });
  });

  // shortcut: search returns at most 25 matches, upgrade to cursor pagination when workspace sizes need broader AI reads.
  server.registerTool('search_workspace', {
    title: 'Search workspace',
    description: 'Search project names, overviews, tasks, and workspace documents. Returns up to 25 matches. Read-only.',
    inputSchema: { query: z.string().min(1).max(200) },
    annotations: { readOnlyHint: true },
  }, async ({ query }) => {
    const needle = query.toLowerCase();
    const matches = [];
    for (const [id, project] of projects()) {
      const name = project.meta?.name || id;
      for (const [type, text, path] of [
        ['project', `${name}\n${project.overview || ''}`, `projects/${id}`],
        ...(project.tasks || []).map((task) => ['task', `${task.title}\n${task.description || ''}`, `projects/${id}/tasks/${task.id}`]),
        ...(project.docs || []).map((doc) => ['document', `${doc.meta?.title || doc.fileName}\n${doc.content || ''}`, doc.relativePath])
      ]) {
        const index = text.toLowerCase().indexOf(needle);
        if (index >= 0) matches.push({ type, project: id, path, snippet: text.slice(Math.max(0, index - 120), index + needle.length + 220) });
        if (matches.length === 25) return result(matches);
      }
    }
    for (const doc of vaultManager.state.docs || []) {
      const text = `${doc.meta?.title || doc.fileName}\n${doc.content || ''}`;
      const index = text.toLowerCase().indexOf(needle);
      if (index >= 0) matches.push({ type: 'document', path: doc.relativePath, snippet: text.slice(Math.max(0, index - 120), index + needle.length + 220) });
      if (matches.length === 25) break;
    }
    return result(matches);
  });

  if (canWrite) {
    server.registerTool('create_task', {
      title: 'Create a task',
      description: 'Create a task in a project. Only use when the user explicitly asks you to create it. Does not access the Secrets Vault.',
      inputSchema: {
        project: z.string().min(1).max(100),
        title: z.string().trim().min(1).max(180),
        description: z.string().max(2000).optional(),
        priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
        dueDate: z.string().optional(),
        startAt: z.string().optional(),
        reminderAt: z.string().optional(),
        tags: z.array(z.string().trim().min(1).max(40)).max(8).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    }, async ({ project, title, description = '', priority = 'medium', dueDate = '', startAt = '', reminderAt = '', tags = [] }) => {
      if (!canAccessProject(project) || !/^[a-zA-Z0-9_-]+$/.test(project) || !vaultManager.state.projects?.[project]) return result({ error: 'Project not found' });
      if (dueDate) {
        const parsedDate = new Date(`${dueDate}T00:00:00.000Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dueDate) return result({ error: 'dueDate must be a real calendar date in YYYY-MM-DD format' });
      }
      let normalizedStart = '';
      if (startAt) {
        const parsed = Date.parse(startAt);
        if (Number.isNaN(parsed)) return result({ error: 'startAt must be a valid ISO timestamp' });
        normalizedStart = new Date(parsed).toISOString();
      }
      let normalizedReminder = '';
      if (reminderAt) {
        const parsed = Date.parse(reminderAt);
        if (Number.isNaN(parsed)) return result({ error: 'reminderAt must be a valid ISO timestamp' });
        normalizedReminder = new Date(parsed).toISOString();
      }
      const id = vaultManager.createTask(project, { title, description, priority, dueDate, startAt: normalizedStart, reminderAt: normalizedReminder, tags });
      if (!id) return result({ error: 'Could not create task in this project' });
      vaultManager.addTaskActivity(project, id, { type: 'comment', author: `Created via ${author}`, content: 'Task created through the connected AI assistant.' });
      return result({ id, project, title, status: 'todo' });
    });

    server.registerTool('update_task_status', {
      title: 'Update task status',
      description: 'Move a task to another status. Only use when the user explicitly asks you to change it. A reason is required to put a task on hold; completing a task requires a workspace owner or admin grant.',
      inputSchema: {
        project: z.string().min(1).max(100),
        taskId: z.string().min(1).max(100),
        status: z.enum(['todo', 'in_progress', 'review', 'hold', 'upcoming', 'done']),
        note: z.string().max(1000).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    }, async ({ project, taskId, status, note = '' }) => {
      const task = canAccessProject(project) && vaultManager.state.projects?.[project]?.tasks.find((item) => item.id === taskId);
      if (!task) return result({ error: 'Task not found' });
      if (status === 'hold' && note.trim().length < 5) return result({ error: 'A clear reason of at least five characters is required to put a task on hold' });
      if (status === 'done' && !['owner', 'admin'].includes(role)) return result({ error: 'Only a workspace owner or admin can complete a task through AI access' });
      if (!vaultManager.updateTaskStatus(project, taskId, status, status === 'hold' ? note : undefined)) return result({ error: 'Task status could not be changed' });
      vaultManager.addTaskActivity(project, taskId, { type: 'status', author: `AI assistant · ${author}`, content: `Moved to ${status}` });
      return result({ id: taskId, project, status });
    });

    server.registerTool('add_task_comment', {
      title: 'Comment on a task',
      description: 'Add a comment to a task. Only use when the user explicitly asks you to post the comment. Comments are visible to the workspace team.',
      inputSchema: { project: z.string().min(1).max(100), taskId: z.string().min(1).max(100), comment: z.string().trim().min(1).max(2000) },
      annotations: { readOnlyHint: false, destructiveHint: false }
    }, async ({ project, taskId, comment }) => {
      if (!canAccessProject(project) || !vaultManager.state.projects?.[project]?.tasks.some((item) => item.id === taskId)) return result({ error: 'Task not found' });
      vaultManager.addTaskActivity(project, taskId, { type: 'comment', author: `AI assistant · ${author}`, content: comment });
      return result({ id: taskId, project, commentAdded: true });
    });

    server.registerTool('set_task_reminder', {
      title: 'Set or clear a task reminder',
      description: 'Set a one-time reminder timestamp or clear the reminder. Only use when the user explicitly asks. Notifications are delivered on a team member device only if that member has enabled them and Bhodhix is open.',
      inputSchema: { project: z.string().min(1).max(100), taskId: z.string().min(1).max(100), reminderAt: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false }
    }, async ({ project, taskId, reminderAt = '' }) => {
      if (!canAccessProject(project) || !vaultManager.state.projects?.[project]?.tasks.some((item) => item.id === taskId)) return result({ error: 'Task not found' });
      let normalizedReminder = '';
      if (reminderAt) {
        const parsed = Date.parse(reminderAt);
        if (Number.isNaN(parsed)) return result({ error: 'reminderAt must be a valid ISO timestamp' });
        normalizedReminder = new Date(parsed).toISOString();
      }
      if (!vaultManager.updateTaskReminder(project, taskId, normalizedReminder)) return result({ error: 'Could not update task reminder' });
      vaultManager.addTaskActivity(project, taskId, { type: 'comment', author: `AI assistant · ${author}`, content: normalizedReminder ? `Reminder set for ${normalizedReminder}` : 'Task reminder cleared' });
      return result({ id: taskId, project, reminderAt: normalizedReminder });
    });
  }

  return server;
}

module.exports = { createWorkspaceMcp };
