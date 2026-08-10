import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { buildIndex } from '../helpers';
import { QueryEngine } from '../../query/engine';
import { parseQuery } from '../../query/parser';

// Vault root = <project>/test (works when `npm test` runs from project root)
function resolveVaultRoot(): string {
  const fromCwd = path.resolve(process.cwd(), 'test');
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(__dirname, '..', '..', '..', 'test');
}

let engine: QueryEngine;
let indexer: any;

before(() => {
  const built = buildIndex(resolveVaultRoot());
  indexer = built.indexer;
  engine = new QueryEngine(indexer);
});

function run(query: string): any {
  return engine.execute(parseQuery(query));
}

function rowPaths(result: any): string[] {
  return (result.data || []).map((r: any) => r._page?.file?.path ?? r?.path ?? r?.file?.link?.path ?? String(r));
}

test('FROM [[Non-Fiction]] returns the non-fiction book (resolved link)', () => {
  const r = run('LIST FROM [[Non-Fiction]]');
  assert.equal(r.totalCount, 1);
  assert.ok(rowPaths(r)[0].includes('Origin of Species'));
});

test('FROM [[Fiction]] returns both fiction books', () => {
  const r = run('LIST FROM [[Fiction]]');
  assert.equal(r.totalCount, 2);
  const paths = rowPaths(r);
  assert.ok(paths.some((p) => p.includes('Catcher in the Rye')));
  assert.ok(paths.some((p) => p.includes('The Great Gatsby')));
});

test('FROM [[dangling author]] returns pages with unresolved links', () => {
  // No J.D. Salinger.md exists -> dangling link, must still resolve via inlinks
  const r = run('LIST FROM [[J.D. Salinger]]');
  assert.equal(r.totalCount, 1);
  assert.ok(rowPaths(r)[0].includes('Catcher in the Rye'));
});

test('FROM [[NoSuchPage]] returns nothing (no dangling links to it)', () => {
  const r = run('LIST FROM [[NoSuchPage]]');
  assert.equal(r.totalCount, 0);
});

test('FROM "recipes" works via folder suffix fallback', () => {
  const r = run('LIST FROM "recipes"');
  assert.equal(r.totalCount, 2);
  const paths = rowPaths(r);
  assert.ok(paths.some((p) => p.includes('pbj')));
  assert.ok(paths.some((p) => p.includes('toast')));
});

test('FROM "obsidian-dataview-test-vult/recipes" (full folder) works', () => {
  const r = run('LIST FROM "obsidian-dataview-test-vult/recipes"');
  assert.equal(r.totalCount, 2);
});

test('FROM #project returns project pages', () => {
  const r = run('LIST FROM #project');
  assert.equal(r.totalCount, 2);
  const paths = rowPaths(r).join('|');
  assert.ok(paths.includes('project-alpha'));
  assert.ok(paths.includes('project-beta'));
});

test('WHERE budget > 100000 filters correctly', () => {
  const r = run('TABLE file.name, budget FROM #project WHERE budget > 100000');
  assert.equal(r.totalCount, 1);
  assert.equal(r.data[0].budget, 120000);
});

test('SORT + LIMIT picks the top budget project', () => {
  const r = run('TABLE file.name, budget FROM #project SORT budget DESC LIMIT 1');
  assert.equal(r.totalCount, 2); // totalCount is pre-limit
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].budget, 120000);
});

test('TASK FROM #project returns all project tasks', () => {
  const r = run('TASK FROM #project');
  assert.equal(r.totalCount, 7); // 4 (alpha) + 3 (beta)
});

test('TASK FROM #project WHERE due filters to dated tasks', () => {
  const r = run('TASK FROM #project WHERE due');
  assert.equal(r.totalCount, 6);
});

test('GROUP BY status produces active/planning groups', () => {
  const r = run('TABLE file.name FROM #project GROUP BY status');
  assert.equal(r.isGrouped, true);
  const keys = (r.groups || []).map((g: any) => g.key);
  assert.ok(keys.includes('active'));
  assert.ok(keys.includes('planning'));
});

test('FLATTEN team expands team members', () => {
  const r = run('TABLE file.name, team FROM #project FLATTEN team');
  assert.equal(r.totalCount, 5); // alpha(3) + beta(2)
});

test('CALENDAR deadline FROM #project returns rows', () => {
  const r = run('CALENDAR deadline FROM #project');
  assert.equal(r.totalCount, 2);
});

test('aggregate functions without GROUP BY collapse to a summary row', () => {
  const r = run(
    'TABLE WITHOUT ID\n' +
      '  sum(file.tasks.length) AS "Total Tasks",\n' +
      '  average(budget) AS "Avg Budget",\n' +
      '  min(budget) AS "Min Budget",\n' +
      '  max(budget) AS "Max Budget",\n' +
      '  length(rows) AS "Projects"\n' +
      'FROM #project'
  );
  assert.equal(r.totalCount, 1);
  assert.equal(r.data.length, 1);
  const row = r.data[0];
  assert.equal(row['Total Tasks'], 7); // 4 + 3
  assert.equal(row['Avg Budget'], 100000);
  assert.equal(row['Min Budget'], 80000);
  assert.equal(row['Max Budget'], 120000);
  assert.equal(row['Projects'], 2);
});

test('aggregate functions with GROUP BY compute per group', () => {
  const r = run('TABLE average(budget) AS "Avg", length(rows) AS "N" FROM #project GROUP BY status');
  assert.equal(r.isGrouped, true);
  const groups: any = r.groups || [];
  const active = groups.find((g: any) => g.key === 'active');
  const planning = groups.find((g: any) => g.key === 'planning');
  assert.ok(active);
  assert.ok(planning);
  assert.equal(active.rows[0]['Avg'], 120000);
  assert.equal(active.rows[0]['N'], 1);
  assert.equal(planning.rows[0]['Avg'], 80000);
  assert.equal(planning.rows[0]['N'], 1);
});

test('array.length works in WHERE filters (file.tasks.length)', () => {
  const r = run('LIST FROM #project WHERE file.tasks.length > 3');
  assert.equal(r.totalCount, 1); // only project-alpha has 4 tasks
  assert.ok(rowPaths(r)[0].includes('project-alpha'));
});

test('outgoing([[X]]) returns pages X links to', () => {
  const r = run('LIST FROM outgoing([[project-alpha]])');
  assert.equal(r.totalCount, 2);
  const paths = rowPaths(r).join('|');
  assert.ok(paths.includes('meeting-2026-08-01'));
  assert.ok(paths.includes('meeting-2026-08-07'));
});

test('FROM -#tag negates the tag source', () => {
  const r = run('LIST FROM -#project');
  const paths = rowPaths(r);
  assert.equal(r.totalCount, indexer.getAllPages().length - 2);
  assert.ok(paths.some((p) => p.includes('demo.md')));
  assert.ok(!paths.some((p) => p.includes('project-alpha')));
  assert.ok(!paths.some((p) => p.includes('project-beta')));
});

test('AND combines tag sources', () => {
  const r = run('LIST FROM #demo AND #meeting');
  assert.equal(r.totalCount, 2);
  assert.ok(rowPaths(r).join('|').includes('meeting-2026-08-01'));
  assert.ok(rowPaths(r).join('|').includes('meeting-2026-08-07'));
});

test('OR unions tag sources', () => {
  const r = run('LIST FROM #demo OR #meeting');
  assert.equal(r.totalCount, 5); // demo + alpha + beta + 2 meetings
});

test('file source resolves a single file (with extension)', () => {
  const r = run('LIST FROM "projects/project-alpha.md"');
  assert.equal(r.totalCount, 1);
  assert.ok(rowPaths(r)[0].includes('project-alpha'));
});

test('LIST WITHOUT ID omits the file column', () => {
  const r = run('LIST WITHOUT ID FROM #project');
  assert.equal(r.totalCount, 2);
});

test('index access team[0] returns the first team member', () => {
  const r = run('TABLE team[0] AS "Lead" FROM #project SORT file.name ASC');
  assert.equal(r.totalCount, 2);
  assert.equal(r.data[0]['Lead'], 'Alice'); // project-alpha
  assert.equal(r.data[1]['Lead'], 'Bob');   // project-beta
});

test('date comparison in WHERE (deadline > date(...))', () => {
  const r = run('TABLE file.name FROM #project WHERE deadline > date(2026-09-01)');
  assert.equal(r.totalCount, 2); // both deadlines are after 2026-09-01
});
