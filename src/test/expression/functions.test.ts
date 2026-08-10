import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFunction, getAvailableFunctions } from '../../expression/functions';

function fn(name: string, args: any[]): any {
  return evaluateFunction(name, args, {});
}

test('registry exposes a rich set of functions', () => {
  const names = getAvailableFunctions();
  assert.ok(names.length >= 40, `expected >=40 functions, got ${names.length}`);
  for (const required of ['length', 'upper', 'contains', 'sum', 'list', 'date', 'min', 'max']) {
    assert.ok(names.includes(required), `missing function ${required}`);
  }
});

test('string functions', () => {
  assert.equal(fn('upper', ['ab']), 'AB');
  assert.equal(fn('lower', ['AB']), 'ab');
  assert.equal(fn('length', ['abc']), 3);
  assert.equal(fn('contains', ['hello', 'ell']), true);
  assert.equal(fn('replace', ['hello', 'l', 'L']), 'heLLo');
  assert.equal(fn('startswith', ['hello', 'he']), true);
  assert.equal(fn('endswith', ['hello', 'lo']), true);
});

test('list/aggregate functions', () => {
  assert.equal(fn('length', [[1, 2, 3]]), 3);
  assert.equal(fn('sum', [[1, 2, 3]]), 6);
  assert.equal(fn('average', [[1, 2, 3]]), 2);
  assert.equal(fn('min', [[3, 1, 2]]), 1);
  assert.equal(fn('max', [[3, 1, 2]]), 3);
  assert.equal(fn('min', [5, 2, 9]), 2); // variadic
  assert.equal(fn('max', [5, 2, 9]), 9);
  assert.deepEqual(fn('list', [1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(fn('reverse', [[1, 2, 3]]), [3, 2, 1]);
});

test('unknown function returns null', () => {
  assert.equal(fn('no_such_fn', []), null);
});
