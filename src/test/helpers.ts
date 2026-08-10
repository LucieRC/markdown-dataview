/**
 * Test helpers: build an in-memory page index + a mock `IndexerService` from a
 * real vault folder using the actual `parseMarkdownPage` parser. The mock
 * mirrors `src/indexer/index.ts` resolution logic (resolveLinkTarget /
 * resolveLinkKey, buildInlinkIndex incl. dangling links, folder suffix
 * fallback) so QueryEngine integration tests exercise real behavior without
 * launching VS Code.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseMarkdownPage } from '../indexer/parser';
import { PageMetadata } from '../indexer/types';

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', '.vscode', 'dist', 'scripts', 'obsidian-dataview'].includes(e.name)) continue;
      out.push(...walkMarkdown(p));
    } else if (e.name.endsWith('.md')) {
      out.push(p);
    }
  }
  return out;
}

export interface TestIndex {
  pages: Map<string, PageMetadata>;
  /** inlinks key -> set of page paths */
  inlinks: Map<string, Set<string>>;
  /** tag (with '#') -> set of page paths */
  tags: Map<string, Set<string>>;
  /** Mock indexer compatible with QueryEngine / createDataviewPlugin */
  indexer: any;
}

export function buildIndex(root: string): TestIndex {
  const pages = new Map<string, PageMetadata>();
  for (const f of walkMarkdown(root)) {
    const rel = normalizePath(path.relative(root, f));
    const content = fs.readFileSync(f, 'utf-8');
    const stat = fs.statSync(f);
    const { metadata } = parseMarkdownPage(content, rel, {
      ctimeMs: stat.ctimeMs,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    });
    pages.set(rel, metadata);
  }

  const allPages = () => [...pages.values()];

  // ── Mirrors IndexerService.resolveLinkTarget ──
  function resolveLinkTarget(target: string): string | undefined {
    const raw = normalizePath(target).split('#')[0].trim();
    if (!raw) return undefined;
    const candidates = [raw, raw + '.md', raw.endsWith('.md') ? raw.slice(0, -3) : raw];
    for (const c of candidates) if (pages.has(c)) return c;
    const base = raw.split('/').pop()!.toLowerCase();
    const baseNoExt = base.endsWith('.md') ? base.slice(0, -3) : base;
    const matches = allPages().filter((p) => p.file.name.toLowerCase() === baseNoExt);
    if (matches.length === 1) return matches[0].file.path;
    return undefined;
  }

  // ── Mirrors IndexerService.resolveLinkKey (dangling-link aware) ──
  function resolveLinkKey(target: string): string {
    const resolved = resolveLinkTarget(target);
    if (resolved) return resolved;
    const raw = normalizePath(target).split('#')[0].trim();
    if (!raw) return '';
    const noExt = raw.endsWith('.md') ? raw.slice(0, -3) : raw;
    return noExt.toLowerCase();
  }

  // ── Inlinks (mirrors buildInlinkIndex) ──
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

  // ── Tags ──
  const tags = new Map<string, Set<string>>();
  for (const [p, meta] of pages) {
    for (const tag of meta.file.tags) {
      if (!tags.has(tag)) tags.set(tag, new Set());
      tags.get(tag)!.add(p);
    }
  }

  const indexer: any = {
    getAllPages: allPages,
    getPage: (fp: string) => pages.get(normalizePath(fp)),
    resolvePage: (target: string) => {
      const k = resolveLinkTarget(target);
      return k ? pages.get(k) : undefined;
    },
    getPagesByTag: (tag: string) => {
      const s = tags.get(tag);
      return s ? [...s].map((p) => pages.get(p)).filter(Boolean) : [];
    },
    getPagesByFolder: (folder: string) => {
      const n = normalizePath(folder);
      const direct = allPages().filter(
        (p) => p.file.folder === n || p.file.folder.startsWith(n + '/')
      );
      if (direct.length > 0) return direct;
      const suffix = n.split('/').filter(Boolean);
      return allPages().filter((p) => {
        const segs = p.file.folder.split('/');
        if (segs.length < suffix.length) return false;
        return segs.slice(-suffix.length).join('/') === suffix.join('/');
      });
    },
    getInlinks: (fp: string) => {
      const k = resolveLinkKey(fp);
      if (!k) return [];
      const s = inlinks.get(k);
      return s ? [...s].map((p) => pages.get(p)).filter(Boolean) : [];
    },
  };

  return { pages, inlinks, tags, indexer };
}
