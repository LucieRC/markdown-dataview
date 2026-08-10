/**
 * LIST renderer — renders Dataview LIST query results as bulleted lists.
 */

interface SerializedQueryResult {
  data: Record<string, any>[];
  columns?: { field: string; alias: string }[];
  withoutId: boolean;
  groups?: { key: any; rows: Record<string, any>[] }[];
  isGrouped: boolean;
  totalCount: number;
}

export function renderList(container: HTMLElement, result: SerializedQueryResult): void {
  const { data, withoutId, groups, isGrouped } = result;

  setCurrentPage((result as any).currentPage || '');

  if (data.length === 0) {
    container.innerHTML = '<div class="dataview-empty">No results to show.</div>';
    return;
  }

  if (isGrouped && groups) {
    renderGroupedList(container, result);
    return;
  }

  // Determine the extra field (if any)
  const extraField = result.columns && result.columns.length > 0
    ? result.columns[0]
    : null;

  let html = '<ul class="dataview-list">';

  for (const row of data) {
    const fileLink = row._page?.file?.link || row.file?.link;
    const fileName = row._page?.file?.name || row.file?.name || '';

    html += '<li class="dataview-list-item">';

    if (!withoutId) {
      html += `<span class="dataview-list-file">${renderLink(fileLink, fileName)}</span>`;
    }

    if (extraField) {
      const value = getFieldValue(row, extraField.field);
      html += `<span class="dataview-list-value">${renderValue(value)}</span>`;
    }

    html += '</li>';
  }

  html += '</ul>';
  html += `<div class="dataview-result-count">${result.totalCount} result(s)</div>`;

  container.innerHTML = html;
}

function renderGroupedList(container: HTMLElement, result: SerializedQueryResult): void {
  const { groups, withoutId } = result;

  if (!groups || groups.length === 0) {
    container.innerHTML = '<div class="dataview-empty">No results to show.</div>';
    return;
  }

  const extraField = result.columns && result.columns.length > 0
    ? result.columns[0]
    : null;

  let html = '';

  for (const group of groups) {
    const groupLabel = formatValue(group.key);

    html += '<div class="dataview-group">';
    html += `<h4 class="dataview-group-header">${escapeHtml(groupLabel)}</h4>`;
    html += '<ul class="dataview-list">';

    for (const row of group.rows) {
      const fileLink = row._page?.file?.link || row.file?.link;
      const fileName = row._page?.file?.name || row.file?.name || '';

      html += '<li class="dataview-list-item">';

      if (!withoutId) {
        html += `<span class="dataview-list-file">${renderLink(fileLink, fileName)}</span>`;
      }

      if (extraField) {
        const value = getFieldValue(row, extraField.field);
        html += `<span class="dataview-list-value">${renderValue(value)}</span>`;
      }

      html += '</li>';
    }

    html += '</ul></div>';
  }

  html += `<div class="dataview-result-count">${result.totalCount} result(s)</div>`;

  container.innerHTML = html;
}

// ─── Helpers ──────────────────────────────────────────────────────

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

function renderValue(value: any): string {
  if (value === null || value === undefined) return '<span class="dataview-null">-</span>';
  if (typeof value === 'string') return escapeHtml(value);
  if (typeof value === 'number') return `<span class="dataview-number">${value}</span>`;
  if (typeof value === 'boolean') return `<span class="dataview-boolean">${value}</span>`;

  if (value.type === 'link') {
    return renderLink(value, value.display || value.path);
  }
  if (value.type === 'date') {
    return `<span class="dataview-date">${escapeHtml(value.value || '')}</span>`;
  }

  if (Array.isArray(value)) {
    return value.map(renderValue).join(', ');
  }

  return escapeHtml(String(value));
}

function formatValue(value: any): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value.type === 'link') return value.display || value.path;
  if (value.type === 'date') return value.value || '';
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
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
