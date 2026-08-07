/**
 * Core data types for the Dataview indexer and query engine.
 * These mirror Obsidian Dataview's data model.
 */

// ─── Primitive Value Types ───────────────────────────────────────

export interface SLink {
  type: 'link';
  /** The target path (e.g., "Folder/Note.md") */
  path: string;
  /** Display text for the link */
  display: string;
  /** Whether this is an embedded link */
  embed: boolean;
  /** Sub-path / heading anchor */
  subpath: string;
}

export interface SDate {
  type: 'date';
  /** ISO 8601 string representation */
  value: string;
  /** Milliseconds since epoch */
  ts: number;
}

/** Format a timestamp as a local-time string (YYYY-MM-DD HH:mm:ss) */
export function formatLocalISO(ts: number): string {
  const d = new Date(ts);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0') + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0') + ':' +
    String(d.getSeconds()).padStart(2, '0');
}

/** Format a timestamp as a local date string (YYYY-MM-DD) */
export function formatLocalDate(ts: number): string {
  const d = new Date(ts);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

export interface SDuration {
  type: 'duration';
  /** Total duration in milliseconds */
  value: number;
}

/** All possible field value types in Dataview */
export type LiteralType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'duration'
  | 'link'
  | 'array'
  | 'object'
  | 'null'
  | 'function';

export type PrimitiveValue = string | number | boolean | null;
export type DataValue =
  | PrimitiveValue
  | SLink
  | SDate
  | SDuration
  | DataValue[]
  | { [key: string]: DataValue };

// ─── Page & Task Metadata ────────────────────────────────────────

/** Represents a single task item `- [<status>] <text>` */
export interface STask {
  /** The status character (e.g., ' ', 'x', '/') */
  status: string;
  /** Whether the task is checked (status is non-empty) */
  checked: boolean;
  /** Whether the task is completed (status === 'x' or 'X') */
  completed: boolean;
  /** Task text (with metadata stripped for display) */
  text: string;
  /** Raw line content */
  line: string;
  /** 0-based line number in the source file */
  lineNumber: number;
  /** Path to the containing file */
  path: string;
  /** Tags found in the task text */
  tags: string[];
  /** Links found in the task text */
  outlinks: SLink[];
  /** Subtasks (children) */
  children: STask[];
  /** Whether this item is a task (true) or plain list item (false) */
  task: boolean;
  /** Optional due date (from 🗓️ emoji shorthand) */
  due?: SDate;
  /** Optional completion date (from ✅ emoji shorthand) */
  completionDate?: SDate;
  /** Optional created date (from ➕ emoji shorthand) */
  createdDate?: SDate;
  /** Optional start date (from 🛫 emoji shorthand) */
  startDate?: SDate;
  /** Optional scheduled date (from ⏳ emoji shorthand) */
  scheduledDate?: SDate;
  /** Block ID (^block-id) if present */
  blockId?: string;
}

/** Represents all metadata for a single page (markdown file) */
export interface PageMetadata {
  /** File implicit fields — grouped under `file` */
  file: {
    /** File name without extension */
    name: string;
    /** Folder path relative to workspace root */
    folder: string;
    /** Full path relative to workspace root */
    path: string;
    /** File extension (e.g., "md") */
    ext: string;
    /** Clickable link to this file */
    link: SLink;
    /** File size in bytes */
    size: number;
    /** Creation time */
    ctime: SDate;
    /** Creation date (no time component) */
    cday: SDate;
    /** Last modified time */
    mtime: SDate;
    /** Last modified date (no time component) */
    mday: SDate;
    /** All unique tags in the file (including subtag breakdowns) */
    tags: string[];
    /** Explicit tags only (no subtag breakdown) */
    etags: string[];
    /** Incoming links (files that link TO this file) */
    inlinks: SLink[];
    /** Outgoing links (files that this file links TO) */
    outlinks: SLink[];
    /** YAML frontmatter aliases */
    aliases: string[];
    /** All tasks in the file */
    tasks: STask[];
    /** All list items in the file (including tasks) */
    lists: STask[];
    /** Raw frontmatter key-value pairs */
    frontmatter: Record<string, DataValue>;
    /** Date extracted from filename (YYYY-MM-DD or YYYYMMDD) */
    day?: SDate;
  };

  /** All frontmatter and inline fields accessible directly on the page */
  [key: string]: any;
}

// ─── Index Types ─────────────────────────────────────────────────

/** Full index of all pages in the workspace */
export interface PageIndex {
  /** Map from normalized path to page metadata */
  pages: Map<string, PageMetadata>;
  /** Tag → set of page paths */
  tags: Map<string, Set<string>>;
  /** Inlink tracking: path → set of paths that link to it */
  inlinks: Map<string, Set<string>>;
}

// ─── Expression AST Types ────────────────────────────────────────

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '>' | '<' | '>=' | '<=' | '=' | '!=' | '&' | '|';

export interface ExprField {
  type: 'field';
  path: string[];
}

export interface ExprLiteral {
  type: 'literal';
  value: DataValue;
}

export interface ExprBinaryOp {
  type: 'binaryOp';
  left: Expression;
  op: BinaryOp;
  right: Expression;
}

export interface ExprUnaryOp {
  type: 'unaryOp';
  op: '-' | '!';
  operand: Expression;
}

export interface ExprFunctionCall {
  type: 'functionCall';
  name: string;
  args: Expression[];
}

export interface ExprIndex {
  type: 'index';
  target: Expression;
  index: Expression;
}

export type Expression =
  | ExprField
  | ExprLiteral
  | ExprBinaryOp
  | ExprUnaryOp
  | ExprFunctionCall
  | ExprIndex;

// ─── Query AST Types ─────────────────────────────────────────────

export type QueryType = 'table' | 'list' | 'task' | 'calendar';

export type SourceType = 'tag' | 'folder' | 'file' | 'link' | 'outgoingLink';

export interface FromSource {
  type: SourceType;
  value: string;
  /** For outgoing links: the page whose outgoing links we follow */
  page?: string;
}

export interface FromClause {
  sources: FromSource[];
  /** Logical operators connecting sources: 'and' | 'or' */
  operators: ('and' | 'or')[];
  /** Negation flags for each source */
  negations: boolean[];
}

export interface SortField {
  field: Expression;
  direction: 'asc' | 'desc';
}

export interface QueryHeader {
  type: QueryType;
  /** Column definitions for TABLE queries */
  columns?: { field: Expression; alias?: string }[];
  /** Whether to hide the default file column (TABLE/LIST without ID) */
  withoutId: boolean;
}

export interface ParsedQuery {
  header: QueryHeader;
  from?: FromClause;
  where?: Expression;
  sort?: SortField[];
  groupBy?: { field: Expression; alias?: string }[];
  flatten?: { field: Expression; alias?: string }[];
  limit?: number;
}

// ─── Query Result Types ──────────────────────────────────────────

export interface QueryResultRow {
  [key: string]: any;
  /** The source page for this row */
  _page: PageMetadata;
}

export interface GroupedQueryResult {
  key: DataValue;
  rows: QueryResultRow[];
}

export interface QueryResult {
  type: QueryType;
  /** For TABLE queries: the result rows */
  data: QueryResultRow[];
  /** Column definitions for TABLE */
  columns?: { field: string; alias: string }[];
  /** Whether to hide the file column */
  withoutId: boolean;
  /** For grouped results */
  groups?: GroupedQueryResult[];
  /** Whether the result is grouped */
  isGrouped: boolean;
  /** Total count before limit */
  totalCount: number;
}
