/**
 * Debug harness — runs the REAL QueryParser + QueryEngine against a vault folder,
 * using a mock indexer backed by a replicated page index (no VS Code needed).
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseMarkdownPage } from '../src/indexer/parser';
import { PageMetadata } from '../src/indexer/types';
import { parseQuery } from '../src/query/parser';
import { QueryEngine } from '../src/query/engine';

const ROOT = process.argv[2] || '/home/jovyan/Projects/vscode_dataview/test';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', '.vscode', 'dist', 'scripts'].includes(e.name)) continue;
      out.push(...walk(p));
    } else if (e.name.endsWith('.md')) {
      out.push(p);
    }
  }
  return out;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

// ── Build page index (same as IndexerService.fullScan) ──
const pages = new Map<string, PageMetadata>();
for (const f of walk(ROOT)) {
  const relativePath = normalizePath(path.relative(ROOT, f));
  const content = fs.readFileSync(f, 'utf-8');
  const stat = fs.statSync(f);
  const { metadata } = parseMarkdownPage(content, relativePath, {
    ctimeMs: stat.ctimeMs,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  });
  pages.set(relativePath, metadata);
}

// ── Build inlinks (mirrors updated buildInlinkIndex + resolveLinkTarget/Key) ──
function resolveLinkTarget(target: string): string | undefined {
  const raw = normalizePath(target).split('#')[0].trim();
  if (!raw) return undefined;
  const candidates = [raw, raw + '.md', raw.endsWith('.md') ? raw.slice(0, -3) : raw];
  for (const c of candidates) if (pages.has(c)) return c;
  const base = raw.split('/').pop()!.toLowerCase();
  const baseNoExt = base.endsWith('.md') ? base.slice(0, -3) : base;
  const matches = [...pages.values()].filter(p => p.file.name.toLowerCase() === baseNoExt);
  if (matches.length === 1) return matches[0].file.path;
  return undefined;
}

function resolveLinkKey(target: string): string {
  const resolved = resolveLinkTarget(target);
  if (resolved) return resolved;
  const raw = normalizePath(target).split('#')[0].trim();
  if (!raw) return '';
  const noExt = raw.endsWith('.md') ? raw.slice(0, -3) : raw;
  return noExt.toLowerCase();
}

const inlinks = new Map<string, Set<string>>();
for (const [pagePath, page] of pages) {
  for (const link of page.file.outlinks) {
    const target = resolveLinkKey(link.path);
    if (target) {
      if (!inlinks.has(target)) inlinks.set(target, new Set());
      inlinks.get(target)!.add(pagePath);
    }
  }
}

// ── Mock indexer with the methods QueryEngine uses ──
const mockIndexer: any = {
  getAllPages: () => [...pages.values()],
  getPagesByTag: (tag: string) =>
    [...pages.values()].filter(p => p.file.tags.includes(tag)),
  getPagesByFolder: (folder: string) => {
    const n = normalizePath(folder);
    const direct = [...pages.values()].filter(
      p => p.file.folder === n || p.file.folder.startsWith(n + '/')
    );
    if (direct.length > 0) return direct;
    const suffix = n.split('/').filter(Boolean);
    return [...pages.values()].filter(p => {
      const segs = p.file.folder.split('/');
      if (segs.length < suffix.length) return false;
      return segs.slice(-suffix.length).join('/') === suffix.join('/');
    });
  },
  getPage: (fp: string) => pages.get(normalizePath(fp)),
  resolvePage: (target: string) => {
    const k = resolveLinkTarget(target);
    return k ? pages.get(k) : undefined;
  },
  getInlinks: (fp: string) => {
    const k = resolveLinkKey(fp);
    if (!k) return [];
    const s = inlinks.get(k);
    return s ? [...s].map(p => pages.get(p)).filter(Boolean) : [];
  },
};

const engine = new QueryEngine(mockIndexer);

function run(label: string, q: string): void {
  console.log(`\n=== ${label} ===`);
  console.log(`  query: ${q}`);
  try {
    const parsed = parseQuery(q);
    const result = engine.execute(parsed);
    const rows = (result.data || []).map((r: any) => r._page?.file?.path ?? r);
    console.log(`  totalCount: ${result.totalCount}`);
    console.log(`  rows: ${rows.length ? rows.join('  |  ') : '(EMPTY)'}`);
  } catch (e: any) {
    console.log(`  ERROR: ${e?.message ?? e}`);
  }
}

console.log(`Workspace root: ${ROOT} (${pages.size} pages)`);
run('recipes (folder)', 'list from "recipes"');
run('recipes (full folder)', 'list from "obsidian-dataview-test-vult/recipes"');
run('Non-Fiction (link)', 'list from [[Non-Fiction]]');
run('Fiction (link)', 'list from [[Fiction]]');
