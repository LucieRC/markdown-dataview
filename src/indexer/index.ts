/**
 * IndexerService — maintains an in-memory index of all markdown files
 * in the workspace, updated incrementally via file watchers.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PageMetadata, PageIndex } from './types';
import { parseMarkdownPage } from './parser';

export class IndexerService {
  private index: PageIndex;
  private watcher: vscode.FileSystemWatcher | null = null;
  private statusBar: vscode.StatusBarItem;
  private excludedFolders: string[] = [];

  constructor() {
    this.index = {
      pages: new Map(),
      tags: new Map(),
      inlinks: new Map(),
    };

    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBar.command = 'dataview.showIndexStats';
  }

  /** Initialize the indexer: scan workspace and set up watchers */
  async initialize(excludedFolders: string[] = []): Promise<void> {
    this.excludedFolders = excludedFolders;
    this.statusBar.text = '$(sync~spin) Dataview: indexing...';
    this.statusBar.show();

    try {
      await this.fullScan();
      this.setupWatcher();
      this.updateStatusBar();
    } catch (err) {
      console.error('[Dataview] Indexing failed:', err);
      this.statusBar.text = '$(error) Dataview: index error';
    }
  }

  /** Get a page by exact path */
  getPage(filePath: string): PageMetadata | undefined {
    return this.index.pages.get(normalizePath(filePath));
  }

  /**
   * Resolve a page by path or wikilink target, using Obsidian-style filename
   * resolution: an exact path wins; otherwise the unique page whose basename
   * matches the target (ignoring folder, extension, and `#subpath`).
   */
  resolvePage(target: string): PageMetadata | undefined {
    const key = this.resolveLinkTarget(target);
    if (!key) return undefined;
    return this.index.pages.get(key);
  }

  /** Get all pages */
  getAllPages(): PageMetadata[] {
    return [...this.index.pages.values()];
  }

  /** Get pages that have a specific tag */
  getPagesByTag(tag: string): PageMetadata[] {
    const paths = this.index.tags.get(tag);
    if (!paths) return [];
    return [...paths].map(p => this.index.pages.get(p)).filter(Boolean) as PageMetadata[];
  }

  /** Get pages in a specific folder (recursive) */
  getPagesByFolder(folder: string): PageMetadata[] {
    const normalized = normalizePath(folder);
    const direct = this.getAllPages().filter(
      p => p.file.folder === normalized || p.file.folder.startsWith(normalized + '/')
    );
    if (direct.length > 0) return direct;

    // Fallback: the workspace root may be a parent of the vault root (e.g. the
    // dev host opens `test/` but the vault lives in `test/obsidian-dataview-test-vult/`).
    // When the strict prefix match finds nothing, match pages whose folder path
    // *ends* with the queried folder so `FROM "recipes"` still works.
    const suffix = normalized.split('/').filter(Boolean);
    if (suffix.length === 0) return [];
    return this.getAllPages().filter(p => {
      const segs = p.file.folder.split('/');
      if (segs.length < suffix.length) return false;
      return segs.slice(-suffix.length).join('/') === suffix.join('/');
    });
  }

  /** Get pages that link to a given page (includes dangling/unresolved links) */
  getInlinks(filePath: string): PageMetadata[] {
    const key = this.resolveLinkKey(filePath);
    if (!key) return [];
    const paths = this.index.inlinks.get(key);
    if (!paths) return [];
    return [...paths].map(p => this.index.pages.get(p)).filter(Boolean) as PageMetadata[];
  }

  /** Get index statistics */
  getStats(): { pageCount: number; tagCount: number; inlinkCount: number } {
    return {
      pageCount: this.index.pages.size,
      tagCount: this.index.tags.size,
      inlinkCount: this.index.inlinks.size,
    };
  }

  /** Get the full page index (for serialization to preview) */
  getIndex(): PageIndex {
    return this.index;
  }

  /** Update the excluded folders list and reindex */
  async setExcludedFolders(folders: string[]): Promise<void> {
    this.excludedFolders = folders;
    await this.fullScan();
  }

  dispose(): void {
    this.watcher?.dispose();
    this.statusBar.dispose();
  }

  // ─── Private methods ──────────────────────────────────────────

  private async fullScan(): Promise<void> {
    this.index.pages.clear();
    this.index.tags.clear();
    this.index.inlinks.clear();

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    const root = workspaceFolders[0];
    const pattern = new vscode.RelativePattern(root, '**/*.md');
    const files = await vscode.workspace.findFiles(pattern);

    // Filter excluded files
    const toIndex = files.filter(uri => {
      const relativePath = normalizePath(path.relative(root.uri.fsPath, uri.fsPath));
      return !this.isExcluded(relativePath);
    }).map(uri => ({
      fsPath: uri.fsPath,
      relativePath: normalizePath(path.relative(root.uri.fsPath, uri.fsPath)),
    }));

    // Parallel processing with concurrency limit (8 workers)
    const concurrency = 8;
    const chunks = this.chunkArray(toIndex, concurrency);

    for (const chunk of chunks) {
      await Promise.all(chunk.map(({ fsPath, relativePath }) =>
        this.indexFile(fsPath, relativePath).catch(err => {
          console.error(`[Dataview] Failed to index ${relativePath}:`, err);
        })
      ));
    }

    // Build inlink index (second pass)
    this.buildInlinkIndex();
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  private async indexFile(fsPath: string, relativePath: string): Promise<void> {
    const content = fs.readFileSync(fsPath, 'utf-8');
    const stat = fs.statSync(fsPath);

    const { metadata } = parseMarkdownPage(content, relativePath, {
      ctimeMs: stat.birthtimeMs,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    });

    // Add to page index
    this.index.pages.set(relativePath, metadata);

    // Add to tag index
    for (const tag of metadata.file.tags) {
      if (!this.index.tags.has(tag)) {
        this.index.tags.set(tag, new Set());
      }
      this.index.tags.get(tag)!.add(relativePath);
    }
  }

  private buildInlinkIndex(): void {
    for (const [pagePath, page] of this.index.pages) {
      for (const link of page.file.outlinks) {
        const target = this.resolveLinkKey(link.path);
        if (target) {
          if (!this.index.inlinks.has(target)) {
            this.index.inlinks.set(target, new Set());
          }
          this.index.inlinks.get(target)!.add(pagePath);
        }
      }
    }
  }

  /**
   * Resolve a wikilink target / path to a canonical page key.
   * 1. Exact path match (with or without `.md`).
   * 2. Unique basename match anywhere in the vault (Obsidian-style), so
   *    `[[Non-Fiction]]` finds `some/folder/Non-Fiction.md`.
   * Subpaths ("File#heading") are ignored for file-level resolution.
   */
  private resolveLinkTarget(target: string): string | undefined {
    const raw = normalizePath(target).split('#')[0].trim();
    if (!raw) return undefined;

    const candidates = [
      raw,
      raw + '.md',
      raw.endsWith('.md') ? raw.slice(0, -3) : raw,
    ];
    for (const c of candidates) {
      if (this.index.pages.has(c)) return c;
    }

    // Fall back to basename lookup across the vault (unique match only).
    const base = raw.split('/').pop()!.toLowerCase();
    const baseNoExt = base.endsWith('.md') ? base.slice(0, -3) : base;
    const matches = this.getAllPages().filter(
      p => p.file.name.toLowerCase() === baseNoExt
    );
    if (matches.length === 1) return matches[0].file.path;
    return undefined;
  }

  /**
   * Resolve a wikilink target to the canonical key used for inlink bookkeeping.
   * When the target resolves to a real page, that page's key is used; otherwise
   * it falls back to a normalized dangling-link key (lowercased, no `.md`), so
   * `FROM [[X]]` still returns pages that link to `X` even when `X.md` does not
   * exist — matching Obsidian Dataview, which tracks unresolved links too.
   */
  private resolveLinkKey(target: string): string {
    const resolved = this.resolveLinkTarget(target);
    if (resolved) return resolved;

    const raw = normalizePath(target).split('#')[0].trim();
    if (!raw) return '';
    const noExt = raw.endsWith('.md') ? raw.slice(0, -3) : raw;
    return noExt.toLowerCase();
  }

  private async reindexFile(fsPath: string, relativePath: string): Promise<void> {
    // Remove old data
    const oldPage = this.index.pages.get(relativePath);
    if (oldPage) {
      for (const tag of oldPage.file.tags) {
        this.index.tags.get(tag)?.delete(relativePath);
      }
    }
    this.index.pages.delete(relativePath);

    // Reindex
    try {
      await this.indexFile(fsPath, relativePath);
      this.buildInlinkIndex();
    } catch (err) {
      console.error(`[Dataview] Failed to reindex ${relativePath}:`, err);
    }

    this.updateStatusBar();
  }

  private unindexFile(relativePath: string): void {
    const oldPage = this.index.pages.get(relativePath);
    if (oldPage) {
      for (const tag of oldPage.file.tags) {
        this.index.tags.get(tag)?.delete(relativePath);
      }
    }
    this.index.pages.delete(relativePath);
    this.index.inlinks.delete(relativePath);
    this.buildInlinkIndex();
    this.updateStatusBar();
  }

  private setupWatcher(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    const root = workspaceFolders[0];
    const watcherPattern = new vscode.RelativePattern(root, '**/*.md');

    this.watcher = vscode.workspace.createFileSystemWatcher(watcherPattern);

    this.watcher.onDidCreate(async (uri) => {
      const relativePath = normalizePath(
        path.relative(root.uri.fsPath, uri.fsPath)
      );
      if (!this.isExcluded(relativePath)) {
        await this.reindexFile(uri.fsPath, relativePath);
      }
    });

    this.watcher.onDidChange(async (uri) => {
      const relativePath = normalizePath(
        path.relative(root.uri.fsPath, uri.fsPath)
      );
      if (!this.isExcluded(relativePath)) {
        await this.reindexFile(uri.fsPath, relativePath);
      }
    });

    this.watcher.onDidDelete(async (uri) => {
      const relativePath = normalizePath(
        path.relative(root.uri.fsPath, uri.fsPath)
      );
      this.unindexFile(relativePath);
    });
  }

  private isExcluded(relativePath: string): boolean {
    return this.excludedFolders.some(folder => {
      const normalized = normalizePath(folder);
      return relativePath === normalized || relativePath.startsWith(normalized + '/');
    });
  }

  private updateStatusBar(): void {
    const stats = this.getStats();
    this.statusBar.text = `$(database) Dataview: ${stats.pageCount} pages`;
    this.statusBar.tooltip = `${stats.pageCount} pages, ${stats.tagCount} tags indexed`;
  }
}

/** Normalize a path to use forward slashes and no trailing slash */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}
