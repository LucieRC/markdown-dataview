import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { IndexerService } from '../../indexer/index';
import { QueryEngine } from '../../query/engine';
import { parseQuery } from '../../query/parser';

// Runs the REAL IndexerService (vscode stubbed) against the real vault, then
// drives the REAL QueryEngine off it — no mock drift possible.
function vaultRoot(): string {
  const fromCwd = path.resolve(process.cwd(), 'test');
  return fs.existsSync(fromCwd) ? fromCwd : path.resolve(__dirname, '..', '..', '..', 'test');
}

let indexer: IndexerService;

before(async () => {
  process.env.DATAVIEW_TEST_ROOT = vaultRoot();
  indexer = new IndexerService();
  await indexer.initialize([]);
});

test('real IndexerService indexes the whole vault', () => {
  const stats = indexer.getStats();
  assert.ok(stats.pageCount >= 27, `expected >=27 pages, got ${stats.pageCount}`);
  assert.ok(stats.tagCount > 0, 'expected some tags');
});

test('real indexer + engine: link source resolves via inlinks', () => {
  const engine = new QueryEngine(indexer as any);
  const r = engine.execute(parseQuery('LIST FROM [[Non-Fiction]]'));
  assert.equal(r.totalCount, 1);
  assert.ok((r.data[0] as any)._page.file.path.includes('Origin of Species'));
});

test('real indexer + engine: dangling links, folder suffix, tags', () => {
  const engine = new QueryEngine(indexer as any);
  assert.equal(engine.execute(parseQuery('LIST FROM [[Fiction]]')).totalCount, 2);
  assert.equal(engine.execute(parseQuery('LIST FROM "recipes"')).totalCount, 2);
  assert.equal(engine.execute(parseQuery('LIST FROM #project')).totalCount, 2);
});

test('real indexer + engine: aggregate query produces a summary row', () => {
  const engine = new QueryEngine(indexer as any);
  const r = engine.execute(parseQuery('TABLE WITHOUT ID average(budget) AS "Avg", length(rows) AS "N" FROM #project'));
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0]['Avg'], 100000);
  assert.equal(r.data[0]['N'], 2);
});

test('real indexer: file.inlinks lists the pages that link to a page', () => {
  const meeting = indexer.resolvePage('meeting-2026-08-01')!;
  const sources = meeting.file.inlinks.map(l => l.path);
  assert.ok(sources.some(p => p.includes('project-alpha')), `got ${JSON.stringify(sources)}`);
});

test('real indexer: a removed link no longer shows up as an inlink', () => {
  const alpha = indexer.resolvePage('project-alpha')!;
  const saved = alpha.file.outlinks;
  try {
    alpha.file.outlinks = [];
    (indexer as any).buildInlinkIndex();
    const meeting = indexer.resolvePage('meeting-2026-08-01')!;
    assert.ok(!meeting.file.inlinks.some(l => l.path.includes('project-alpha')));
    assert.equal(engineCount('LIST FROM [[meeting-2026-08-01]]'), 0);
  } finally {
    alpha.file.outlinks = saved;
    (indexer as any).buildInlinkIndex();
  }
});

function engineCount(q: string): number {
  return new QueryEngine(indexer as any).execute(parseQuery(q)).totalCount;
}
