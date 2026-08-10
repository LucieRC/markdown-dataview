/**
 * TABLE renderer — renders Dataview TABLE query results as HTML tables.
 */

interface SerializedQueryResult {
  type: string;
  data: Record<string, any>[];
  columns?: { field: string; alias: string }[];
  withoutId: boolean;
  groups?: { key: any; rows: Record<string, any>[] }[];
  isGrouped: boolean;
  totalCount: number;
}

export function renderTable(container: HTMLElement, result: SerializedQueryResult): void {
  const { data, columns, withoutId, groups, isGrouped } = result;

  // Set current page for relative link computation
  setCurrentPage((result as any).currentPage || '');

  if (data.length === 0) {
    container.innerHTML = '<div class="dataview-empty">No results to show.</div>';
    return;
  }

  if (isGrouped && groups) {
    renderGroupedTable(container, result);
    return;
  }

  // Determine columns: if not specified, infer from data
  const resolvedColumns = columns && columns.length > 0
    ? columns
    : inferColumns(data, withoutId);

  let html = '<div class="dataview-table-wrapper">';
  html += '<table class="dataview-table">';
  html += '<thead><tr>';

  // File column (unless WITHOUT ID)
  if (!withoutId) {
    html += '<th class="dataview-col-file">File</th>';
  }

  for (const col of resolvedColumns) {
    html += `<th>${escapeHtml(col.alias || col.field)}</th>`;
  }
  html += '</tr></thead><tbody>';

  // Data rows
  for (const row of data) {
    html += '<tr>';

    if (!withoutId) {
      const fileLink = row._page?.file?.link || row.file?.link;
      const fileName = row._page?.file?.name || row.file?.name || '';
      html += `<td class="dataview-col-file">${renderLink(fileLink, fileName)}</td>`;
    }

    for (const col of resolvedColumns) {
      const value = getFieldValue(row, col.field);
      html += `<td>${renderValue(value)}</td>`;
    }

    html += '</tr>';
  }

  html += '</tbody></table>';
  html += `<div class="dataview-result-count">${result.totalCount} result(s)</div>`;
  html += '</div>';

  container.innerHTML = html;
}

function renderGroupedTable(container: HTMLElement, result: SerializedQueryResult): void {
  const { data, columns } = result;

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="dataview-empty">No results to show.</div>';
    return;
  }

  let html = '<div class="dataview-table-wrapper">';
  html += '<table class="dataview-table">';
  html += '<thead><tr>';

  // Show group key as first column
  html += '<th>Group</th>';

  for (const col of (columns || [])) {
    html += `<th>${escapeHtml(col.alias || col.field)}</th>`;
  }
  html += '</tr></thead><tbody>';

  // Render one row per group
  for (const row of data) {
    html += '<tr>';

    // Group key
    html += `<td class="dataview-group-key">${renderValue(row.key)}</td>`;

    for (const col of (columns || [])) {
      const value = getFieldValue(row, col.field);
      html += `<td>${renderValue(value)}</td>`;
    }

    html += '</tr>';
  }

  html += '</tbody></table>';
  html += `<div class="dataview-result-count">${result.totalCount} result(s)</div>`;
  html += '</div>';

  container.innerHTML = html;
}

// ─── Helpers ──────────────────────────────────────────────────────

function inferColumns(
  data: Record<string, any>[],
  withoutId: boolean
): { field: string; alias: string }[] {
  if (data.length === 0) return [];

  const firstRow = data[0];
  const excludeKeys = new Set([
    '_page', 'file', 'key', 'rows',
  ]);

  const columns: { field: string; alias: string }[] = [];
  for (const key of Object.keys(firstRow)) {
    if (!excludeKeys.has(key) && !key.startsWith('_')) {
      columns.push({ field: key, alias: key });
    }
  }

  return columns;
}

function getFieldValue(row: Record<string, any>, fieldPath: string): any {
  const parts = fieldPath.split('.');
  let current = row;

  for (const part of parts) {
    if (current === null || current === undefined) return null;
    if (typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return null;
    }
  }

  return current;
}

// Resolved from serialized result for relative link computation
let currentPreviewPage = '';

function setCurrentPage(page: string): void {
  currentPreviewPage = page;
}

function renderLink(link: any, fallback: string): string {
  if (!link) return escapeHtml(fallback);
  const display = link.display || link.path || fallback;
  const path = link.path || '';

  // Compute relative path from the current preview page
  const href = currentPreviewPage
    ? relativePath(currentPreviewPage, path)
    : path;
  return `<a class="dataview-link" href="${escapeHtml(href)}"
    title="${escapeHtml(path)}">${escapeHtml(display)}</a>`;
}

/** Compute relative path from currentPage (e.g. "test/04-Projects/README.md") to target */
function relativePath(currentPage: string, target: string): string {
  // dirname, handling root-level files (no slash → '')
  const normalized = currentPage.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  const currentDir = idx === -1 ? '' : normalized.slice(0, idx);
  if (!currentDir) return target;
  const currentParts = currentDir.split('/');
  const targetParts = target.split('/');
  // Find common prefix
  let i = 0;
  while (i < currentParts.length && i < targetParts.length && currentParts[i] === targetParts[i]) {
    i++;
  }
  const ups = currentParts.length - i;
  const downs = targetParts.slice(i);
  const prefix = ups > 0 ? '../'.repeat(ups) : './';
  return prefix + downs.join('/');
}

function renderValue(value: any): string {
  if (value === null || value === undefined) return '<span class="dataview-null">-</span>';
  if (typeof value === 'boolean') return `<span class="dataview-boolean">${value}</span>`;
  if (typeof value === 'number') return `<span class="dataview-number">${value}</span>`;
  if (typeof value === 'string') return escapeHtml(value);

  if (value.type === 'link') {
    return renderLink(value, value.display || value.path);
  }
  if (value.type === 'date') {
    return `<span class="dataview-date">${escapeHtml(value.value || '')}</span>`;
  }
  if (value.type === 'duration') {
    return `<span class="dataview-duration">${escapeHtml(formatDuration(value.value))}</span>`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="dataview-null">-</span>';
    return value.map(v => renderValue(v)).join(', ');
  }

  if (typeof value === 'object') {
    return escapeHtml(JSON.stringify(value));
  }

  return escapeHtml(String(value));
}

function formatValue(value: any): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value.type === 'link') return value.display || value.path;
  if (value.type === 'date') return value.value || '';
  if (value.type === 'duration') return formatDuration(value.value);
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  return String(value);
}

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
