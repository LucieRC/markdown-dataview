/**
 * Query Engine — executes parsed DQL queries against the page index.
 * Implements the full pipeline: FROM → WHERE → SORT → GROUP BY → FLATTEN → LIMIT.
 */

import {
  ParsedQuery,
  QueryResult,
  QueryResultRow,
  GroupedQueryResult,
  FromClause,
  FromSource,
  PageMetadata,
  DataValue,
  Expression,
  STask,
} from '../indexer/types';
import { IndexerService } from '../indexer/index';
import { evaluate, isTruthy, EvalContext } from '../expression/evaluator';
import { parseExpression } from '../expression/parser';

export class QueryEngine {
  constructor(private indexer: IndexerService) {}

  /**
   * Execute a parsed query against the index.
   */
  execute(query: ParsedQuery): QueryResult {
    const { header, from, where, sort, groupBy, flatten, limit } = query;

    // 1. Resolve source pages
    let pages = this.resolveSources(from);

    // 2. Convert pages to rows (page-level or task-level depending on query type)
    let rows = this.pagesToRows(pages, header.type);

    // 3. Apply WHERE filter
    if (where) {
      rows = rows.filter(row => {
        const result = evaluate(where, row);
        return isTruthy(result);
      });
    }

    // 4. Apply SORT
    if (sort && sort.length > 0) {
      rows = this.applySort(rows, sort);
    }

    // 5. Apply GROUP BY
    let groups: GroupedQueryResult[] | undefined;
    let isGrouped = false;

    if (groupBy && groupBy.length > 0) {
      const groupResult = this.applyGroupBy(rows, groupBy);
      rows = groupResult.rows;
      groups = groupResult.groups;
      isGrouped = true;
    }

    // 6. Apply FLATTEN
    if (flatten && flatten.length > 0) {
      rows = this.applyFlatten(rows, flatten);
    }

    // 7. Count total before limit
    const totalCount = rows.length;

    // 8. Apply LIMIT
    if (limit !== undefined && limit >= 0) {
      rows = rows.slice(0, limit);
    }

    // 9. Build column info and pre-compute column values
    let columns: { field: string; alias: string }[] | undefined;
    if (header.columns && header.columns.length > 0) {
      const colDefs: { field: Expression; alias?: string }[] = header.columns;
      columns = colDefs.map((col: { field: Expression; alias?: string }) => ({
        field: col.alias || expressionToFieldName(col.field),
        alias: col.alias || expressionToAlias(col.field),
      }));

      // Pre-compute column values for each row (handles function calls etc.)
      for (const row of rows) {
        for (const colDef of colDefs) {
          const colName = colDef.alias || expressionToFieldName(colDef.field);
          try {
            const value = evaluate(colDef.field, row);
            row[colName] = value;
          } catch {
            row[colName] = null;
          }
        }
        // For grouped rows: propagate pre-computed values to sub-rows
        if (isGrouped && (row as any).rows) {
          const rawRows = (row as any).rows;
          const rowsArr: any[] = Array.isArray(rawRows) ? rawRows : (rawRows?.values && Array.isArray(rawRows.values) ? rawRows.values : [rawRows]);
          for (const subRow of rowsArr) {
            for (const colDef of colDefs) {
              const colName = colDef.alias || expressionToFieldName(colDef.field);
              if (row[colName] !== undefined) {
                subRow[colName] = row[colName];
              }
            }
          }
        }
      }
    }

    return {
      type: header.type,
      data: rows,
      columns,
      withoutId: header.withoutId,
      groups,
      isGrouped,
      totalCount,
    };
  }

  // ─── Source Resolution ──────────────────────────────────────

  private resolveSources(from?: FromClause): PageMetadata[] {
    if (!from || from.sources.length === 0) {
      // No FROM clause → all pages
      return this.indexer.getAllPages();
    }

    // Resolve each source and combine
    const sourcePageSets: Set<PageMetadata>[] = from.sources.map((source, i) => {
      const pages = new Set(this.resolveSource(source));
      if (from.negations[i]) {
        // Negation: pages NOT in this source
        const allPages = new Set(this.indexer.getAllPages());
        for (const p of pages) allPages.delete(p);
        return allPages;
      }
      return pages;
    });

    // Apply operators (AND/OR) between adjacent sources
    let result = sourcePageSets[0];
    for (let i = 1; i < sourcePageSets.length; i++) {
      const op = from.operators[i - 1] || 'and';
      if (op === 'and') {
        result = this.intersectSets(result, sourcePageSets[i]);
      } else {
        result = this.unionSets(result, sourcePageSets[i]);
      }
    }

    return [...result];
  }

  private resolveSource(source: FromSource): PageMetadata[] {
    switch (source.type) {
      case 'tag':
        return this.indexer.getPagesByTag('#' + source.value);
      case 'folder':
        return this.indexer.getPagesByFolder(source.value);
      case 'file':
        return this.indexer.getPage(source.value) ? [this.indexer.getPage(source.value)!] : [];
      case 'link':
        return this.indexer.getInlinks(source.value);
      case 'outgoingLink': {
        // Pages linked FROM the specified page
        const page = this.indexer.getPage(source.value);
        if (!page) return [];
        return page.file.outlinks
          .map(l => this.indexer.getPage(l.path) || this.indexer.getPage(l.path + '.md'))
          .filter(Boolean) as PageMetadata[];
      }
      default:
        return [];
    }
  }

  private intersectSets(a: Set<PageMetadata>, b: Set<PageMetadata>): Set<PageMetadata> {
    const result = new Set<PageMetadata>();
    for (const item of a) {
      if (b.has(item)) result.add(item);
    }
    return result;
  }

  private unionSets(a: Set<PageMetadata>, b: Set<PageMetadata>): Set<PageMetadata> {
    const result = new Set(a);
    for (const item of b) result.add(item);
    return result;
  }

  // ─── Row Conversion ─────────────────────────────────────────

  private pagesToRows(pages: PageMetadata[], queryType: string): QueryResultRow[] {
    if (queryType === 'task') {
      // Flatten all tasks from all pages
      const rows: QueryResultRow[] = [];
      for (const page of pages) {
        for (const task of page.file.tasks) {
          rows.push(this.taskToRow(task, page));
        }
      }
      return rows;
    }

    // Default: one row per page
    return pages.map(page => this.pageToRow(page));
  }

  private pageToRow(page: PageMetadata): QueryResultRow {
    const row: QueryResultRow = {
      _page: page,
      ...page,
    };
    return row;
  }

  private taskToRow(task: STask, page: PageMetadata): QueryResultRow {
    const row: QueryResultRow = {
      _page: page,
      status: task.status,
      checked: task.checked,
      completed: task.completed,
      text: task.text,
      line: task.line,
      lineNumber: task.lineNumber,
      path: task.path,
      tags: task.tags,
      outlinks: task.outlinks,
      task: task.task,
      ...(task.due ? { due: task.due } : {}),
      ...(task.completionDate ? { completion: task.completionDate } : {}),
      ...(task.createdDate ? { created: task.createdDate } : {}),
      ...(task.startDate ? { start: task.startDate } : {}),
      ...(task.scheduledDate ? { scheduled: task.scheduledDate } : {}),
      // Also include page-level fields
      file: page.file,
    };
    return row;
  }

  // ─── Sort ───────────────────────────────────────────────────

  private applySort(rows: QueryResultRow[], sortFields: { field: Expression; direction: 'asc' | 'desc' }[]): QueryResultRow[] {
    return [...rows].sort((a, b) => {
      for (const { field, direction } of sortFields) {
        const va = evaluate(field, a);
        const vb = evaluate(field, b);
        const cmp = this.compareForSort(va, vb);
        if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  private compareForSort(a: DataValue, b: DataValue): number {
    if (a === null && b === null) return 0;
    if (a === null) return -1;
    if (b === null) return 1;

    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
    if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);

    // Date comparison
    if (typeof a === 'object' && typeof b === 'object' &&
        (a as any).type === 'date' && (b as any).type === 'date') {
      return (a as any).ts - (b as any).ts;
    }

    return String(a).localeCompare(String(b));
  }

  // ─── Group By ───────────────────────────────────────────────

  private applyGroupBy(
    rows: QueryResultRow[],
    groupFields: { field: Expression; alias?: string }[]
  ): { rows: QueryResultRow[]; groups: GroupedQueryResult[] } {
    const groups = new Map<string, QueryResultRow[]>();

    for (const row of rows) {
      const keys: string[] = [];
      for (const gf of groupFields) {
        const val = evaluate(gf.field, row);
        keys.push(JSON.stringify(val));
      }
      const key = keys.join('|||');

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(row);
    }

    const result: GroupedQueryResult[] = [];
    for (const [keyStr, groupRows] of groups) {
      // Parse back the key
      const keyValues = keyStr.split('|||').map(s => {
        try { return JSON.parse(s); } catch { return s; }
      });

      result.push({
        key: keyValues.length === 1 ? keyValues[0] : keyValues,
        rows: groupRows,
      });
    }

    // For grouped output, each group becomes a "row" with `key` and `rows` fields
    const groupedRows: QueryResultRow[] = result.map(g => {
      const firstRow = g.rows[0];
      const row: QueryResultRow = {
        _page: firstRow._page,
        key: g.key,
        rows: g.rows as unknown as DataValue,
      };

      // Copy fields from first row for display
      for (const [k, v] of Object.entries(firstRow)) {
        if (k !== 'key' && k !== 'rows') {
          row[k] = v;
        }
      }

      return row;
    });

    return { rows: groupedRows, groups: result };
  }

  // ─── Flatten ────────────────────────────────────────────────

  private applyFlatten(
    rows: QueryResultRow[],
    flattenFields: { field: Expression; alias?: string }[]
  ): QueryResultRow[] {
    let result = rows;

    for (const ff of flattenFields) {
      const flattened: QueryResultRow[] = [];

      for (const row of result) {
        const val = evaluate(ff.field, row);

        if (Array.isArray(val) && val.length > 0) {
          for (const item of val) {
            const newRow: QueryResultRow = {
              ...row,
              [ff.alias || expressionToFieldName(ff.field)]: item as DataValue,
            };
            flattened.push(newRow);
          }
        } else {
          // Non-array value: keep the row as-is
          flattened.push({
            ...row,
            [ff.alias || expressionToFieldName(ff.field)]: val,
          });
        }
      }

      result = flattened;
    }

    return result;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Convert an expression to a human-readable field name */
function expressionToFieldName(expr: Expression): string {
  if (expr.type === 'field') {
    return expr.path.join('.');
  }
  if (expr.type === 'literal') {
    return String(expr.value);
  }
  return expressionToAlias(expr);
}

/** Convert an expression to a display alias */
function expressionToAlias(expr: Expression): string {
  if (expr.type === 'field') {
    return expr.path[expr.path.length - 1] || 'field';
  }
  if (expr.type === 'literal') {
    return String(expr.value);
  }
  if (expr.type === 'functionCall') {
    return expr.name;
  }
  return 'value';
}
