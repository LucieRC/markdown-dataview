/**
 * Expression evaluator — evaluates an AST against a context object
 * (typically a page's metadata) to produce a DataValue.
 */

import {
  Expression,
  ExprField,
  ExprLiteral,
  ExprBinaryOp,
  ExprUnaryOp,
  ExprFunctionCall,
  ExprIndex,
  BinaryOp,
  DataValue,
  SLink,
  SDate,
  SDuration,
  PageMetadata,
} from '../indexer/types';
import { evaluateFunction } from './functions';

/** Context for expression evaluation — typically a row/page object */
export type EvalContext = Record<string, DataValue>;

/**
 * Evaluate an expression AST against a context.
 */
export function evaluate(expr: Expression, context: EvalContext): DataValue {
  switch (expr.type) {
    case 'field':
      return evaluateField(expr, context);
    case 'literal':
      return expr.value;
    case 'binaryOp':
      return evaluateBinaryOp(expr, context);
    case 'unaryOp':
      return evaluateUnaryOp(expr, context);
    case 'functionCall':
      return evaluateFunctionCall(expr, context);
    case 'index':
      return evaluateIndex(expr, context);
    default:
      return null;
  }
}

// ─── Field Access ────────────────────────────────────────────────

function evaluateField(expr: ExprField, context: EvalContext): DataValue {
  let current: DataValue = context;
  for (const part of expr.path) {
    if (current === null || current === undefined) return null;
    if (typeof current === 'object' && !Array.isArray(current)) {
      // Check if it's a DataValue object (has type property for special types)
      if ('type' in current && typeof (current as any).type === 'string') {
        // Special types like SLink, SDate, SDuration — access their properties
        const obj = current as Record<string, DataValue>;
        if (part in obj) {
          current = obj[part];
        } else {
          return null;
        }
      } else {
        // Regular object
        const obj = current as Record<string, DataValue>;
        if (part in obj) {
          current = obj[part];
        } else {
          return null;
        }
      }
    } else if (Array.isArray(current)) {
      // Array auto-mapping (swizzling): array.field → map each element
      const results: DataValue[] = [];
      for (const item of current) {
        const subCtx: EvalContext = typeof item === 'object' && item !== null && !('type' in item)
          ? item as Record<string, DataValue>
          : { value: item };
        results.push(evaluateField(expr, subCtx));
      }
      return results;
    } else {
      return null;
    }
  }
  return current;
}

// ─── Binary Operations ───────────────────────────────────────────

function evaluateBinaryOp(expr: ExprBinaryOp, context: EvalContext): DataValue {
  const left = evaluate(expr.left, context);
  const right = evaluate(expr.right, context);
  return applyBinaryOp(left, expr.op, right);
}

function applyBinaryOp(left: DataValue, op: BinaryOp, right: DataValue): DataValue {
  // Handle null operands
  if (left === null || right === null) {
    if (op === '=' || op === '!=') {
      const isEqual = left === right;
      return op === '=' ? isEqual : !isEqual;
    }
    return null;
  }

  // Type coercion for comparisons
  switch (op) {
    case '+': {
      // String concatenation if either is a string
      if (typeof left === 'string' || typeof right === 'string') {
        return String(valueToString(left)) + String(valueToString(right));
      }
      // Number addition
      return toNumber(left) + toNumber(right);
    }
    case '-': return toNumber(left) - toNumber(right);
    case '*': {
      // String repeat if left is string and right is number
      if (typeof left === 'string' && typeof right === 'number') {
        return (left as string).repeat(right);
      }
      return toNumber(left) * toNumber(right);
    }
    case '/': return toNumber(left) / toNumber(right);
    case '%': return toNumber(left) % toNumber(right);
    case '=': return valuesEqual(left, right);
    case '!=': return !valuesEqual(left, right);
    case '>': return compareValues(left, right) > 0;
    case '<': return compareValues(left, right) < 0;
    case '>=': return compareValues(left, right) >= 0;
    case '<=': return compareValues(left, right) <= 0;
    case '&': return isTruthy(left) && isTruthy(right);
    case '|': return isTruthy(left) || isTruthy(right);
    default: return null;
  }
}

// ─── Unary Operations ────────────────────────────────────────────

function evaluateUnaryOp(expr: ExprUnaryOp, context: EvalContext): DataValue {
  const operand = evaluate(expr.operand, context);
  switch (expr.op) {
    case '-': return -toNumber(operand);
    case '!': return !isTruthy(operand);
    default: return null;
  }
}

// ─── Function Calls ──────────────────────────────────────────────

function evaluateFunctionCall(expr: ExprFunctionCall, context: EvalContext): DataValue {
  const args = expr.args.map(a => evaluate(a, context));
  return evaluateFunction(expr.name, args, context);
}

// ─── Index Access ────────────────────────────────────────────────

function evaluateIndex(expr: ExprIndex, context: EvalContext): DataValue {
  const target = evaluate(expr.target, context);
  const index = evaluate(expr.index, context);

  if (target === null || target === undefined) return null;

  if (Array.isArray(target)) {
    if (typeof index === 'number') {
      return target[index] ?? null;
    }
    return null;
  }

  if (typeof target === 'object') {
    const obj = target as Record<string, DataValue>;
    const key = valueToString(index);
    return obj[key] ?? null;
  }

  return null;
}

// ─── Value Utilities ─────────────────────────────────────────────

/** Convert a DataValue to a number */
export function toNumber(val: DataValue): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'string') {
    const n = parseFloat(val);
    return isNaN(n) ? 0 : n;
  }
  if (isDate(val)) return (val as SDate).ts;
  if (isDuration(val)) return (val as SDuration).value;
  return 0;
}

/** Convert a DataValue to a string */
export function valueToString(val: DataValue): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return String(val);
  if (isLink(val)) {
    const link = val as SLink;
    return link.display || link.path;
  }
  if (isDate(val)) return (val as SDate).value;
  if (isDuration(val)) {
    const dur = val as SDuration;
    return formatDuration(dur.value);
  }
  if (Array.isArray(val)) {
    return val.map(valueToString).join(', ');
  }
  return JSON.stringify(val);
}

/** Check if a value is truthy */
export function isTruthy(val: DataValue): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') return val.length > 0;
  if (Array.isArray(val)) return val.length > 0;
  return true;
}

/** Compare two DataValues for equality */
export function valuesEqual(a: DataValue, b: DataValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;

  if (typeof a !== typeof b) {
    // Type coercion
    return valueToString(a) === valueToString(b);
  }

  if (isLink(a) && isLink(b)) {
    return (a as SLink).path === (b as SLink).path;
  }

  if (isDate(a) && isDate(b)) {
    return (a as SDate).ts === (b as SDate).ts;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => valuesEqual(item, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  return a === b;
}

/** Compare two DataValues (returns negative, 0, or positive) */
export function compareValues(a: DataValue, b: DataValue): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;

  if (isDate(a) && isDate(b)) {
    return (a as SDate).ts - (b as SDate).ts;
  }

  if (isDuration(a) && isDuration(b)) {
    return (a as SDuration).value - (b as SDuration).value;
  }

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  const sa = valueToString(a);
  const sb = valueToString(b);
  return sa.localeCompare(sb);
}

// ─── Type Guards ─────────────────────────────────────────────────

export function isLink(val: DataValue): boolean {
  return typeof val === 'object' && val !== null && !Array.isArray(val) && (val as any).type === 'link';
}

export function isDate(val: DataValue): boolean {
  return typeof val === 'object' && val !== null && !Array.isArray(val) && (val as any).type === 'date';
}

export function isDuration(val: DataValue): boolean {
  return typeof val === 'object' && val !== null && !Array.isArray(val) && (val as any).type === 'duration';
}

/** Format milliseconds as a human-readable duration string */
function formatDuration(ms: number): string {
  if (ms < 0) return '0s';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
