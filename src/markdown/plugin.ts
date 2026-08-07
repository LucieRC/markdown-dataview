/**
 * Markdown-it plugin for Dataview integration.
 *
 * Intercepts ```dataview and ```dataviewjs code blocks,
 * executes the queries against the index, and generates
 * placeholder HTML elements with serialized results for
 * the preview scripts to render.
 */

import * as vscode from 'vscode';
import { IndexerService } from '../indexer/index';
import { QueryEngine } from '../query/engine';
import { parseQuery } from '../query/parser';
import { parseExpression } from '../expression/parser';
import { evaluate, valueToString, isDate, isDuration, isLink } from '../expression/evaluator';
import { DataValue, PageMetadata } from '../indexer/types';

export interface DataviewPluginConfig {
  enableJavascript: boolean;
  enableInlineQueries: boolean;
  warnOnEmptyResult: boolean;
  javascriptTrustedPaths: string[];
}

/**
 * Create a markdown-it plugin function for Dataview.
 *
 * @param indexer - The workspace page indexer
 * @param config - Plugin configuration
 * @returns A function that extends a markdown-it instance
 */
export function createDataviewPlugin(
  indexer: IndexerService,
  config: DataviewPluginConfig = {
    enableJavascript: false,
    enableInlineQueries: true,
    warnOnEmptyResult: true,
    javascriptTrustedPaths: [],
  }
): (md: any) => any {
  const engine = new QueryEngine(indexer);

  return function dataviewPlugin(md: any): any {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const rootPath = workspaceFolders?.[0]?.uri?.fsPath || '';

    function getCurrentPage(env: any): string {
      // 1. Try env.currentDocument._fsPath (actual VS Code property name)
      if (env?.currentDocument?._fsPath) {
        const p = env.currentDocument._fsPath;
        if (rootPath && p.startsWith(rootPath)) {
          return p.slice(rootPath.length).replace(/^[\\/]/, '');
        }
        return p;
      }
      // 2. Try env.resource.fsPath (older VS Code versions)
      if (env?.resource?.fsPath) {
        const p = env.resource.fsPath;
        if (rootPath && p.startsWith(rootPath)) {
          return p.slice(rootPath.length).replace(/^[\\/]/, '');
        }
        return p;
      }
      // 3. Fallback: query activeTextEditor LIVE
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && rootPath) {
        const p = activeEditor.document.uri.fsPath;
        if (p.startsWith(rootPath)) {
          return p.slice(rootPath.length).replace(/^[\\/]/, '');
        }
      }
      return '';
    }

    // ─── Inline field rendering ───────────────────────────────
    // [key:: value] → show only "value" styled as inline data
    // (key:: value) → completely hidden

    const inlineFieldRe = /^\[([\w\u4e00-\u9fff][\w\s\u4e00-\u9fff-]*)::\s*([^\]]+)\]/;
    const hiddenFieldRe = /^\(([\w\u4e00-\u9fff][\w\s\u4e00-\u9fff-]*)::\s*([^)]+)\)/;

    md.inline.ruler.before('escape', 'dataview_bracketed_field', (state: any, silent: boolean) => {
      const match = state.src.slice(state.pos).match(inlineFieldRe);
      if (!match) return false;
      if (!silent) {
        const token = state.push('html_inline', '', 0);
        token.content = '<span class="dataview-inline-field">' + escapeHtmlInline(match[2].trim()) + '</span>';
      }
      state.pos += match[0].length;
      return true;
    });

    md.inline.ruler.before('escape', 'dataview_hidden_field', (state: any, silent: boolean) => {
      const match = state.src.slice(state.pos).match(hiddenFieldRe);
      if (!match) return false;
      // Hidden field: consume the input but produce no output
      state.pos += match[0].length;
      return true;
    });

    // ─── Fence rendering ─────────────────────────────────────
    // Intercept code fence rendering
    const defaultFence = md.renderer.rules.fence || defaultFenceRenderer;

    md.renderer.rules.fence = (
      tokens: any[],
      idx: number,
      options: any,
      env: any,
      self: any
    ) => {
      const token = tokens[idx];
      const language = token.info?.trim().split(/\s+/)[0]?.toLowerCase() || '';
      const content = token.content;

      const currentPage = getCurrentPage(env);

      if (language === 'dataview') {
        return renderDataviewBlock(content, currentPage, engine, config);
      }

      if (language === 'dataviewjs' && config.enableJavascript) {
        // Check trusted paths
        const trusted = config.javascriptTrustedPaths || [];
        const isTrusted = trusted.length === 0 || trusted.some(p => currentPage.startsWith(p));
        return renderDataviewJSBlock(content, currentPage, indexer, isTrusted);
      }

      // Fall back to default rendering
      return defaultFence(tokens, idx, options, env, self);
    };

    // Handle inline expressions: `= expression`
    if (config.enableInlineQueries) {
      const defaultInline = md.renderer.rules.code_inline || defaultCodeInlineRenderer;

      md.renderer.rules.code_inline = (
        tokens: any[],
        idx: number,
        options: any,
        env: any,
        self: any
      ) => {
        const token = tokens[idx];
        const content = token.content;
        const currentPage = getCurrentPage(env);

        // Inline DQL: `= expression`
        if (content.startsWith('=') && !content.startsWith('==')) {
          const exprStr = content.slice(1).trim();
          return renderInlineExpression(exprStr, currentPage, indexer);
        }

        // Inline DataviewJS: `$= expression`
        if (content.startsWith('$=') && config.enableJavascript) {
          const exprStr = content.slice(2).trim();
          return renderInlineJSExpression(exprStr, currentPage, indexer);
        }

        return defaultInline(tokens, idx, options, env, self);
      };
    }

    return md;
  };
}

// ─── DQL Block Rendering ─────────────────────────────────────────

function renderDataviewBlock(
  content: string,
  currentPage: string,
  engine: QueryEngine,
  config: DataviewPluginConfig
): string {
  try {
    const query = parseQuery(content);
    const result = engine.execute(query);

    // Serialize result to JSON for the preview scripts
    const serialized = serializeQueryResult(result);
    serialized.currentPage = currentPage;
    const json = JSON.stringify(serialized);

    if (result.totalCount === 0 && config.warnOnEmptyResult) {
      return `<div class="dataview-result" data-result='${escapeHtml(json)}' data-type="${result.type}">
        <div class="dataview-empty">No results to show.</div>
      </div>`;
    }

    return `<div class="dataview-result" data-result='${escapeHtml(json)}' data-type="${result.type}"></div>`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `<div class="dataview-error">
      <strong>Dataview Error:</strong> ${escapeHtml(message)}
      <pre>${escapeHtml(content)}</pre>
    </div>`;
  }
}

// ─── DataviewJS Block Rendering ──────────────────────────────────

function renderDataviewJSBlock(
  content: string,
  currentPage: string,
  indexer: IndexerService,
  isTrusted: boolean
): string {
  // For DataviewJS, we pass the code to the preview scripts along with
  // serialized page data needed for execution.
  const pages = indexer.getAllPages();
  const serializedPages = pages.map(serializePageMetadata);
  const currentPageMeta = indexer.getPage(currentPage);

  const config = JSON.stringify({
    pages: serializedPages,
    currentPage: currentPage,
    currentPageMeta: currentPageMeta ? serializePageMetadata(currentPageMeta) : null,
  });

  const warning = !isTrusted
    ? '<div class="dataviewjs-warning">&#x26A0;&#xFE0F; <strong>Security Notice:</strong> DataviewJS is executing untrusted JavaScript from your notes. To trust files in specific folders, configure <code>dataview.javascriptTrustedPaths</code>.</div>'
    : '';

  return `<div class="dataviewjs-result" data-config='${escapeHtml(config)}'>
    ${warning}
    <pre class="dataviewjs-source" style="display:none">${escapeHtml(content)}</pre>
  </div>`;
}

// ─── Inline Expression Rendering ─────────────────────────────────

function renderInlineExpression(
  exprStr: string,
  currentPage: string,
  indexer: IndexerService
): string {
  try {
    const expr = parseExpression(exprStr);
    const page = indexer.getPage(currentPage);

    if (!page) {
      return `<span class="dataview-inline dataview-inline-error">(no page)</span>`;
    }

    // Build context: `this` refers to current page, `this.file` for file metadata
    const context: Record<string, any> = {
      this: page,
      ...page,
    };

    const result = evaluate(expr, context);
    const display = serializeValueForDisplay(result);

    return `<span class="dataview-inline">${escapeHtml(display)}</span>`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `<span class="dataview-inline dataview-inline-error" title="${escapeHtml(message)}">ERROR</span>`;
  }
}

function renderInlineJSExpression(
  exprStr: string,
  currentPage: string,
  indexer: IndexerService
): string {
  const page = indexer.getPage(currentPage);
  if (!page) {
    return `<span class="dataview-inline dataview-inline-error">(no page)</span>`;
  }

  const serialized = JSON.stringify({
    page: serializePageMetadata(page),
    expr: exprStr,
  });

  return `<span class="dataview-inline-js" data-js='${escapeHtml(serialized)}'></span>`;
}

// ─── Serialization for Preview Scripts ────────────────────────────

interface SerializedQueryResult {
  type: string;
  data: Record<string, any>[];
  columns?: { field: string; alias: string }[];
  withoutId: boolean;
  groups?: { key: any; rows: Record<string, any>[] }[];
  isGrouped: boolean;
  totalCount: number;
  currentPage?: string;
}

function serializeQueryResult(result: any): SerializedQueryResult {
  return {
    type: result.type,
    data: result.data.map((row: any) => serializeRow(row)),
    columns: result.columns,
    withoutId: result.withoutId,
    groups: result.groups?.map((g: any) => ({
      key: serializeValue(g.key),
      rows: g.rows.map((r: any) => serializeRow(r)),
    })),
    isGrouped: result.isGrouped,
    totalCount: result.totalCount,
  };
}

function serializeRow(row: Record<string, any>): Record<string, any> {
  const serialized: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === '_page') {
      serialized[key] = serializePageMetadata(value as PageMetadata);
    } else {
      serialized[key] = serializeValue(value);
    }
  }
  return serialized;
}

function serializePageMetadata(page: PageMetadata): Record<string, any> {
  return {
    file: {
      name: page.file.name,
      folder: page.file.folder,
      path: page.file.path,
      ext: page.file.ext,
      link: page.file.link,
      size: page.file.size,
      ctime: page.file.ctime,
      cday: page.file.cday,
      mtime: page.file.mtime,
      mday: page.file.mday,
      tags: page.file.tags,
      etags: page.file.etags,
      inlinks: page.file.inlinks,
      outlinks: page.file.outlinks,
      aliases: page.file.aliases,
      tasks: page.file.tasks.map(serializeTask),
      day: page.file.day,
    },
    // Also include frontmatter fields
    ...serializeFrontmatterFields(page),
  };
}

function serializeFrontmatterFields(page: PageMetadata): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [key, value] of Object.entries(page)) {
    if (key === 'file') continue;
    fields[key] = serializeValue(value);
  }
  return fields;
}

function serializeTask(task: any): Record<string, any> {
  return {
    status: task.status,
    checked: task.checked,
    completed: task.completed,
    text: task.text,
    lineNumber: task.lineNumber,
    path: task.path,
    tags: task.tags,
    due: task.due ? serializeValue(task.due) : undefined,
    completionDate: task.completionDate ? serializeValue(task.completionDate) : undefined,
    createdDate: task.createdDate ? serializeValue(task.createdDate) : undefined,
    startDate: task.startDate ? serializeValue(task.startDate) : undefined,
    scheduledDate: task.scheduledDate ? serializeValue(task.scheduledDate) : undefined,
  };
}

function serializeValue(value: DataValue): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (typeof value === 'object') {
    // Preserve type info for special types
    return value;
  }
  return String(value);
}

function serializeValueForDisplay(value: DataValue): string {
  if (value === null || value === undefined) return '-';
  if (isLink(value)) {
    const link = value as any;
    return link.display || link.path;
  }
  if (isDate(value)) {
    return (value as any).value || '';
  }
  if (isDuration(value)) {
    return formatDurationShort((value as any).value);
  }
  if (Array.isArray(value)) {
    return value.map(serializeValueForDisplay).join(', ');
  }
  return valueToString(value);
}

function formatDurationShort(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

// ─── Default Renderers ────────────────────────────────────────────

function defaultFenceRenderer(
  tokens: any[],
  idx: number,
  options: any,
  env: any,
  self: any
): string {
  return self.renderToken(tokens, idx, options);
}

function defaultCodeInlineRenderer(
  tokens: any[],
  idx: number,
  options: any,
  env: any,
  self: any
): string {
  return self.renderToken(tokens, idx, options);
}

// ─── Utilities ────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Lighter escape for inline HTML content (no quotes needed) */
function escapeHtmlInline(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
