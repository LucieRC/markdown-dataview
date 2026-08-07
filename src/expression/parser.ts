/**
 * Expression parser — recursive descent parser for DQL expressions.
 * Handles field references, literals, arithmetic, comparisons,
 * boolean logic, function calls, indexing, and link dereferencing.
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
} from '../indexer/types';

// ─── Tokenizer ────────────────────────────────────────────────────

type TokenType =
  | 'number'
  | 'string'
  | 'ident'
  | 'dateLiteral'    // date(...)
  | 'durLiteral'     // dur(...)
  | 'link'           // [[...]]
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'comma'
  | 'dot'
  | 'plus'
  | 'minus'
  | 'star'
  | 'slash'
  | 'percent'
  | 'eq'
  | 'neq'
  | 'lt'
  | 'gt'
  | 'lte'
  | 'gte'
  | 'and'
  | 'or'
  | 'not'
  | 'eof';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

class Tokenizer {
  private input: string;
  private pos = 0;

  constructor(input: string) {
    this.input = input;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];

      // Whitespace
      if (/\s/.test(ch)) {
        this.pos++;
        continue;
      }

      // Numbers
      if (/[0-9]/.test(ch)) {
        tokens.push(this.readNumber());
        continue;
      }

      // Strings
      if (ch === '"' || ch === "'") {
        tokens.push(this.readString(ch));
        continue;
      }

      // Date literal: date(...)
      if (this.input.slice(this.pos, this.pos + 5) === 'date(') {
        const start = this.pos;
        this.pos += 4; // skip 'date'
        // Now at '(' — let it be picked up by the paren handler
        // We need to treat 'date' as a special token
        tokens.push({ type: 'dateLiteral', value: 'date', pos: start });
        continue;
      }

      // Duration literal: dur(...)
      if (this.input.slice(this.pos, this.pos + 4) === 'dur(') {
        const start = this.pos;
        this.pos += 3;
        tokens.push({ type: 'durLiteral', value: 'dur', pos: start });
        continue;
      }

      // Wikilink: [[...]]
      if (ch === '[' && this.input[this.pos + 1] === '[') {
        tokens.push(this.readLink());
        continue;
      }

      // Identifiers and keywords
      if (/[a-zA-Z_$\u4e00-\u9fff]/.test(ch)) {
        tokens.push(this.readIdent());
        continue;
      }

      // Operators and punctuation
      switch (ch) {
        case '(': tokens.push({ type: 'lparen', value: '(', pos: this.pos }); this.pos++; break;
        case ')': tokens.push({ type: 'rparen', value: ')', pos: this.pos }); this.pos++; break;
        case '[': tokens.push({ type: 'lbracket', value: '[', pos: this.pos }); this.pos++; break;
        case ']': tokens.push({ type: 'rbracket', value: ']', pos: this.pos }); this.pos++; break;
        case ',': tokens.push({ type: 'comma', value: ',', pos: this.pos }); this.pos++; break;
        case '.': tokens.push({ type: 'dot', value: '.', pos: this.pos }); this.pos++; break;
        case '+': tokens.push({ type: 'plus', value: '+', pos: this.pos }); this.pos++; break;
        case '-': tokens.push({ type: 'minus', value: '-', pos: this.pos }); this.pos++; break;
        case '*': tokens.push({ type: 'star', value: '*', pos: this.pos }); this.pos++; break;
        case '/': tokens.push({ type: 'slash', value: '/', pos: this.pos }); this.pos++; break;
        case '%': tokens.push({ type: 'percent', value: '%', pos: this.pos }); this.pos++; break;
        case '=':
          if (this.input[this.pos + 1] === '=') {
            tokens.push({ type: 'eq', value: '==', pos: this.pos }); this.pos += 2;
          } else {
            tokens.push({ type: 'eq', value: '=', pos: this.pos }); this.pos++;
          }
          break;
        case '!':
          if (this.input[this.pos + 1] === '=') {
            tokens.push({ type: 'neq', value: '!=', pos: this.pos }); this.pos += 2;
          } else {
            tokens.push({ type: 'not', value: '!', pos: this.pos }); this.pos++;
          }
          break;
        case '<':
          if (this.input[this.pos + 1] === '=') {
            tokens.push({ type: 'lte', value: '<=', pos: this.pos }); this.pos += 2;
          } else {
            tokens.push({ type: 'lt', value: '<', pos: this.pos }); this.pos++;
          }
          break;
        case '>':
          if (this.input[this.pos + 1] === '=') {
            tokens.push({ type: 'gte', value: '>=', pos: this.pos }); this.pos += 2;
          } else {
            tokens.push({ type: 'gt', value: '>', pos: this.pos }); this.pos++;
          }
          break;
        default:
          // Skip unknown characters
          this.pos++;
      }
    }

    tokens.push({ type: 'eof', value: '', pos: this.pos });
    return tokens;
  }

  private readNumber(): Token {
    const start = this.pos;
    while (this.pos < this.input.length && /[0-9.]/.test(this.input[this.pos])) {
      this.pos++;
    }
    return { type: 'number', value: this.input.slice(start, this.pos), pos: start };
  }

  private readString(quote: string): Token {
    const start = this.pos;
    this.pos++; // skip opening quote
    let value = '';
    while (this.pos < this.input.length && this.input[this.pos] !== quote) {
      if (this.input[this.pos] === '\\') {
        this.pos++;
        if (this.pos < this.input.length) {
          value += this.input[this.pos];
        }
      } else {
        value += this.input[this.pos];
      }
      this.pos++;
    }
    this.pos++; // skip closing quote
    return { type: 'string', value, pos: start };
  }

  private readLink(): Token {
    const start = this.pos;
    this.pos += 2; // skip [[
    let depth = 2;
    while (this.pos < this.input.length && depth > 0) {
      if (this.input[this.pos] === '[' && this.input[this.pos + 1] === '[') {
        depth += 2;
        this.pos += 2;
      } else if (this.input[this.pos] === ']' && this.input[this.pos + 1] === ']') {
        depth -= 2;
        this.pos += 2;
      } else {
        this.pos++;
      }
    }
    const value = this.input.slice(start + 2, this.pos - 2);
    return { type: 'link', value, pos: start };
  }

  private readIdent(): Token {
    const start = this.pos;
    while (
      this.pos < this.input.length &&
      /[a-zA-Z0-9_$\u4e00-\u9fff-]/.test(this.input[this.pos])
    ) {
      this.pos++;
    }
    const value = this.input.slice(start, this.pos);
    // Keywords
    const lower = value.toLowerCase();
    if (lower === 'and') return { type: 'and', value, pos: start };
    if (lower === 'or') return { type: 'or', value, pos: start };
    if (lower === 'not') return { type: 'not', value, pos: start };
    if (lower === 'true') return { type: 'number', value: 'true', pos: start };
    if (lower === 'false') return { type: 'number', value: 'false', pos: start };
    if (lower === 'null') return { type: 'number', value: 'null', pos: start };
    return { type: 'ident', value, pos: start };
  }
}

// ─── Parser ──────────────────────────────────────────────────────

export class ExpressionParser {
  private tokens: Token[] = [];
  private pos = 0;

  parse(input: string): Expression {
    const tokenizer = new Tokenizer(input);
    this.tokens = tokenizer.tokenize();
    this.pos = 0;
    const expr = this.parseOr();
    return expr;
  }

  private current(): Token {
    return this.tokens[this.pos] || { type: 'eof', value: '', pos: 0 };
  }

  private advance(): Token {
    const t = this.current();
    this.pos++;
    return t;
  }

  private match(...types: TokenType[]): boolean {
    return types.includes(this.current().type);
  }

  private expect(type: TokenType): Token {
    const t = this.current();
    if (t.type !== type) {
      throw new Error(`Expected ${type} but got ${t.type} (${t.value}) at position ${t.pos}`);
    }
    return this.advance();
  }

  // or → and ('OR' and)*
  private parseOr(): Expression {
    let left = this.parseAnd();
    while (this.match('or')) {
      this.advance();
      const right = this.parseAnd();
      left = { type: 'binaryOp', left, op: '|', right };
    }
    return left;
  }

  // and → comparison ('AND' comparison)*
  private parseAnd(): Expression {
    let left = this.parseComparison();
    while (this.match('and')) {
      this.advance();
      const right = this.parseComparison();
      left = { type: 'binaryOp', left, op: '&', right };
    }
    return left;
  }

  // comparison → addition (('>' | '<' | '>=' | '<=' | '=' | '!=') addition)?
  private parseComparison(): Expression {
    let left = this.parseAddition();
    while (this.match('gt', 'lt', 'gte', 'lte', 'eq', 'neq')) {
      const op = this.advance().value as BinaryOp;
      const right = this.parseAddition();
      left = { type: 'binaryOp', left, op, right };
    }
    return left;
  }

  // addition → multiplication (('+' | '-') multiplication)*
  private parseAddition(): Expression {
    let left = this.parseMultiplication();
    while (this.match('plus', 'minus')) {
      const op = this.advance().value as BinaryOp;
      const right = this.parseMultiplication();
      left = { type: 'binaryOp', left, op, right };
    }
    return left;
  }

  // multiplication → unary (('*' | '/' | '%') unary)*
  private parseMultiplication(): Expression {
    let left = this.parseUnary();
    while (this.match('star', 'slash', 'percent')) {
      const op = this.advance().value as BinaryOp;
      const right = this.parseUnary();
      left = { type: 'binaryOp', left, op, right };
    }
    return left;
  }

  // unary → ('-' | '!' | 'NOT') unary | postfix
  private parseUnary(): Expression {
    if (this.match('minus', 'not')) {
      const op = this.advance().value as '-' | '!';
      const operand = this.parseUnary();
      return { type: 'unaryOp', op, operand };
    }
    return this.parsePostfix();
  }

  // postfix → primary ('.' ident | '[' expression ']' | '(' args ')')*
  private parsePostfix(): Expression {
    let expr = this.parsePrimary();

    while (true) {
      if (this.match('dot')) {
        this.advance();
        const field = this.expect('ident').value;
        expr = this.wrapFieldAccess(expr, field);
      } else if (this.match('lbracket')) {
        this.advance();
        const index = this.parseOr();
        this.expect('rbracket');
        expr = { type: 'index', target: expr, index };
      } else if (this.match('lparen')) {
        // Function call (postfix paren after ident primary)
        const fnName = (expr as ExprField).path?.join('.');
        this.advance();
        const args: Expression[] = [];
        if (!this.match('rparen')) {
          args.push(this.parseOr());
          while (this.match('comma')) {
            this.advance();
            args.push(this.parseOr());
          }
        }
        this.expect('rparen');
        expr = { type: 'functionCall', name: fnName || '', args };
      } else {
        break;
      }
    }

    return expr;
  }

  private wrapFieldAccess(target: Expression, field: string): Expression {
    // If target is a field, extend the path
    if (target.type === 'field') {
      return { type: 'field', path: [...target.path, field] };
    }
    // Otherwise, wrap as index expression: target.field → target["field"]
    return {
      type: 'index',
      target,
      index: { type: 'literal', value: field },
    };
  }

  // primary → ident | number | string | 'true' | 'false' | 'null'
  //          | link | dateLiteral '(' expr ')' | durLiteral '(' expr ')'
  //          | '(' expression ')'
  private parsePrimary(): Expression {
    const token = this.current();

    switch (token.type) {
      case 'ident': {
        this.advance();
        return { type: 'field', path: [token.value] };
      }
      case 'number': {
        this.advance();
        if (token.value === 'true') return { type: 'literal', value: true };
        if (token.value === 'false') return { type: 'literal', value: false };
        if (token.value === 'null') return { type: 'literal', value: null };
        return { type: 'literal', value: parseFloat(token.value) };
      }
      case 'string': {
        this.advance();
        return { type: 'literal', value: token.value };
      }
      case 'link': {
        this.advance();
        // Parse [[target]] or [[target|display]] or [[target#heading]]
        const parts = token.value.split('|');
        const target = parts[0].trim();
        const display = parts[1]?.trim();
        const hashParts = target.split('#');
        const path = hashParts[0].trim();
        const subpath = hashParts[1]?.trim() || '';
        return {
          type: 'literal',
          value: {
            type: 'link',
            path,
            display: display || path,
            embed: false,
            subpath,
          },
        };
      }
      case 'dateLiteral': {
        this.advance(); // consume 'date'
        this.expect('lparen');
        const arg = this.parseOr();
        this.expect('rparen');
        return { type: 'functionCall', name: 'date', args: [arg] };
      }
      case 'durLiteral': {
        this.advance(); // consume 'dur'
        this.expect('lparen');
        const arg = this.parseOr();
        this.expect('rparen');
        return { type: 'functionCall', name: 'dur', args: [arg] };
      }
      case 'lparen': {
        this.advance();
        const expr = this.parseOr();
        this.expect('rparen');
        return expr;
      }
      default:
        throw new Error(
          `Unexpected token: ${token.type} (${token.value}) at position ${token.pos}`
        );
    }
  }
}

/** Convenience function to parse an expression string */
export function parseExpression(input: string): Expression {
  return new ExpressionParser().parse(input);
}

/** Convenience function to parse a string literal (for field name lookup) */
export function parseFieldPath(input: string): string[] {
  const trimmed = input.trim();
  // For simple dotted paths, just split
  return trimmed.split('.').map(s => s.trim()).filter(Boolean);
}
