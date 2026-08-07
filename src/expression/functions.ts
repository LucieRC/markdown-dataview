/**
 * Built-in functions for the DQL expression engine.
 * These mirror Obsidian Dataview's function library.
 */

import {
  DataValue,
  SDate,
  SDuration,
  SLink,
  formatLocalISO,
  formatLocalDate,
} from '../indexer/types';
import {
  EvalContext,
  toNumber,
  valueToString,
  isTruthy,
  valuesEqual,
  compareValues,
  isLink,
  isDate,
  isDuration,
} from './evaluator';

// ─── Function Registry ───────────────────────────────────────────

type BuiltinFunction = (args: DataValue[], context: EvalContext) => DataValue;

const functions: Map<string, BuiltinFunction> = new Map();

function register(name: string, fn: BuiltinFunction): void {
  functions.set(name.toLowerCase(), fn);
}

// ─── Constructor Functions ───────────────────────────────────────

register('date', (args) => {
  const arg = args[0];
  if (typeof arg === 'string' || typeof arg === 'number') {
    const d = new Date(typeof arg === 'string' ? arg : arg);
    if (!isNaN(d.getTime())) {
      return { type: 'date', value: formatLocalISO(d.getTime()), ts: d.getTime() } as SDate;
    }
  }
  return null;
});

register('dur', (args) => {
  const arg = args[0];
  if (typeof arg === 'string') {
    // Parse duration string like "1 day", "6 hours"
    return parseSimpleDuration(arg);
  }
  if (typeof arg === 'number') {
    return { type: 'duration', value: arg } as SDuration;
  }
  return null;
});

function parseSimpleDuration(raw: string): SDuration | null {
  let totalMs = 0;
  let remaining = raw.trim();
  const durRe = /\s*(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s*/i;

  while (remaining.length > 0) {
    const m = remaining.match(durRe);
    if (!m) break;
    const amount = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (/^years?|yrs?|y$/.test(unit)) { totalMs += amount * 365.25 * 24 * 60 * 60 * 1000; }
    else if (/^months?|mos?$/.test(unit)) { totalMs += amount * 30.4375 * 24 * 60 * 60 * 1000; }
    else if (/^weeks?|w$/.test(unit)) { totalMs += amount * 7 * 24 * 60 * 60 * 1000; }
    else if (/^days?|d$/.test(unit)) { totalMs += amount * 24 * 60 * 60 * 1000; }
    else if (/^hours?|hrs?|h$/.test(unit)) { totalMs += amount * 60 * 60 * 1000; }
    else if (/^minutes?|mins?|m$/.test(unit)) { totalMs += amount * 60 * 1000; }
    else if (/^seconds?|secs?|s$/.test(unit)) { totalMs += amount * 1000; }
    remaining = remaining.slice(m[0].length);
  }

  if (remaining.trim().length === 0) {
    return { type: 'duration', value: totalMs };
  }
  return null;
}

// ─── Type Checking ────────────────────────────────────────────────

register('typeof', (args) => {
  const val = args[0];
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'string') return 'string';
  if (typeof val === 'number') return 'number';
  if (typeof val === 'boolean') return 'boolean';
  if (isDate(val)) return 'date';
  if (isDuration(val)) return 'duration';
  if (isLink(val)) return 'link';
  if (Array.isArray(val)) return 'array';
  if (typeof val === 'object') return 'object';
  return 'null';
});

register('isnumber', (args) => typeof args[0] === 'number');
register('isstring', (args) => typeof args[0] === 'string');
register('isboolean', (args) => typeof args[0] === 'boolean');
register('isdate', (args) => isDate(args[0]));
register('isduration', (args) => isDuration(args[0]));
register('islink', (args) => isLink(args[0]));
register('isarray', (args) => Array.isArray(args[0]));
register('isobject', (args) => typeof args[0] === 'object' && !Array.isArray(args[0]) && !isLink(args[0]) && !isDate(args[0]) && !isDuration(args[0]));
register('isnull', (args) => args[0] === null || args[0] === undefined);

// ─── Constructor Extras ─────────────────────────────────────────

register('number', (args) => toNumber(args[0]));
register('string', (args) => valueToString(args[0]));

register('object', (args) => {
  const obj: Record<string, DataValue> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (i + 1 < args.length) {
      obj[valueToString(args[i])] = args[i + 1];
    }
  }
  return obj as DataValue;
});

register('link', (args) => {
  const path = valueToString(args[0]);
  const display = args.length > 1 ? valueToString(args[1]) : path;
  return { type: 'link', path, display, embed: false, subpath: '' } as SLink;
});

register('elinks', (args) => {
  const page = args[0];
  if (typeof page === 'object' && page !== null && !Array.isArray(page)) {
    const p = page as Record<string, DataValue>;
    const file = p['file'] as any;
    const outlinks = file?.outlinks;
    if (Array.isArray(outlinks)) return outlinks;
  }
  return [];
});

register('list', (args) => args);

// ─── Numeric Functions ────────────────────────────────────────────

register('round', (args) => Math.round(toNumber(args[0])));
register('floor', (args) => Math.floor(toNumber(args[0])));
register('ceil', (args) => Math.ceil(toNumber(args[0])));
register('abs', (args) => Math.abs(toNumber(args[0])));

register('min', (args) => {
  if (args.length === 0) return null;
  return Math.min(...args.map(toNumber));
});

register('max', (args) => {
  if (args.length === 0) return null;
  return Math.max(...args.map(toNumber));
});

register('sum', (args) => {
  const arr = args[0];
  if (Array.isArray(arr)) {
    return (arr as DataValue[]).reduce((s: number, v) => s + toNumber(v), 0);
  }
  return toNumber(arr);
});

register('average', (args) => {
  const arr = args[0];
  if (Array.isArray(arr) && arr.length > 0) {
    const sum = (arr as DataValue[]).reduce((s: number, v) => s + toNumber(v), 0);
    return sum / arr.length;
  }
  return null;
});

// ─── String Functions ─────────────────────────────────────────────

register('lower', (args) => valueToString(args[0]).toLowerCase());
register('upper', (args) => valueToString(args[0]).toUpperCase());
register('length', (args) => {
  const val = args[0];
  if (typeof val === 'string') return val.length;
  if (Array.isArray(val)) return val.length;
  return 0;
});

register('contains', (args) => {
  const str = valueToString(args[0]);
  const search = valueToString(args[1]);
  return str.includes(search);
});

register('startswith', (args) => {
  return valueToString(args[0]).startsWith(valueToString(args[1]));
});

register('endswith', (args) => {
  return valueToString(args[0]).endsWith(valueToString(args[1]));
});

register('regexmatch', (args) => {
  const str = valueToString(args[0]);
  const pattern = valueToString(args[1]);
  try {
    const re = new RegExp(pattern);
    return re.test(str);
  } catch {
    return false;
  }
});

register('replace', (args) => {
  const str = valueToString(args[0]);
  const search = valueToString(args[1]);
  const replacement = valueToString(args[2]);
  return str.split(search).join(replacement);
});

register('split', (args) => {
  const str = valueToString(args[0]);
  const delimiter = args.length > 1 ? valueToString(args[1]) : ',';
  return str.split(delimiter).map(s => s.trim()).filter(Boolean);
});

register('join', (args) => {
  const arr = args[0];
  const delimiter = args.length > 1 ? valueToString(args[1]) : ', ';
  if (Array.isArray(arr)) {
    return arr.map(valueToString).join(delimiter);
  }
  return valueToString(arr);
});

register('trim', (args) => valueToString(args[0]).trim());

register('truncate', (args) => {
  const str = valueToString(args[0]);
  const len = toNumber(args[1] || 100);
  const ellipsis = args.length > 2 ? valueToString(args[2]) : '...';
  if (str.length <= len) return str;
  return str.slice(0, len) + ellipsis;
});

register('padleft', (args) => {
  const str = valueToString(args[0]);
  const len = toNumber(args[1] || 0);
  const pad = args.length > 2 ? valueToString(args[2]) : ' ';
  return str.padStart(len, pad);
});

register('padright', (args) => {
  const str = valueToString(args[0]);
  const len = toNumber(args[1] || 0);
  const pad = args.length > 2 ? valueToString(args[2]) : ' ';
  return str.padEnd(len, pad);
});

register('substring', (args) => {
  const str = valueToString(args[0]);
  const start = toNumber(args[1] || 0);
  const end = args.length > 2 ? toNumber(args[2]) : undefined;
  return str.substring(start, end);
});

register('regexreplace', (args) => {
  const str = valueToString(args[0]);
  const pattern = valueToString(args[1]);
  const replacement = valueToString(args[2] || '');
  try {
    return str.replace(new RegExp(pattern, 'g'), replacement);
  } catch {
    return str;
  }
});

// ─── Object Functions ────────────────────────────────────────────

register('keys', (args) => {
  const obj = args[0];
  if (typeof obj === 'object' && obj !== null && !Array.isArray(obj) && !isLink(obj) && !isDate(obj)) {
    return Object.keys(obj as Record<string, unknown>);
  }
  return [];
});

register('values', (args) => {
  const obj = args[0];
  if (typeof obj === 'object' && obj !== null && !Array.isArray(obj) && !isLink(obj) && !isDate(obj)) {
    return Object.values(obj as Record<string, unknown>) as DataValue[];
  }
  return [];
});

register('entries', (args) => {
  const obj = args[0];
  if (typeof obj === 'object' && obj !== null && !Array.isArray(obj) && !isLink(obj) && !isDate(obj)) {
    return Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, v] as DataValue);
  }
  return [];
});

// ─── Math Extras ─────────────────────────────────────────────────

register('log', (args) => Math.log(toNumber(args[0])));
register('log10', (args) => Math.log10(toNumber(args[0])));
register('sqrt', (args) => Math.sqrt(toNumber(args[0])));
register('pow', (args) => Math.pow(toNumber(args[0]), toNumber(args[1] || 0)));
register('random', () => Math.random());
register('median', (args) => {
  const arr = args[0];
  if (Array.isArray(arr) && arr.length > 0) {
    const sorted = arr.map(toNumber).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }
  return null;
});

// ─── List Functions ───────────────────────────────────────────────

register('filter', (args) => {
  const arr = args[0];
  const predicate = args[1];
  if (Array.isArray(arr)) {
    if (typeof predicate === 'function') {
      return (arr as DataValue[]).filter((v, i) => isTruthy((predicate as Function)(v, i)));
    }
    return arr.filter(v => isTruthy(v));
  }
  return args[0];
});

register('map', (args) => {
  const arr = args[0];
  const fn = args[1];
  if (Array.isArray(arr) && typeof fn === 'function') {
    return (arr as DataValue[]).map((v, i) => (fn as Function)(v, i));
  }
  return args[0];
});

register('flat', (args) => {
  const arr = args[0];
  if (Array.isArray(arr)) {
    return (arr as any[]).flat(Infinity) as DataValue[];
  }
  return args[0];
});

register('extract', (args) => {
  const arr = args[0];
  const field = valueToString(args[1]);
  if (Array.isArray(arr)) {
    return (arr as DataValue[]).map(item => {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        return (item as Record<string, DataValue>)[field] ?? null;
      }
      return null;
    });
  }
  return [];
});

register('sort', (args) => {
  const arr = args[0];
  if (Array.isArray(arr)) {
    return [...(arr as DataValue[])].sort((a, b) => compareValues(a, b));
  }
  return args[0];
});

register('reverse', (args) => {
  const arr = args[0];
  if (Array.isArray(arr)) {
    return [...(arr as DataValue[])].reverse();
  }
  return args[0];
});

register('nonnull', (args) => {
  const arr = args[0];
  if (Array.isArray(arr)) {
    return (arr as DataValue[]).filter(v => v !== null && v !== undefined);
  }
  return args[0];
});

register('slice', (args) => {
  const arr = args[0];
  const start = toNumber(args[1] || 0);
  const end = args.length > 2 ? toNumber(args[2]) : undefined;
  if (Array.isArray(arr)) {
    return (arr as DataValue[]).slice(start, end);
  }
  return args[0];
});

register('any', (args) => {
  const arr = args[0];
  if (Array.isArray(arr)) {
    return arr.some(v => isTruthy(v));
  }
  return isTruthy(arr);
});

register('all', (args) => {
  const arr = args[0];
  if (Array.isArray(arr)) {
    return arr.every(v => isTruthy(v));
  }
  return isTruthy(arr);
});

register('none', (args) => {
  const arr = args[0];
  if (Array.isArray(arr)) {
    return !arr.some(v => isTruthy(v));
  }
  return !isTruthy(arr);
});

register('groupby', (args) => {
  const arr = args[0];
  const field = valueToString(args[1]);
  if (Array.isArray(arr)) {
    const groups = new Map<string, DataValue[]>();
    for (const item of arr) {
      let key: string;
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        key = valueToString((item as Record<string, DataValue>)[field]);
      } else {
        key = valueToString(item);
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    const result: DataValue[] = [];
    for (const [k, v] of groups) {
      result.push({ key: k, rows: v } as unknown as DataValue);
    }
    return result;
  }
  return [];
});

register('product', (args) => {
  const arr = args[0];
  if (Array.isArray(arr) && arr.length > 0) {
    return (arr as DataValue[]).reduce((p: number, v) => p * toNumber(v), 1);
  }
  return null;
});

// ─── Link / Meta Functions ────────────────────────────────────────

register('meta', (args) => {
  // meta(link) — get the page metadata for a link
  // This is a simplified version; actual implementation needs index context
  return args[0];
});

// ─── Date Functions ───────────────────────────────────────────────

register('dateformat', (args) => {
  const d = args[0];
  const format = valueToString(args[1] || 'yyyy-MM-dd');
  if (isDate(d)) {
    return formatDate((d as SDate).ts, format);
  }
  return valueToString(d);
});

register('dateadd', (args) => {
  const d = args[0];
  const dur = args[1];
  if (isDate(d) && isDuration(dur)) {
    const newTs = (d as SDate).ts + (dur as SDuration).value;
    const nd = new Date(newTs);
    return { type: 'date', value: formatLocalISO(newTs), ts: newTs } as SDate;
  }
  return null;
});

register('datestart', (args) => {
  const d = args[0];
  if (isDate(d)) {
    const nd = new Date((d as SDate).ts);
    nd.setHours(0, 0, 0, 0);
    return { type: 'date', value: formatLocalDate(nd.getTime()), ts: nd.getTime() } as SDate;
  }
  return null;
});

register('dateend', (args) => {
  const d = args[0];
  if (isDate(d)) {
    const nd = new Date((d as SDate).ts);
    nd.setHours(23, 59, 59, 999);
    return { type: 'date', value: formatLocalISO(nd.getTime()), ts: nd.getTime() } as SDate;
  }
  return null;
});

register('now', () => {
  const d = new Date();
  return { type: 'date', value: formatLocalISO(d.getTime()), ts: d.getTime() } as SDate;
});

register('tomorrow', () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return { type: 'date', value: formatLocalDate(d.getTime()), ts: d.getTime() } as SDate;
});

register('yesterday', () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return { type: 'date', value: formatLocalDate(d.getTime()), ts: d.getTime() } as SDate;
});

register('durformat', (args) => {
  const dur = args[0];
  if (isDuration(dur)) {
    return formatDurationLong((dur as SDuration).value);
  }
  return valueToString(dur);
});

register('currencyformat', (args) => {
  const amount = toNumber(args[0]);
  const currency = args.length > 1 ? valueToString(args[1]) : 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return currency + ' ' + amount.toFixed(2);
  }
});

// ─── Logic Extras ────────────────────────────────────────────────

register('if', (args) => {
  // if(condition, thenVal, elseVal)
  const condition = args[0];
  const thenVal = args[1];
  const elseVal = args[2];
  return isTruthy(condition) ? thenVal : elseVal;
});

// ─── Default / Coalesce ──────────────────────────────────────────

register('default', (args) => {
  for (const arg of args) {
    if (arg !== null && arg !== undefined && arg !== '') {
      return arg;
    }
  }
  return null;
});

register('choice', (args) => {
  // choice(bool, trueVal, falseVal)
  const condition = args[0];
  const trueVal = args[1];
  const falseVal = args[2];
  return isTruthy(condition) ? trueVal : falseVal;
});

register('striptime', (args) => {
  const d = args[0];
  if (isDate(d)) {
    const nd = new Date((d as SDate).ts);
    nd.setHours(0, 0, 0, 0);
    const formatted = nd.getFullYear() + '-' +
      String(nd.getMonth() + 1).padStart(2, '0') + '-' +
      String(nd.getDate()).padStart(2, '0');
    return { type: 'date', value: formatted, ts: nd.getTime() } as SDate;
  }
  return null;
});

// ─── Dispatch ────────────────────────────────────────────────────

export function evaluateFunction(
  name: string,
  args: DataValue[],
  context: EvalContext
): DataValue {
  const fn = functions.get(name.toLowerCase());
  if (!fn) {
    console.warn(`[Dataview] Unknown function: ${name}`);
    return null;
  }
  try {
    return fn(args, context);
  } catch (err) {
    console.warn(`[Dataview] Error evaluating ${name}:`, err);
    return null;
  }
}

/** List all available function names */
export function getAvailableFunctions(): string[] {
  return [...functions.keys()];
}

// ─── Date Formatting Utility ──────────────────────────────────────

function formatDate(ts: number, format: string): string {
  const d = new Date(ts);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');

  return format
    .replace('yyyy', String(d.getFullYear()))
    .replace('yy', String(d.getFullYear()).slice(-2))
    .replace('MMMM', d.toLocaleString('en', { month: 'long' }))
    .replace('MMM', d.toLocaleString('en', { month: 'short' }))
    .replace('MM', pad(d.getMonth() + 1))
    .replace('M', String(d.getMonth() + 1))
    .replace('dddd', d.toLocaleString('en', { weekday: 'long' }))
    .replace('ddd', d.toLocaleString('en', { weekday: 'short' }))
    .replace('dd', pad(d.getDate()))
    .replace('d', String(d.getDate()))
    .replace('HH', pad(d.getHours()))
    .replace('hh', pad(d.getHours() % 12 || 12))
    .replace('ss', pad(d.getSeconds()))
    .replace('a', d.getHours() >= 12 ? 'PM' : 'AM');
}

/** Format milliseconds as a long human-readable duration */
function formatDurationLong(ms: number): string {
  if (ms <= 0) return '0 seconds';
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60000) % 60;
  const hours = Math.floor(ms / 3600000) % 24;
  const days = Math.floor(ms / 86400000);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
  return parts.join(', ');
}
