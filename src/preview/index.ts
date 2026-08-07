/**
 * Preview Scripts Entry Point
 *
 * Runs inside the Markdown preview webview. Finds dataview placeholder
 * elements injected by the markdown-it plugin and renders them as
 * interactive tables, lists, task lists, and calendar views.
 *
 * Also provides the DataviewJS API (`dv` object) for dataviewjs blocks.
 */

import { renderTable } from './renderers/table';
import { renderList } from './renderers/list';
import { renderTaskList } from './renderers/task';
import { renderCalendar } from './renderers/calendar';

// ─── Types ────────────────────────────────────────────────────────

interface SerializedQueryResult {
  type: string;
  data: Record<string, any>[];
  columns?: { field: string; alias: string }[];
  withoutId: boolean;
  groups?: { key: any; rows: Record<string, any>[] }[];
  isGrouped: boolean;
  totalCount: number;
}

interface DataviewJSConfig {
  pages: Record<string, any>[];
  currentPage: string;
  currentPageMeta: Record<string, any> | null;
}

// ─── Main Rendering Logic ─────────────────────────────────────────

let currentAbortController: AbortController | null = null;
let retryCount = 0;
const MAX_RETRIES = 10;
const RETRY_DELAY = 50; // ms

function init(): void {
  // Cancel any in-progress render
  currentAbortController?.abort();
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  // Use requestAnimationFrame + retry to wait for DOM to be ready
  retryCount = 0;
  tryRender(signal);
}

function tryRender(signal: AbortSignal): void {
  if (signal.aborted) return;

  const hasDQL = document.querySelectorAll('.dataview-result').length > 0;
  const hasJS = document.querySelectorAll('.dataviewjs-result').length > 0;
  const hasInline = document.querySelectorAll('.dataview-inline-js').length > 0;

  // If we found dataview elements, render them
  if (hasDQL || hasJS || hasInline) {
    try {
      renderDQLBlocks(signal);
      renderDataviewJSBlocks(signal);
      renderInlineJSExpressions();
    } catch (err) {
      console.error('[Dataview Preview] Render error:', err);
    }
    return;
  }

  // Retry if no dataview elements found yet (DOM might not be ready)
  retryCount++;
  if (retryCount < MAX_RETRIES) {
    setTimeout(() => tryRender(signal), RETRY_DELAY);
  }
}

/** Re-render on content update */
window.addEventListener('vscode.markdown.updateContent', init);
init();

// ─── DQL Block Rendering ─────────────────────────────────────────

function renderDQLBlocks(signal: AbortSignal): void {
  const blocks = Array.from(document.querySelectorAll('.dataview-result'));

  for (const block of blocks) {
    if (signal.aborted) return;

    const resultStr = (block as HTMLElement).dataset.result;
    if (!resultStr) continue;

    try {
      const result: SerializedQueryResult = JSON.parse(resultStr);

      switch (result.type) {
        case 'table':
          renderTable(block as HTMLElement, result);
          break;
        case 'list':
          renderList(block as HTMLElement, result);
          break;
        case 'task':
          renderTaskList(block as HTMLElement, result);
          break;
        case 'calendar':
          renderCalendar(block as HTMLElement, result);
          break;
        default:
          block.innerHTML = '<div class="dataview-error">Unknown query type: ' + result.type + '</div>';
      }
    } catch (err) {
      console.error('[Dataview Preview] Parse error:', err);
      block.innerHTML = '<div class="dataview-error">Failed to parse query result</div>';
    }
  }
}

// ─── DataviewJS Block Rendering ──────────────────────────────────

function renderDataviewJSBlocks(signal: AbortSignal): void {
  const blocks = Array.from(document.querySelectorAll('.dataviewjs-result'));

  for (const block of blocks) {
    if (signal.aborted) return;

    const configStr = (block as HTMLElement).dataset.config;
    const sourceEl = block.querySelector('.dataviewjs-source');
    if (!configStr || !sourceEl) continue;

    try {
      const config: DataviewJSConfig = JSON.parse(configStr);
      const source = sourceEl.textContent || '';

      // Set the current container for dv.table() / dv.list() output
      currentDataviewJSContainer = block as HTMLElement;

      // Clear the container (keep only the API reference)
      (block as HTMLElement).innerHTML = '';

      // Create the dv API and execute the user's JavaScript
      const dv = createDataviewAPI(config);

      const fn = new Function('dv', source);
      fn(dv);
    } catch (err) {
      console.error('[Dataview Preview] DataviewJS error:', err);
      (block as HTMLElement).innerHTML = '<div class="dataview-error">DataviewJS Error: ' +
        escapeHtml(err instanceof Error ? err.message : String(err)) + '</div>';
    }
  }
}

// ─── Inline Expression Rendering ──────────────────────────────────

function renderInlineExpressions(): void {
  // Inline expressions are already rendered server-side in the markdown-it plugin.
  // The `.dataview-inline` spans contain the display value directly.
  // No further client-side rendering needed for simple inline expressions.
}

function renderInlineJSExpressions(): void {
  const spans = Array.from(document.querySelectorAll('.dataview-inline-js'));

  for (const span of spans) {
    const jsData = (span as HTMLElement).dataset.js;
    if (!jsData) continue;

    try {
      const { page, expr } = JSON.parse(jsData);
      const dv = createDataviewAPI({
        pages: [page],
        currentPage: page.file?.path || '',
        currentPageMeta: page,
      });

      const fn = new Function('dv', 'return ' + expr);
      const result = fn(dv);
      span.textContent = String(result ?? '');
      span.className = 'dataview-inline';
    } catch (err) {
      span.textContent = 'ERROR';
      span.className = 'dataview-inline dataview-inline-error';
      (span as HTMLElement).title = err instanceof Error ? err.message : String(err);
    }
  }
}

// ─── DataviewJS API ───────────────────────────────────────────────

let currentDataviewJSContainer: HTMLElement | null = null;

function createDataviewAPI(config: DataviewJSConfig): any {
  const pages = config.pages || [];

  return {
    /** Get all pages matching optional source */
    pages(source?: string): any {
      let result = [...pages];

      if (source) {
        result = filterPagesBySource(result, source);
      }

      return createDataArray(result);
    },

    /** Get a single page by path */
    page(path: string): any {
      const page = pages.find((p: any) =>
        p.file?.path === path ||
        p.file?.path === path + '.md' ||
        p.file?.name === path
      );
      return page || null;
    },

    /** Get the current page */
    current(): any {
      return config.currentPageMeta;
    },

    /** Render a table */
    table(headers: string[], rows: any[][], container?: HTMLElement): void {
      const target = container || currentDataviewJSContainer;
      if (!target) return;

      // Clear previous content but keep the API reference
      target.innerHTML = '';

      let html = '<table class="dataview-table"><thead><tr>';
      for (const h of headers) {
        html += `<th>${escapeHtml(String(h))}</th>`;
      }
      html += '</tr></thead><tbody>';

      for (const row of rows) {
        html += '<tr>';
        for (const cell of row) {
          html += `<td>${renderDvValue(cell)}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody></table>';

      target.innerHTML = html;
    },

    /** Render a list */
    list(values: any[], container?: HTMLElement): void {
      const target = container || currentDataviewJSContainer;
      if (!target) return;

      target.innerHTML = '';

      let html = '<ul class="dataview-list">';
      for (const val of values) {
        html += `<li>${renderDvValue(val)}</li>`;
      }
      html += '</ul>';

      target.innerHTML = html;
    },

    /** Render a task list */
    taskList(tasks: any[], container?: HTMLElement): void {
      const target = container || currentDataviewJSContainer;
      if (!target) return;

      target.innerHTML = '';

      let html = '<ul class="dataview-task-list">';
      for (const task of tasks) {
        const checked = task.completed || task.checked ? 'checked' : '';
        html += `<li><input type="checkbox" ${checked} disabled> ${escapeHtml(formatValue(task.text || task))}</li>`;
      }
      html += '</ul>';

      target.innerHTML = html;
    },

    /** Create a date object */
    date(value: string): any {
      const d = new Date(value);
      return {
        ts: d.getTime(),
        value: d.toISOString(),
        format: (fmt: string) => formatDate(d, fmt),
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
        hour: d.getHours(),
        minute: d.getMinutes(),
        second: d.getSeconds(),
        weekday: d.getDay(),
      };
    },

    /** Create a duration object */
    duration(value: string): any {
      const ms = parseDuration(value);
      return { value: ms, type: 'duration' };
    },

    /** Current page info */
    currentFilePath: config.currentPage,
    currentPage: config.currentPageMeta,
  };
}

function createDataArray(items: any[]): any {
  const handler: ProxyHandler<any[]> = {
    get(target: any[], prop: string | symbol) {
      if (prop in target) {
        return (target as any)[prop];
      }
      // Field swizzling: array.field → map each item
      if (typeof prop === 'string') {
        return createDataArray(
          target.map((item: any) => {
            if (item === null || item === undefined) return null;
            if (typeof item === 'object' && prop in item) return item[prop];
            return null;
          }).filter((v: any) => v !== null)
        );
      }
      return undefined;
    },
  };

  // Add common array methods
  const array = [...items];
  const methods: Record<string, Function> = {
    where: (predicate: Function) => createDataArray(array.filter((item, i) => predicate(item, i))),
    sort: (field: string | Function, order = 'asc') => {
      const sorted = [...array].sort((a: any, b: any) => {
        let va: any, vb: any;
        if (typeof field === 'function') {
          va = field(a);
          vb = field(b);
        } else {
          va = a?.[field];
          vb = b?.[field];
        }
        // Handle date/duration comparison
        if (va?.ts !== undefined && vb?.ts !== undefined) {
          return order === 'asc' ? va.ts - vb.ts : vb.ts - va.ts;
        }
        if (va?.value !== undefined && vb?.value !== undefined && typeof va.value === 'number') {
          return order === 'asc' ? va.value - vb.value : vb.value - va.value;
        }
        // Default string/number comparison
        if (va < vb) return order === 'asc' ? -1 : 1;
        if (va > vb) return order === 'asc' ? 1 : -1;
        return 0;
      });
      return createDataArray(sorted);
    },
    limit: (n: number) => createDataArray(array.slice(0, n)),
    filter: (fn: Function) => createDataArray(array.filter((item, i) => fn(item, i))),
    map: (fn: Function) => createDataArray(array.map((item, i) => fn(item, i))),
    flatMap: (fn: Function) => createDataArray(array.flatMap((item, i) => fn(item, i) || [])),
    groupBy: (fn: Function) => {
      const groups = new Map<string, any[]>();
      for (const item of array) {
        const key = String(fn(item));
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }
      const result: any[] = [];
      for (const [key, rows] of groups) {
        result.push({ key, rows: createDataArray(rows) });
      }
      return createDataArray(result);
    },
    first: () => array[0] ?? null,
    last: () => array[array.length - 1] ?? null,
  };

  const proxied = new Proxy(array, handler);
  for (const [name, fn] of Object.entries(methods)) {
    (proxied as any)[name] = fn;
  }
  (proxied as any).length = array.length;
  (proxied as any).values = array;

  return proxied;
}

// ─── Helper Functions ─────────────────────────────────────────────

function filterPagesBySource(pages: any[], source: string): any[] {
  const trimmed = source.trim();

  // Tag: #tag
  if (trimmed.startsWith('#')) {
    const tag = trimmed;
    return pages.filter((p: any) => {
      const tags = p.file?.tags || [];
      return tags.includes(tag);
    });
  }

  // Folder: "folder"
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const folder = trimmed.slice(1, -1);
    return pages.filter((p: any) => {
      const f = p.file?.folder || '';
      return f === folder || f.startsWith(folder + '/');
    });
  }

  return pages;
}

function formatValue(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return String(val);
  if (val.type === 'link') return val.display || val.path || '';
  if (val.type === 'date') return val.value || '';
  if (Array.isArray(val)) return val.map(formatValue).join(', ');
  if (typeof val === 'object') {
    if (val.file?.name) return val.file.name;
    if (val.text) return val.text;
    return JSON.stringify(val);
  }
  return String(val);
}

/** Render a value as HTML for dv.table() / dv.list() output, with clickable links */
function renderDvValue(val: any): string {
  if (val === null || val === undefined) return '<span class="dataview-null">-</span>';
  if (typeof val === 'number') return `<span class="dataview-number">${val}</span>`;
  if (typeof val === 'boolean') return `<span class="dataview-boolean">${val}</span>`;

  if (typeof val === 'object' && val !== null) {
    if (val.type === 'link') {
      const href = val.path || '';
      const display = val.display || val.path || '';
      return `<a class="dataview-link" href="${escapeHtml(href)}">${escapeHtml(display)}</a>`;
    }
    if (val.type === 'date') {
      return `<span class="dataview-date">${escapeHtml(val.value || '')}</span>`;
    }
    if (val.file?.name) {
      const href = val.file.path || '';
      return `<a class="dataview-link" href="${escapeHtml(href)}">${escapeHtml(val.file.name)}</a>`;
    }
  }

  if (Array.isArray(val)) {
    return val.map(renderDvValue).join(', ');
  }

  return escapeHtml(String(val));
}

function parseDuration(raw: string): number {
  let totalMs = 0;
  let remaining = raw.trim();
  const durRe = /\s*(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s*/i;

  while (remaining.length > 0) {
    const m = remaining.match(durRe);
    if (!m) break;
    const amount = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (/^years?|yrs?|y$/.test(unit)) totalMs += amount * 365.25 * 24 * 60 * 60 * 1000;
    else if (/^months?|mos?$/.test(unit)) totalMs += amount * 30.4375 * 24 * 60 * 60 * 1000;
    else if (/^weeks?|w$/.test(unit)) totalMs += amount * 7 * 24 * 60 * 60 * 1000;
    else if (/^days?|d$/.test(unit)) totalMs += amount * 24 * 60 * 60 * 1000;
    else if (/^hours?|hrs?|h$/.test(unit)) totalMs += amount * 60 * 60 * 1000;
    else if (/^minutes?|mins?|m$/.test(unit)) totalMs += amount * 60 * 1000;
    else if (/^seconds?|secs?|s$/.test(unit)) totalMs += amount * 1000;
    remaining = remaining.slice(m[0].length);
  }

  return totalMs;
}

function formatDate(d: Date, format: string): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return format
    .replace('yyyy', String(d.getFullYear()))
    .replace('MM', pad(d.getMonth() + 1))
    .replace('dd', pad(d.getDate()))
    .replace('HH', pad(d.getHours()))
    .replace('mm', pad(d.getMinutes()))
    .replace('ss', pad(d.getSeconds()));
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
