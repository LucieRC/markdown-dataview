/**
 * Debug harness — reproduces IndexerService link resolution (buildInlinkIndex + getInlinks)
 * against a real vault folder, WITHOUT VS Code. Used to diagnose `FROM [[X]]` queries.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseMarkdownPage } from '../src/indexer/parser';
import { PageMetadata } from '../src/indexer/types';

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

// ── Replicate IndexerService.fullScan (page index) ──
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

// ── Replicate resolveLinkTarget (new logic in src/indexer/index.ts) ──
function resolveLinkTarget(target: string): string | undefined {
  const raw = normalizePath(target).split('#')[0].trim();
  if (!raw) return undefined;
  const candidates = [raw, raw + '.md', raw.endsWith('.md') ? raw.slice(0, -3) : raw];
  for (const c of candidates) {
    if (pages.has(c)) return c;
  }
  const base = raw.split('/').pop()!.toLowerCase();
  const baseNoExt = base.endsWith('.md') ? base.slice(0, -3) : base;
  const matches = [...pages.values()].filter(p => p.file.name.toLowerCase() === baseNoExt);
  if (matches.length === 1) return matches[0].file.path;
  return undefined;
}

// ── Replicate buildInlinkIndex (mirrors updated src/indexer/index.ts) ──
const inlinks = new Map<string, Set<string>>();
for (const [pagePath, page] of pages) {
  for (const link of page.file.outlinks) {
    const target = resolveLinkTarget(link.path);
    if (target) {
      if (!inlinks.has(target)) inlinks.set(target, new Set());
      inlinks.get(target)!.add(pagePath);
    }
  }
}

console.log(`Workspace root: ${ROOT}`);
console.log(`Total pages indexed: ${pages.size}\n`);

console.log('--- Resolving FROM [[X]] (getInlinks) ---');
for (const target of ['Non-Fiction', 'Fiction', 'Non-Fiction.md', 'Books#Non-Fiction']) {
  const key = resolveLinkTarget(target);
  const hits = key ? inlinks.get(key) : undefined;
  console.log(`FROM [[${target}]]  (key="${key}") => ${hits && hits.size ? [...hits].join(', ') : 'EMPTY'}`);
}

console.log('\n--- Outgoing([[X]]) target resolution ---');
for (const target of ['Non-Fiction', 'Fiction', 'Fiction.md']) {
  const key = resolveLinkTarget(target);
  console.log(`outgoing([[${target}]]) => key="${key}"`);
}

console.log('\n--- All indexed pages ---');
for (const k of pages.keys()) console.log('  ' + k);

console.log('\n--- Outlinks of book pages ---');
for (const [k, p] of pages) {
  if (k.toLowerCase().includes('book') && k.toLowerCase().includes('.md')) {
    console.log(`  ${k}`);
    console.log(`    outlinks: ${JSON.stringify(p.file.outlinks.map(l => l.path))}`);
  }
}
