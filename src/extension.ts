/**
 * VS Code Dataview Extension — Entry Point
 *
 * Activates when a Markdown file is opened. Initializes the page indexer,
 * registers markdown-it plugins for Dataview query rendering,
 * and provides commands for reindexing and stats.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { IndexerService } from './indexer/index';
import { createDataviewPlugin, DataviewPluginConfig } from './markdown/plugin';

let indexer: IndexerService | null = null;

export function activate(context: vscode.ExtensionContext): { extendMarkdownIt(md: any): any } {
  console.log('[Dataview] === activate() START ===');

  try {
    // ─── Step 1: Basic setup ─────────────────────────────────
    console.log('[Dataview] Step 1: Configuration...');
    const config = vscode.workspace.getConfiguration('dataview');
    const excludedFolders = config.get<string[]>('excludedFolders') || [];

    // ─── Step 2: Indexer ─────────────────────────────────────
    console.log('[Dataview] Step 2: Creating IndexerService...');
    indexer = new IndexerService();
    console.log('[Dataview] Step 2b: Starting index...');
    indexer.initialize(excludedFolders).then(() => {
      console.log('[Dataview] Indexing complete.');
    }).catch(err => {
      console.error('[Dataview] Indexing failed:', err);
    });
    console.log('[Dataview] Step 2c: Registering disposable...');
    context.subscriptions.push(indexer);

    // ─── Step 3: Config watcher ──────────────────────────────
    console.log('[Dataview] Step 3: Config watcher...');
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration('dataview.excludedFolders')) {
          const newExcluded = vscode.workspace.getConfiguration('dataview')
            .get<string[]>('excludedFolders') || [];
          await indexer?.setExcludedFolders(newExcluded);
        }
      })
    );

    // ─── Step 4: Commands ────────────────────────────────────
    console.log('[Dataview] Step 4: Registering commands...');
    try { context.subscriptions.push(
      vscode.commands.registerCommand('dataview.reindex', async () => {
        if (indexer) {
          await indexer.setExcludedFolders(
            vscode.workspace.getConfiguration('dataview')
              .get<string[]>('excludedFolders') || []
          );
          vscode.window.showInformationMessage(
            `Dataview: Indexed ${indexer.getStats().pageCount} pages.`
          );
        }
      })
    ); } catch {}

    try { context.subscriptions.push(
      vscode.commands.registerCommand('dataview.showIndexStats', () => {
        if (indexer) {
          const stats = indexer.getStats();
          vscode.window.showInformationMessage(
            `Dataview Index: ${stats.pageCount} pages, ${stats.tagCount} tags, ${stats.inlinkCount} pages with inlinks.`
          );
        }
      })
    ); } catch {}

    try { context.subscriptions.push(
      vscode.commands.registerCommand('dataview.openFile', async (args: { path: string }) => {
        if (!args?.path) return;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return;
        const root = workspaceFolders[0].uri.fsPath;
        const fullPath = path.join(root, args.path);
        try {
          const doc = await vscode.workspace.openTextDocument(fullPath);
          await vscode.window.showTextDocument(doc);
        } catch (err) {
          vscode.window.showErrorMessage(`Cannot open file: ${args.path}`);
        }
      })
    ); } catch {}

    console.log('[Dataview] === activate() DONE ===');
  } catch (err) {
    console.error('[Dataview] activate() CRASHED:', err);
  }

  // The markdown-it plugin MUST be returned from activate(), not pushed to subscriptions.
  return {
    extendMarkdownIt(md: any) {
      console.log('[Dataview] extendMarkdownIt() called');
      try {
        if (!indexer) {
          console.log('[Dataview] No indexer, returning md unchanged');
          return md;
        }
        const currentConfig = vscode.workspace.getConfiguration('dataview');
        const pluginConfig: DataviewPluginConfig = {
          enableJavascript: currentConfig.get<boolean>('enableJavascript') || false,
          enableInlineQueries: currentConfig.get<boolean>('enableInlineQueries') || true,
          warnOnEmptyResult: currentConfig.get<boolean>('warnOnEmptyResult') || true,
          javascriptTrustedPaths: currentConfig.get<string[]>('javascriptTrustedPaths') || [],
        };
        const plugin = createDataviewPlugin(indexer, pluginConfig);
        return plugin(md);
      } catch (err) {
        console.error('[Dataview] extendMarkdownIt() ERROR:', err);
        return md;
      }
    },
  };
}

export function deactivate(): void {
  indexer?.dispose();
  indexer = null;
}
