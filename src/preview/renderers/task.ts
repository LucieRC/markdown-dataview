/**
 * TASK renderer — renders Dataview TASK query results as interactive task lists.
 */

interface SerializedQueryResult {
  data: Record<string, any>[];
  groups?: { key: any; rows: Record<string, any>[] }[];
  isGrouped: boolean;
  totalCount: number;
}

export function renderTaskList(container: HTMLElement, result: SerializedQueryResult): void {
  const { data, groups, isGrouped } = result;

  setCurrentPage((result as any).currentPage || '');

  if (data.length === 0) {
    container.innerHTML = '<div class="dataview-empty">No tasks to show.</div>';
    return;
  }

  if (isGrouped && groups) {
    renderGroupedTaskList(container, result);
    return;
  }

  let html = '<ul class="dataview-task-list">';

  for (const task of data) {
    html += renderTaskItem(task);
  }

  html += '</ul>';
  html += `<div class="dataview-result-count">${result.totalCount} task(s)</div>`;

  container.innerHTML = html;
}

function renderGroupedTaskList(container: HTMLElement, result: SerializedQueryResult): void {
  const { groups } = result;

  if (!groups || groups.length === 0) {
    container.innerHTML = '<div class="dataview-empty">No tasks to show.</div>';
    return;
  }

  let html = '';

  for (const group of groups) {
    const groupLabel = formatValue(group.key);
    html += '<div class="dataview-group">';
    html += `<h4 class="dataview-group-header">${escapeHtml(groupLabel)}</h4>`;
    html += '<ul class="dataview-task-list">';

    for (const task of group.rows) {
      html += renderTaskItem(task);
    }

    html += '</ul></div>';
  }

  html += `<div class="dataview-result-count">${result.totalCount} task(s)</div>`;

  container.innerHTML = html;
}

function renderTaskItem(task: Record<string, any>): string {
  const completed = task.completed || task.checked;
  const statusChar = task.status || (completed ? 'x' : ' ');
  const text = task.text || '';
  const fileLink = task._page?.file?.link || task.file?.link;
  const fileName = task._page?.file?.name || task.file?.name || task.path || '';
  const due = task.due;
  const scheduled = task.scheduled;
  const start = task.start;

  let classes = 'dataview-task';
  if (completed) classes += ' dataview-task-completed';

  let meta = '';
  if (due) {
    meta += `<span class="dataview-task-due">📅 ${escapeHtml(formatDateValue(due))}</span> `;
  }
  if (scheduled) {
    meta += `<span class="dataview-task-scheduled">⏳ ${escapeHtml(formatDateValue(scheduled))}</span> `;
  }
  if (start) {
    meta += `<span class="dataview-task-start">🛫 ${escapeHtml(formatDateValue(start))}</span> `;
  }

  return `<li class="${classes}">
    <input type="checkbox" ${completed ? 'checked' : ''} disabled>
    <span class="dataview-task-text">${escapeHtml(text)}</span>
    ${meta}
    <span class="dataview-task-file">${renderLink(fileLink, fileName)}</span>
  </li>`;
}

// ─── Helpers ──────────────────────────────────────────────────────

let currentPreviewPage = '';

function setCurrentPage(page: string): void {
  currentPreviewPage = page;
}

function renderLink(link: any, fallback: string): string {
  if (!link) return escapeHtml(fallback);
  const display = link.display || link.path || fallback;
  const path = link.path || '';
  const href = currentPreviewPage ? relativePath(currentPreviewPage, path) : path;
  return `<a class="dataview-link" href="${escapeHtml(href)}"
    title="${escapeHtml(path)}">${escapeHtml(display)}</a>`;
}

function relativePath(currentPage: string, target: string): string {
  // dirname, handling root-level files (no slash → '')
  const normalized = currentPage.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  const currentDir = idx === -1 ? '' : normalized.slice(0, idx);
  if (!currentDir) return target;
  const currentParts = currentDir.split('/');
  const targetParts = target.split('/');
  let i = 0;
  while (i < currentParts.length && i < targetParts.length && currentParts[i] === targetParts[i]) i++;
  const ups = currentParts.length - i;
  const downs = targetParts.slice(i);
  return ups > 0 ? '../'.repeat(ups) + downs.join('/') : './' + downs.join('/');
}

function formatValue(value: any): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value.type === 'link') return value.display || value.path;
  if (value.type === 'date') return value.value || '';
  return String(value);
}

function formatDateValue(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value.type === 'date') return value.value?.split('T')[0] || '';
  return String(value);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
