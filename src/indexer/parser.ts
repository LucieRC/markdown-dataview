/**
 * Markdown metadata parser — extracts frontmatter, inline fields,
 * tags, tasks, links, and other Dataview metadata from raw markdown text.
 */

import matter from 'gray-matter';
import { SLink, SDate, SDuration, DataValue, STask, PageMetadata, formatLocalISO, formatLocalDate } from './types';

// ─── Regex Patterns ──────────────────────────────────────────────

/** Matches YAML frontmatter delimiters: --- at start and end */
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/;

/** Matches wikilinks: [[target]] or [[target|display]] or [[target#heading]] */
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g;

/** Matches markdown links: [text](url) */
const MDLINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

/** Matches tags: #tag, #tag/subtag (not inside code blocks or URLs) */
const TAG_RE = /(?:^|\s)#([a-zA-Z\u4e00-\u9fff_/][a-zA-Z0-9\u4e00-\u9fff_/-]*)/g;

/** Strip fenced code blocks from text to avoid false tag/link extraction */
function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

/** Matches inline fields: Key:: Value or [Key:: Value] or (Key:: Value) */
const INLINE_FIELD_STANDALONE_RE = /^\s*([\w\u4e00-\u9fff][\w\s\u4e00-\u9fff-]*)::\s*(.+)$/;

/** Matches bracketed inline fields: [key:: value] */
const INLINE_FIELD_BRACKETED_RE = /\[([\w\u4e00-\u9fff][\w\s\u4e00-\u9fff-]*)::\s*([^\]]+)\]/g;

/** Matches parenthesized (hidden) inline fields: (key:: value) */
const INLINE_FIELD_PAREN_RE = /\(([\w\u4e00-\u9fff][\w\s\u4e00-\u9fff-]*)::\s*([^)]+)\)/g;

/** Matches task items: - [<status>] <text> */
const TASK_RE = /^(\s*)[-*+]\s+\[(.)\]\s+(.+)$/;

/** Matches list items (including tasks) */
const LIST_RE = /^(\s*)[-*+]\s+(?:\[.\]?\s+)?(.+)$/;

/** Matches block IDs: ^block-id at end of line */
const BLOCK_ID_RE = /\^([a-zA-Z0-9-]+)\s*$/;

/** Task emoji shorthand patterns */
const TASK_EMOJI_PATTERNS: [RegExp, string][] = [
  [/🗓️\s*(\d{4}-\d{2}-\d{2})/g, 'due'],
  [/✅\s*(\d{4}-\d{2}-\d{2})/g, 'completion'],
  [/➕\s*(\d{4}-\d{2}-\d{2})/g, 'created'],
  [/🛫\s*(\d{4}-\d{2}-\d{2})/g, 'start'],
  [/⏳\s*(\d{4}-\d{2}-\d{2})/g, 'scheduled'],
];

/** Matches date from filename: YYYY-MM-DD or YYYYMMDD */
const FILENAME_DATE_RE = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/;

// ─── Helper Functions ────────────────────────────────────────────

/** Create an SLink from a wikilink target */
function makeLink(path: string, display?: string, subpath?: string, embed = false): SLink {
  return {
    type: 'link',
    path: path.trim(),
    display: display?.trim() || path.trim(),
    embed,
    subpath: subpath?.trim() || '',
  };
}

/** Create an SDate from a timestamp (milliseconds) */
function makeDate(ts: number): SDate {
  return {
    type: 'date',
    value: formatLocalISO(ts),
    ts,
  };
}

/** Create an SDate from a date string, stripping time component */
function makeDateOnly(ts: number): SDate {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return {
    type: 'date',
    value: formatLocalDate(ts),
    ts: d.getTime(),
  };
}

/** Normalize a field key: lowercase, spaces → dashes, strip formatting */
function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[*_~`]/g, '')   // strip markdown formatting
    .replace(/\s+/g, '-')      // spaces → dashes
    .replace(/-+/g, '-')       // collapse multiple dashes
    .replace(/^-|-$/g, '');    // trim leading/trailing dashes
}

/** Parse a value string into the appropriate DataValue type */
function parseValue(raw: string): DataValue {
  const trimmed = raw.trim();

  // Boolean
  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === 'true';
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return parseFloat(trimmed);
  }

  // Wikilink (single link)
  const linkMatch = trimmed.match(/^\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]$/);
  if (linkMatch) {
    return makeLink(linkMatch[1], linkMatch[3], linkMatch[2]);
  }

  // Comma-separated list of links
  if (/^\[\[.*\]\](?:,\s*\[\[.*\]\])*$/.test(trimmed)) {
    const links: SLink[] = [];
    const re = /\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(trimmed)) !== null) {
      links.push(makeLink(m[1], m[3], m[2]));
    }
    return links;
  }

  // Date: YYYY-MM-DD or ISO
  const dateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?))?$/);
  if (dateMatch) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return { type: 'date', value: trimmed, ts: d.getTime() };
    }
  }

  // Duration: "6 hours", "4min", "9 yrs 8 min"
  const durResult = parseDuration(trimmed);
  if (durResult !== null) {
    return durResult;
  }

  return trimmed;
}

/** Parse a duration string like "6 hours" or "4 min" into SDuration */
function parseDuration(raw: string): SDuration | null {
  const durRe = /^\s*(\d+)\s*(years?|yrs?|y|months?|mos?|weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s*$/i;
  let remaining = raw.trim();
  let totalMs = 0;

  if (/^\s*\d/.test(remaining)) {
    let matchCount = 0;
    while (remaining.length > 0) {
      const m = remaining.match(durRe);
      if (!m) break;
      const amount = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      totalMs += durationUnitToMs(amount, unit);
      remaining = remaining.slice(m[0].length);
      matchCount++;
    }
    if (matchCount > 0 && remaining.trim().length === 0) {
      return { type: 'duration', value: totalMs };
    }
  }

  return null;
}

function durationUnitToMs(amount: number, unit: string): number {
  if (/^years?|yrs?|y$/.test(unit)) return amount * 365.25 * 24 * 60 * 60 * 1000;
  if (/^months?|mos?$/.test(unit)) return amount * 30.4375 * 24 * 60 * 60 * 1000;
  if (/^weeks?|w$/.test(unit)) return amount * 7 * 24 * 60 * 60 * 1000;
  if (/^days?|d$/.test(unit)) return amount * 24 * 60 * 60 * 1000;
  if (/^hours?|hrs?|h$/.test(unit)) return amount * 60 * 60 * 1000;
  if (/^minutes?|mins?|m$/.test(unit)) return amount * 60 * 1000;
  if (/^seconds?|secs?|s$/.test(unit)) return amount * 1000;
  return 0;
}

/** Extract all wikilinks from text */
function extractLinks(text: string): SLink[] {
  const links: SLink[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    const key = m[1].trim();
    if (!seen.has(key)) {
      seen.add(key);
      links.push(makeLink(m[1], m[3], m[2]));
    }
  }
  return links;
}

/** Extract all tags from text, including subtag breakdowns */
function extractTags(text: string): { tags: string[]; etags: string[] } {
  const allTags = new Set<string>();
  const explicitOnly = new Set<string>();
  const re = new RegExp(TAG_RE.source, 'g');
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const fullTag = '#' + m[1];
    explicitOnly.add(fullTag);

    // Add subtag breakdown: #a/b/c → [#a, #a/b, #a/b/c]
    const parts = m[1].split('/');
    for (let i = 0; i < parts.length; i++) {
      allTags.add('#' + parts.slice(0, i + 1).join('/'));
    }
  }

  return {
    tags: [...allTags],
    etags: [...explicitOnly],
  };
}

/** Parse task items from markdown body (after frontmatter removal) */
function parseTasks(body: string, filePath: string): { tasks: STask[]; allLists: STask[] } {
  const lines = body.split('\n');
  const tasks: STask[] = [];
  const allLists: STask[] = [];
  const stack: { indent: number; task: STask }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this is a list item
    const taskMatch = line.match(TASK_RE);
    const listMatch = line.match(LIST_RE);

    if (taskMatch || listMatch) {
      const indent = (taskMatch?.[1] || listMatch![1]).length;
      const isTask = !!taskMatch;
      const status = taskMatch?.[2] || '';
      const text = (taskMatch?.[3] || listMatch![2]).trim();

      // Extract block ID
      let blockId: string | undefined;
      const blockMatch = text.match(BLOCK_ID_RE);
      if (blockMatch) {
        blockId = blockMatch[1];
      }

      // Extract emoji shorthands
      const emojiDates: Record<string, SDate | undefined> = {};
      if (isTask) {
        for (const [pattern, key] of TASK_EMOJI_PATTERNS) {
          const em = new RegExp(pattern.source, 'g').exec(text);
          if (em) {
            const d = new Date(em[1]);
            if (!isNaN(d.getTime())) {
              emojiDates[key] = { type: 'date', value: em[1], ts: d.getTime() };
            }
          }
        }
      }

      // Extract tags and links from task text
      const { tags: taskTags } = extractTags(text);
      const taskLinks = extractLinks(text);

      const task: STask = {
        status,
        checked: status !== ' ' && status !== '',
        completed: status === 'x' || status === 'X',
        text: text.replace(BLOCK_ID_RE, '').trim(),
        line,
        lineNumber: i,
        path: filePath,
        tags: taskTags,
        outlinks: taskLinks,
        children: [],
        task: isTask,
        ...emojiDates,
        blockId,
      };

      // Handle nesting: find parent based on indentation
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      if (stack.length > 0) {
        stack[stack.length - 1].task.children.push(task);
      }

      stack.push({ indent, task });

      allLists.push(task);
      if (isTask) {
        tasks.push(task);
      }
    } else {
      // Non-list line breaks the list nesting
      stack.length = 0;
    }
  }

  // Return only top-level tasks and list items for the file-level metadata
  return {
    tasks: tasks.filter(t => !allLists.some(l => l.children.includes(t))),
    allLists: allLists.filter(l => !allLists.some(other => other.children.includes(l))),
  };
}

// ─── Main Parser ─────────────────────────────────────────────────

export interface ParsedPage {
  metadata: PageMetadata;
  body: string; // markdown body without frontmatter
}

/**
 * Parse a single markdown file's content into PageMetadata.
 *
 * @param content - Raw markdown file content
 * @param filePath - Relative path to the file in the workspace
 * @param stat - File stat (for ctime, mtime, size)
 */
export function parseMarkdownPage(
  content: string,
  filePath: string,
  stat: { ctimeMs: number; mtimeMs: number; size: number }
): ParsedPage {
  // Parse frontmatter with gray-matter
  const parsed = matter(content);
  const frontmatter: Record<string, DataValue> = {};
  const rawFrontmatter: Record<string, DataValue> = {};

  // Process frontmatter values
  if (parsed.data && typeof parsed.data === 'object') {
    for (const [key, val] of Object.entries(parsed.data)) {
      const processed = processYamlValue(val);
      rawFrontmatter[key] = processed;
      // Flatten nested objects with dot notation
      if (processed !== null && typeof processed === 'object' && !Array.isArray(processed) && !('type' in processed)) {
        for (const [subKey, subVal] of Object.entries(processed)) {
          frontmatter[key + '.' + subKey] = subVal as DataValue;
        }
        frontmatter[key] = processed as DataValue;
      } else {
        frontmatter[key] = processed;
      }
    }
  }

  // Extract body (content without frontmatter)
  const body = parsed.content;

  // Parse inline fields from body
  const inlineFields = parseInlineFields(body);
  Object.assign(frontmatter, inlineFields);

  // Extract tags from content (excluding code blocks to avoid false positives)
  const { tags, etags } = extractTags(stripCodeBlocks(content));

  // Also extract tags from frontmatter `tags` field
  if (frontmatter['tags']) {
    const fmTags = frontmatter['tags'];
    if (typeof fmTags === 'string') {
      const splitTags = fmTags.split(/[,;\s]+/).filter(Boolean);
      for (const t of splitTags) {
        const tag = t.startsWith('#') ? t : '#' + t;
        etags.push(tag);
        // Subtag breakdown
        const parts = tag.slice(1).split('/');
        for (let i = 0; i < parts.length; i++) {
          const subTag = '#' + parts.slice(0, i + 1).join('/');
          if (!tags.includes(subTag)) tags.push(subTag);
        }
      }
    } else if (Array.isArray(frontmatter['tags'])) {
      for (const t of frontmatter['tags'] as DataValue[]) {
        if (typeof t === 'string') {
          const tag = t.startsWith('#') ? t : '#' + t;
          etags.push(tag);
          const parts = tag.slice(1).split('/');
          for (let i = 0; i < parts.length; i++) {
            const subTag = '#' + parts.slice(0, i + 1).join('/');
            if (!tags.includes(subTag)) tags.push(subTag);
          }
        }
      }
    }
  }

  // Extract links from body
  const outlinks = extractLinks(body);

  // Extract aliases from frontmatter
  const aliases: string[] = [];
  const aliasVal = frontmatter['aliases'] || frontmatter['alias'];
  if (typeof aliasVal === 'string') {
    aliases.push(aliasVal);
  } else if (Array.isArray(aliasVal)) {
    for (const a of aliasVal) {
      if (typeof a === 'string') aliases.push(a);
    }
  }

  // Parse tasks
  const { tasks, allLists } = parseTasks(body, filePath);

  // Extract filename information
  const pathParts = filePath.replace(/\\/g, '/').split('/');
  const fileName = pathParts[pathParts.length - 1];
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');
  const ext = fileName.split('.').pop() || 'md';
  const folder = pathParts.slice(0, -1).join('/') || '/';

  // Try to extract date from filename
  let fileDay: SDate | undefined;
  const dayMatch = nameWithoutExt.match(FILENAME_DATE_RE);
  if (dayMatch) {
    const d = new Date(
      parseInt(dayMatch[1]),
      parseInt(dayMatch[2]) - 1,
      parseInt(dayMatch[3])
    );
    if (!isNaN(d.getTime())) {
      fileDay = { type: 'date', value: formatLocalDate(d.getTime()), ts: d.getTime() };
    }
  }

  // Build page metadata
  const pageMetadata: PageMetadata = {
    file: {
      name: nameWithoutExt,
      folder,
      path: filePath,
      ext,
      link: makeLink(filePath, nameWithoutExt),
      size: stat.size,
      ctime: makeDate(stat.ctimeMs),
      cday: makeDateOnly(stat.ctimeMs),
      mtime: makeDate(stat.mtimeMs),
      mday: makeDateOnly(stat.mtimeMs),
      tags: [...new Set(tags)],
      etags: [...new Set(etags)],
      inlinks: [],
      outlinks,
      aliases,
      tasks,
      lists: allLists,
      frontmatter: rawFrontmatter,
      day: fileDay,
    },
    ...frontmatter,
  };

  return { metadata: pageMetadata, body };
}

/** Process a value from YAML frontmatter into DataValue */
function processYamlValue(val: unknown): DataValue {
  if (val === null || val === undefined) {
    return null;
  }

  if (typeof val === 'string') {
    return parseValue(val);
  }

  if (typeof val === 'number' || typeof val === 'boolean') {
    return val;
  }

  if (val instanceof Date) {
    const d = val as Date;
    return {
      type: 'date',
      value: formatLocalISO(d.getTime()),
      ts: d.getTime(),
    };
  }

  if (Array.isArray(val)) {
    return val.map(processYamlValue) as DataValue[];
  }

  if (typeof val === 'object') {
    const obj: Record<string, DataValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      obj[k] = processYamlValue(v);
    }
    return obj as DataValue;
  }

  return String(val);
}

/** Parse inline fields from markdown body */
function parseInlineFields(body: string): Record<string, DataValue> {
  const fields: Record<string, DataValue> = {};
  const lines = body.split('\n');

  for (const line of lines) {
    // Standalone inline field: Key:: Value
    const standaloneMatch = line.match(INLINE_FIELD_STANDALONE_RE);
    if (standaloneMatch) {
      const key = normalizeKey(standaloneMatch[1]);
      fields[key] = parseValue(standaloneMatch[2]);
      continue;
    }
  }

  // Bracketed inline fields: can appear anywhere in text
  let m: RegExpExecArray | null;
  const bracketedRe = new RegExp(INLINE_FIELD_BRACKETED_RE.source, 'g');
  while ((m = bracketedRe.exec(body)) !== null) {
    const key = normalizeKey(m[1]);
    fields[key] = parseValue(m[2]);
  }

  // Parenthesized (hidden) inline fields
  const parenRe = new RegExp(INLINE_FIELD_PAREN_RE.source, 'g');
  while ((m = parenRe.exec(body)) !== null) {
    const key = normalizeKey(m[1]);
    fields[key] = parseValue(m[2]);
  }

  return fields;
}
