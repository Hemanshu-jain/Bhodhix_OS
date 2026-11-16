// Pure parsing / formatting helpers for the Markdown vault. No filesystem access here.

const toNumber = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// Single-line, pipe-safe text so user input can never break a table row or task block.
const oneLine = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
const cell = (v) => oneLine(v).replace(/\|/g, '/');

const inr = (n) => `${n < 0 ? '-' : ''}₹${Math.abs(n).toLocaleString('en-IN')}`;

const isSafeId = (id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id);

const maxNumber = (text, re) => {
  let max = 0;
  for (const m of text.matchAll(re)) max = Math.max(max, parseInt(m[1], 10));
  return max;
};

const pad = (n, width) => String(n).padStart(width, '0');

function parseMarkdownTable(markdown) {
  const tableLines = markdown.split('\n').filter((l) => l.trim().startsWith('|'));
  if (tableLines.length < 3) return [];

  const headers = tableLines[0].split('|').map((s) => s.trim()).filter(Boolean);
  const keys = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, '_'));
  const rows = [];

  for (let i = 2; i < tableLines.length; i++) {
    const cells = tableLines[i].split('|').map((s) => s.trim()).slice(1, -1);
    if (!cells.some(Boolean)) continue;
    const row = {};
    keys.forEach((k, idx) => { row[k] = cells[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

function parseTasks(fileContent, projectId) {
  const tasks = [];
  const sections = fileContent.split(/^###\s+(TSK-\d+:[^\n]+)/gm);

  for (let i = 1; i < sections.length; i += 2) {
    const header = sections[i].trim();
    const body = sections[i + 1] || '';
    const task = {
      id: header.match(/^(TSK-\d+)/)[1],
      title: header.replace(/^TSK-\d+:\s*/, '').trim(),
      project: projectId,
      status: 'todo',
      priority: 'medium',
      assignee: 'Unassigned',
      dueDate: '',
      startAt: '',
      aiProvider: '',
      aiInstructions: '',
      aiRunStatus: '',
      aiRunAt: '',
      reminderAt: '',
      tags: [],
      description: '',
      note: '',
      subtasks: [],
      custom_fields: {}
    };

    for (const line of body.split('\n')) {
      const t = line.trim();
      const field = (name) => t.startsWith(`- **${name}**:`) ? t.slice(`- **${name}**:`.length).trim() : null;

      if (field('status') !== null) task.status = field('status');
      else if (field('priority') !== null) task.priority = field('priority');
      else if (field('assignee') !== null) task.assignee = field('assignee');
      else if (field('due_date') !== null) task.dueDate = field('due_date');
      else if (field('start_at') !== null) task.startAt = field('start_at');
      else if (field('reminder_at') !== null) task.reminderAt = field('reminder_at');
      else if (field('ai_provider') !== null) task.aiProvider = field('ai_provider');
      else if (field('ai_instructions') !== null) task.aiInstructions = field('ai_instructions');
      else if (field('ai_run_status') !== null) task.aiRunStatus = field('ai_run_status');
      else if (field('ai_run_at') !== null) task.aiRunAt = field('ai_run_at');
      else if (field('description') !== null) task.description = field('description');
      else if (field('note') !== null) task.note = field('note');
      else if (field('blocked_by') !== null) task.blocked_by = field('blocked_by');
      else if (field('recurrence') !== null) task.recurrence = field('recurrence');
      else if (field('custom_fields') !== null) {
        try { task.custom_fields = JSON.parse(field('custom_fields')); } catch { task.custom_fields = {}; }
      }
      else if (field('tags') !== null) {
        task.tags = field('tags').replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
      } else if (t.startsWith('- [ ]') || t.startsWith('- [x]')) {
        task.subtasks.push({ text: t.slice(5).trim(), completed: t.startsWith('- [x]') });
      }
    }
    if (task.status === 'backlog') task.status = 'hold'; // legacy name
    tasks.push(task);
  }
  return tasks;
}

// [start, end) of one task's block, so edits can never leak into a neighbouring task.
function taskBlockRange(content, taskId) {
  if (!isSafeId(taskId)) return null;
  const start = content.search(new RegExp(`^###\\s+${taskId}:`, 'm'));
  if (start === -1) return null;
  const next = content.slice(start + 3).search(/^###\s/m);
  return [start, next === -1 ? content.length : start + 3 + next];
}

// Insert `row` after the last line of the first table under the heading matched by `headingRe`.
function appendTableRow(content, headingRe, tableHeader, row, newHeading) {
  const lines = content.split('\n');
  const h = lines.findIndex((l) => headingRe.test(l));
  if (h === -1) return `${content.trimEnd()}\n\n${newHeading}\n\n${tableHeader}\n${row}\n`;

  let i = h + 1;
  while (i < lines.length && !lines[i].trim().startsWith('|') && !/^#{1,6}\s|^---\s*$/.test(lines[i])) i++;

  if (i >= lines.length || !lines[i].trim().startsWith('|')) {
    lines.splice(h + 1, 0, '', ...tableHeader.split('\n'), row);
    return lines.join('\n');
  }
  let last = i;
  while (last + 1 < lines.length && lines[last + 1].trim().startsWith('|')) last++;
  lines.splice(last + 1, 0, row);
  return lines.join('\n');
}

// Sections are matched on their heading line only, never on body text.
function sectionsByHeading(markdown) {
  return markdown.split(/^###\s+/m).slice(1).map((sec) => ({
    heading: sec.split('\n')[0].trim(),
    body: sec
  }));
}

function parseFinanceTables(markdown) {
  const out = { revenueStreams: [], expenses: [] };
  for (const { heading, body } of sectionsByHeading(markdown)) {
    const h = heading.toLowerCase();
    if (h.includes('revenue')) out.revenueStreams = parseMarkdownTable(body);
    else if (h.includes('expense') || h.includes('burn')) out.expenses = parseMarkdownTable(body);
  }
  return out;
}

function summarizeFinance(tables) {
  const gross = tables.revenueStreams.reduce((s, r) => s + toNumber(r.amount__inr_ ?? r.amount), 0);
  const expenses = tables.expenses.reduce((s, r) => s + toNumber(r.cost__inr_ ?? r.cost), 0);
  const net = gross - expenses;
  return {
    monthly_gross_revenue: gross,
    monthly_total_expenses: expenses,
    net_monthly_margin: net,
    net_margin_percentage: gross > 0 ? Number(((net / gross) * 100).toFixed(2)) : 0
  };
}

// `- **Field**: value` lines inside an incident block.
const blockField = (block, name) => {
  const m = block.match(new RegExp(`^- \\*\\*${name}\\*\\*:[ \\t]*(.*)$`, 'mi'));
  return m ? m[1].trim() : '';
};

module.exports = {
  toNumber, oneLine, cell, inr, isSafeId, maxNumber, pad,
  parseMarkdownTable, parseTasks, taskBlockRange, appendTableRow,
  sectionsByHeading, parseFinanceTables, summarizeFinance, blockField
};
