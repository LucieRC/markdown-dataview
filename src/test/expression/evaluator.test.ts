import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression } from '../../expression/parser';
import { evaluate, isTruthy, valueToString, compareValues, valuesEqual } from '../../expression/evaluator';

function ev(src: string, ctx: any = {}): any {
  return evaluate(parseExpression(src), ctx);
}

test('evaluates literals and arithmetic', () => {
  assert.equal(ev('42'), 42);
  assert.equal(ev('"hi"'), 'hi');
  assert.equal(ev('1 + 2'), 3);
  assert.equal(ev('10 - 4'), 6);
  assert.equal(ev('2 * 3'), 6);
  assert.equal(ev('7 / 2'), 3.5);
  assert.equal(ev('7 % 3'), 1);
});

test('evaluates comparisons and boolean', () => {
  assert.equal(ev('rating > 3', { rating: 5 }), true);
  assert.equal(ev('rating <= 3', { rating: 5 }), false);
  assert.equal(ev('name = "alice"', { name: 'alice' }), true);
  assert.equal(ev('name != "bob"', { name: 'alice' }), true);
  assert.equal(ev('!false'), true);
});

test('evaluates function calls', () => {
  assert.equal(ev('upper("ab")'), 'AB');
  assert.equal(ev('length("abc")'), 3);
  assert.equal(ev('contains("hello", "ell")'), true);
  assert.equal(ev('sum(list(1,2,3))'), 6);
});

test('field access returns context values; missing -> null', () => {
  assert.equal(ev('file.name', { file: { name: 'demo' } }), 'demo');
  assert.equal(ev('missing'), null);
});

test('isTruthy / valueToString / compareValues helpers', () => {
  assert.equal(isTruthy(true), true);
  assert.equal(isTruthy(0), false);
  assert.equal(isTruthy(''), false);
  assert.equal(isTruthy('x'), true);
  assert.equal(valueToString(42), '42');
  assert.equal(compareValues(1, 2), -1);
  assert.equal(compareValues(2, 1), 1);
  assert.equal(compareValues(2, 2), 0);
});

test('array.length returns element count, not per-element mapping', () => {
  assert.equal(ev('file.tasks.length', { file: { tasks: [1, 2, 3, 4] } }), 4);
});

test('aggregate functions evaluate over the rows context', () => {
  const rows = [{ budget: 10 }, { budget: 20 }, { budget: 30 }];
  assert.equal(ev('sum(budget)', { rows }), 60);
  assert.equal(ev('average(budget)', { rows }), 20);
  assert.equal(ev('min(budget)', { rows }), 10);
  assert.equal(ev('max(budget)', { rows }), 30);
  assert.equal(ev('length(rows)', { rows }), 3);
});

test('unicode strings are handled', () => {
  assert.equal(ev('length("中文")'), 2);
  assert.equal(ev('upper("héllo")'), 'HÉLLO');
  assert.equal(ev('contains("héllo", "é")'), true);
});

test('`this` refers to the current page context', () => {
  assert.equal(ev('this.file.name', { this: { file: { name: 'demo' } } }), 'demo');
});

test('index access returns array/object members', () => {
  assert.equal(ev('team[0]', { team: ['Alice', 'Bob'] }), 'Alice');
  assert.equal(ev('file.tasks[1].text', { file: { tasks: [{ text: 'a' }, { text: 'b' }] } }), 'b');
});

test('link values compare by structure', () => {
  const a = { type: 'link', path: 'x' };
  assert.equal(ev('a = b', { a, b: { type: 'link', path: 'x' } }), true);
  assert.equal(valuesEqual(a, { type: 'link', path: 'x' }), true);
});

test('string/number coercion: 1 + "2" concatenates', () => {
  assert.equal(ev('1 + "2"'), '12');
});
