/**
 * DQL Query Parser — parses Dataview Query Language strings into ParsedQuery AST.
 *
 * Grammar:
 *   query    → header fromClause? whereClause? sortClause? groupByClause? flattenClause? limitClause?
 *   header   → type (field (',' field)*)? ('WITHOUT' 'ID')?
 *   field    → expression ('AS' string)?
 *   type     → 'TABLE' | 'LIST' | 'TASK' | 'CALENDAR'
 */

import { ParsedQuery, QueryType, QueryHeader, FromSource, FromClause, SortField, Expression } from '../indexer/types';
import { parseExpression } from '../expression/parser';

// ─── Query Parser ─────────────────────────────────────────────────

export class QueryParser {
  private lines: string[] = [];
  private pos = 0;

  parse(query: string): ParsedQuery {
    // Handle multiline queries: strip code block markers if present
    let clean = query.trim();
    if (clean.startsWith('```')) {
      const lines = clean.split('\n');
      // Remove first and last line (code block markers)
      if (lines[0].trim().startsWith('```')) lines.shift();
      if (lines[lines.length - 1]?.trim() === '```') lines.pop();
      clean = lines.join('\n').trim();
    }

    this.lines = clean.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    this.pos = 0;

    const header = this.parseHeader();
    const from = this.parseFrom();
    const where = this.parseWhere();
    const sort = this.parseSort();
    const groupBy = this.parseGroupBy();
    const flattenArray = this.parseFlatten();
    const limit = this.parseLimit();

    return {
      header,
      from,
      where,
      sort,
      groupBy,
      flatten: flattenArray,
      limit,
    };
  }

  // ─── Header ──────────────────────────────────────────────────

  private parseHeader(): QueryHeader {
    if (this.pos >= this.lines.length) {
      return { type: 'table', withoutId: false };
    }

    const firstLine = this.lines[this.pos];
    const upper = firstLine.toUpperCase();

    // Determine query type
    let type: QueryType = 'table';
    let withoutId = false;

    for (const qType of ['TABLE', 'LIST', 'TASK', 'CALENDAR'] as const) {
      if (upper.startsWith(qType)) {
        type = qType.toLowerCase() as QueryType;
        break;
      }
    }

    // Check for WITHOUT ID
    if (upper.includes('WITHOUT ID')) {
      withoutId = true;
    }

    // Parse column definitions for TABLE
    let columns: { field: Expression; alias?: string }[] | undefined;

    if (type === 'table') {
      // Remove the type keyword and WITHOUT ID from parsing
      let columnStr = firstLine
        .replace(/^TABLE\s*/i, '')
        .replace(/\s*WITHOUT\s+ID\s*$/i, '')
        .trim();

      if (columnStr.length > 0) {
        columns = this.parseColumns(columnStr);
      }
    } else if (type === 'list') {
      // LIST can have one optional extra field
      let extraStr = firstLine
        .replace(/^LIST\s*/i, '')
        .replace(/\s*WITHOUT\s+ID\s*$/i, '')
        .trim();

      if (extraStr.length > 0 && !extraStr.toUpperCase().startsWith('FROM') && !extraStr.toUpperCase().startsWith('WHERE')) {
        columns = this.parseColumns(extraStr);
      }
    }

    this.pos++;
    return { type, columns, withoutId };
  }

  private parseColumns(raw: string): { field: Expression; alias?: string }[] {
    const columns: { field: Expression; alias?: string }[] = [];
    const parts = this.splitColumns(raw);

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Check for "field AS 'Alias'" or 'field AS "Alias"'
      const asMatch = trimmed.match(/^(.+?)\s+AS\s+["']?(.+?)["']?\s*$/i);
      if (asMatch) {
        const fieldExpr = parseExpression(asMatch[1].trim());
        const alias = asMatch[2].trim().replace(/^["']|["']$/g, '');
        columns.push({ field: fieldExpr, alias });
      } else {
        const fieldExpr = parseExpression(trimmed);
        columns.push({ field: fieldExpr });
      }
    }

    return columns;
  }

  private splitColumns(raw: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';

    for (const ch of raw) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }

    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  // ─── FROM ────────────────────────────────────────────────────

  private parseFrom(): FromClause | undefined {
    if (this.pos >= this.lines.length) return undefined;

    const line = this.lines[this.pos];
    if (!line.toUpperCase().startsWith('FROM ')) return undefined;

    const fromContent = line.slice(5).trim();
    this.pos++;

    const sources: FromSource[] = [];
    const operators: ('and' | 'or')[] = [];
    const negations: boolean[] = [];

    // Split by AND/OR while respecting parentheses
    const parts = this.splitByLogicalOp(fromContent, ['AND', 'OR']);
    let expectOp = false;

    for (const part of parts) {
      let trimmed = part.trim();
      if (!trimmed) continue;

      // Check for logical operators between parts
      if (expectOp) {
        const upper = trimmed.toUpperCase();
        if (upper === 'AND') {
          operators.push('and');
          expectOp = false;
          continue;
        }
        if (upper === 'OR') {
          operators.push('or');
          expectOp = false;
          continue;
        }
      }

      // Check for negation
      let negated = false;
      if (trimmed.startsWith('-')) {
        negated = true;
        trimmed = trimmed.slice(1).trim();
      }
      if (trimmed.toUpperCase().startsWith('NOT ')) {
        negated = true;
        trimmed = trimmed.slice(4).trim();
      }

      // Parse source type
      const source = this.parseSource(trimmed);
      if (source) {
        sources.push(source);
        negations.push(negated);
        expectOp = true;
      }
    }

    if (sources.length === 0) return undefined;
    return { sources, operators, negations };
  }

  private parseSource(raw: string): FromSource | null {
    // Remove surrounding parens
    let trimmed = raw.trim();
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      trimmed = trimmed.slice(1, -1).trim();
    }

    // Tag source: #tag
    if (trimmed.startsWith('#')) {
      return { type: 'tag', value: trimmed.slice(1) };
    }

    // String source: "folder/path" or "file.md"
    const stringMatch = trimmed.match(/^["'](.+?)["']$/);
    if (stringMatch) {
      const val = stringMatch[1];
      // If it looks like a file (has extension), treat as file source
      if (/\.[a-zA-Z0-9]+$/.test(val)) {
        return { type: 'file', value: val };
      }
      return { type: 'folder', value: val };
    }

    // Outgoing link: outgoing([[link]])
    const outgoingMatch = trimmed.match(/^outgoing\s*\((.+)\)$/i);
    if (outgoingMatch) {
      const inner = outgoingMatch[1].trim();
      const linkMatch = inner.match(/^\[\[(.+?)\]\]$/);
      if (linkMatch) {
        return { type: 'outgoingLink', value: linkMatch[1] };
      }
    }

    // Wikilink source: [[link]]
    const linkMatch = trimmed.match(/^\[\[(.+?)\]\]$/);
    if (linkMatch) {
      return { type: 'link', value: linkMatch[1] };
    }

    return null;
  }

  private splitByLogicalOp(input: string, ops: string[]): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';

    const tokens = this.tokenizeLogical(input, ops);

    for (const token of tokens) {
      if (depth === 0 && ops.includes(token.text.toUpperCase())) {
        if (current.trim()) parts.push(current.trim());
        parts.push(token.text.toUpperCase());
        current = '';
      } else {
        current += token.text + ' ';
        depth += token.depthChange;
      }
    }

    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  private tokenizeLogical(input: string, ops: string[]): { text: string; depthChange: number }[] {
    const tokens: { text: string; depthChange: number }[] = [];
    let current = '';
    let i = 0;

    while (i < input.length) {
      const ch = input[i];

      if (ch === '(') {
        if (current.trim()) { tokens.push({ text: current.trim(), depthChange: 0 }); current = ''; }
        tokens.push({ text: '(', depthChange: 1 });
        i++;
      } else if (ch === ')') {
        if (current.trim()) { tokens.push({ text: current.trim(), depthChange: 0 }); current = ''; }
        tokens.push({ text: ')', depthChange: -1 });
        i++;
      } else if (ch === ' ' || ch === '\t') {
        if (current.trim()) {
          // Check if current is a logical op
          const upper = current.trim().toUpperCase();
          if (ops.includes(upper)) {
            tokens.push({ text: upper, depthChange: 0 });
          } else {
            tokens.push({ text: current.trim(), depthChange: 0 });
          }
          current = '';
        }
        i++;
      } else {
        current += ch;
        i++;
      }
    }

    if (current.trim()) {
      const upper = current.trim().toUpperCase();
      if (ops.includes(upper)) {
        tokens.push({ text: upper, depthChange: 0 });
      } else {
        tokens.push({ text: current.trim(), depthChange: 0 });
      }
    }

    return tokens;
  }

  // ─── WHERE ───────────────────────────────────────────────────

  private parseWhere(): Expression | undefined {
    if (this.pos >= this.lines.length) return undefined;

    const line = this.lines[this.pos];
    if (!line.toUpperCase().startsWith('WHERE ')) return undefined;

    const whereExpr = line.slice(6).trim();
    this.pos++;

    try {
      return parseExpression(whereExpr);
    } catch (err) {
      console.warn('[Dataview] Failed to parse WHERE clause:', err);
      return undefined;
    }
  }

  // ─── SORT ────────────────────────────────────────────────────

  private parseSort(): SortField[] | undefined {
    if (this.pos >= this.lines.length) return undefined;

    const line = this.lines[this.pos];
    if (!line.toUpperCase().startsWith('SORT ')) return undefined;

    const sortContent = line.slice(5).trim();
    this.pos++;

    const fields: SortField[] = [];
    const parts = this.splitColumns(sortContent);

    for (const part of parts) {
      const trimmed = part.trim();
      let direction: 'asc' | 'desc' = 'asc';

      if (trimmed.toUpperCase().endsWith(' DESC')) {
        direction = 'desc';
      }

      const fieldStr = trimmed
        .replace(/\s+ASC\s*$/i, '')
        .replace(/\s+DESC\s*$/i, '')
        .trim();

      try {
        const field = parseExpression(fieldStr);
        fields.push({ field, direction });
      } catch (err) {
        console.warn('[Dataview] Failed to parse SORT field:', err);
      }
    }

    return fields.length > 0 ? fields : undefined;
  }

  // ─── GROUP BY ────────────────────────────────────────────────

  private parseGroupBy(): { field: Expression; alias?: string }[] | undefined {
    if (this.pos >= this.lines.length) return undefined;

    const line = this.lines[this.pos];
    if (!line.toUpperCase().startsWith('GROUP BY ')) return undefined;

    const content = line.slice(9).trim();
    this.pos++;

    const groups: { field: Expression; alias?: string }[] = [];
    const parts = this.splitColumns(content);

    for (const part of parts) {
      const trimmed = part.trim();
      const asMatch = trimmed.match(/^(.+?)\s+AS\s+["']?(.+?)["']?\s*$/i);
      if (asMatch) {
        groups.push({ field: parseExpression(asMatch[1].trim()), alias: asMatch[2].trim() });
      } else {
        groups.push({ field: parseExpression(trimmed) });
      }
    }

    return groups.length > 0 ? groups : undefined;
  }

  // ─── FLATTEN ─────────────────────────────────────────────────

  private parseFlatten(): { field: Expression; alias?: string }[] | undefined {
    if (this.pos >= this.lines.length) return undefined;

    const line = this.lines[this.pos];
    if (!line.toUpperCase().startsWith('FLATTEN ')) return undefined;

    const content = line.slice(8).trim();
    this.pos++;

    const items: { field: Expression; alias?: string }[] = [];
    const parts = this.splitColumns(content);

    for (const part of parts) {
      const trimmed = part.trim();
      const asMatch = trimmed.match(/^(.+?)\s+AS\s+["']?(.+?)["']?\s*$/i);
      if (asMatch) {
        items.push({ field: parseExpression(asMatch[1].trim()), alias: asMatch[2].trim() });
      } else {
        items.push({ field: parseExpression(trimmed) });
      }
    }

    return items.length > 0 ? items : undefined;
  }

  // ─── LIMIT ───────────────────────────────────────────────────

  private parseLimit(): number | undefined {
    if (this.pos >= this.lines.length) return undefined;

    const line = this.lines[this.pos];
    if (!line.toUpperCase().startsWith('LIMIT ')) return undefined;

    const limitStr = line.slice(6).trim();
    this.pos++;

    const num = parseInt(limitStr, 10);
    return isNaN(num) ? undefined : num;
  }
}

/** Convenience function to parse a DQL query string */
export function parseQuery(query: string): ParsedQuery {
  return new QueryParser().parse(query);
}
