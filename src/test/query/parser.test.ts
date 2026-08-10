import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../../query/parser';

test('parses TABLE with columns, alias, FROM, SORT, LIMIT', () => {
  const q: any = parseQuery('TABLE file.name AS "Name", rating FROM #demo SORT file.ctime DESC LIMIT 5');
  assert.equal(q.header.type, 'table');
  assert.equal(q.header.withoutId, false);
  assert.deepEqual(q.header.columns.map((c: any) => c.alias), ['Name', undefined]);
  assert.equal(q.header.columns[0].field.path.join('.'), 'file.name');
  assert.equal(q.from.sources[0].type, 'tag');
  assert.equal(q.from.sources[0].value, 'demo');
  assert.equal(q.sort[0].direction, 'desc');
  assert.equal(q.limit, 5);
});

test('parses LIST from folder', () => {
  const q: any = parseQuery('LIST FROM "recipes"');
  assert.equal(q.header.type, 'list');
  assert.equal(q.from.sources[0].type, 'folder');
  assert.equal(q.from.sources[0].value, 'recipes');
});

test('parses TASK with WHERE and SORT', () => {
  const q: any = parseQuery('TASK FROM #project WHERE due SORT due ASC');
  assert.equal(q.header.type, 'task');
  assert.equal(q.where.type, 'field');
  assert.equal(q.sort[0].direction, 'asc');
});

test('parses CALENDAR', () => {
  const q: any = parseQuery('CALENDAR deadline FROM #project');
  assert.equal(q.header.type, 'calendar');
  assert.equal(q.from.sources[0].value, 'project');
});

test('parses link source FROM [[X]]', () => {
  const q: any = parseQuery('LIST FROM [[Non-Fiction]]');
  assert.equal(q.from.sources[0].type, 'link');
  assert.equal(q.from.sources[0].value, 'Non-Fiction');
});

test('parses WITHOUT ID', () => {
  const q: any = parseQuery('TABLE WITHOUT ID file.link FROM "projects"');
  assert.equal(q.header.withoutId, true);
});

test('parses GROUP BY and FLATTEN', () => {
  const g: any = parseQuery('TABLE file.name FROM #project GROUP BY status');
  assert.equal(g.groupBy[0].field.path.join('.'), 'status');

  const f: any = parseQuery('TABLE file.name, team FROM #project FLATTEN team');
  assert.equal(f.flatten[0].field.path.join('.'), 'team');
});

test('parses WHERE comparison', () => {
  const q: any = parseQuery('TABLE file.name FROM #project WHERE budget > 100000');
  assert.equal(q.where.op, '>');
  assert.equal(q.where.left.path.join('.'), 'budget');
  assert.equal(q.where.right.value, 100000);
});

test('parses multi-line TABLE column lists', () => {
  const q: any = parseQuery(
    'TABLE WITHOUT ID\n' +
      '  sum(file.tasks.length) AS "Total Tasks",\n' +
      '  average(budget) AS "Avg Budget"\n' +
      'FROM #project'
  );
  assert.equal(q.header.withoutId, true);
  assert.equal(q.header.columns.length, 2);
  assert.equal(q.header.columns[0].alias, 'Total Tasks');
  assert.equal(q.header.columns[0].field.type, 'functionCall');
  assert.equal(q.header.columns[1].alias, 'Avg Budget');
  assert.equal(q.from.sources[0].value, 'project');
});
