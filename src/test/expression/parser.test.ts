import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression } from '../../expression/parser';

test('parses literals', () => {
  assert.deepEqual(parseExpression('42'), { type: 'literal', value: 42 });
  assert.deepEqual(parseExpression('"hi"'), { type: 'literal', value: 'hi' });
  assert.deepEqual(parseExpression('true'), { type: 'literal', value: true });
  assert.deepEqual(parseExpression('3.14'), { type: 'literal', value: 3.14 });
});

test('parses field paths', () => {
  assert.deepEqual(parseExpression('rating'), { type: 'field', path: ['rating'] });
  assert.deepEqual(parseExpression('file.name'), { type: 'field', path: ['file', 'name'] });
});

test('parses binary operations', () => {
  const ast: any = parseExpression('1 + 2');
  assert.equal(ast.type, 'binaryOp');
  assert.equal(ast.op, '+');
  assert.deepEqual(ast.left, { type: 'literal', value: 1 });
  assert.deepEqual(ast.right, { type: 'literal', value: 2 });
});

test('parses function calls', () => {
  const ast: any = parseExpression('upper("ab")');
  assert.equal(ast.type, 'functionCall');
  assert.equal(ast.name, 'upper');
  assert.deepEqual(ast.args, [{ type: 'literal', value: 'ab' }]);
});

test('parses nested function calls and unary negation', () => {
  const sum: any = parseExpression('sum(list(1,2,3))');
  assert.equal(sum.type, 'functionCall');
  assert.equal(sum.name, 'sum');
  assert.equal(sum.args[0].name, 'list');

  const neg: any = parseExpression('!false');
  assert.equal(neg.type, 'unaryOp');
  assert.equal(neg.op, '!');
  assert.deepEqual(neg.operand, { type: 'literal', value: false });
});
