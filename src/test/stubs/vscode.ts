/**
 * Minimal `vscode` module stub for tests that run outside the extension host.
 * `esbuild-test.js` aliases `vscode` imports to this file.
 *
 * Provides just enough API surface for `IndexerService`, `createDataviewPlugin`
 * and `activate()` to run in plain Node against a real folder. The workspace
 * root is read lazily from `DATAVIEW_TEST_ROOT` so tests can set it in
 * `before()`.
 */
import * as fs from 'fs';
import * as path from 'path';

function workspaceRoot(): string {
  return process.env.DATAVIEW_TEST_ROOT || '/workspace';
}

class Uri {
  constructor(public fsPath: string) {}
  static file(p: string): Uri {
    return new Uri(p);
  }
  get path(): string {
    return this.fsPath;
  }
  get scheme(): string {
    return 'file';
  }
  toString(): string {
    return this.fsPath;
  }
}

class RelativePattern {
  constructor(_base: any, public pattern: string) {}
}

/** Walk a folder for markdown files (excludes dev/build dirs). */
function walkMarkdown(dir: string): string[] {
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

const registeredCommands: Record<string, (...args: any[]) => any> = {};

const commands = {
  registerCommand: (id: string, handler: (...args: any[]) => any) => {
    registeredCommands[id] = handler;
    return { dispose: () => { delete registeredCommands[id]; } };
  },
  /** Test accessor: registered command handlers. */
  _handlers: registeredCommands,
};

const workspace = {
  get workspaceFolders() {
    return [{ uri: new Uri(workspaceRoot()) }];
  },
  getConfiguration: () => ({
    get: (_key: string, def?: any) => def,
  }),
  findFiles: async () => walkMarkdown(workspaceRoot()).map((p) => new Uri(p)),
  createFileSystemWatcher: () => ({
    onDidCreate: () => ({ dispose() {} }),
    onDidChange: () => ({ dispose() {} }),
    onDidDelete: () => ({ dispose() {} }),
    dispose() {},
  }),
  onDidChangeConfiguration: () => ({ dispose() {} }),
  openTextDocument: async (uri: Uri | string) => {
    const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
    const text = fs.readFileSync(fsPath, 'utf-8');
    const lines = text.split('\n');
    return {
      uri: typeof uri === 'string' ? new Uri(uri) : uri,
      getText: () => text,
      lineCount: lines.length,
      lineAt: (line: number) => ({ text: lines[line] || '', lineNumber: line }),
    };
  },
  applyEdit: async () => true,
};

const window = {
  activeTextEditor: undefined,
  createStatusBarItem: () => ({ show: () => {}, hide: () => {}, dispose: () => {}, text: '', tooltip: '', command: '' }),
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showTextDocument: async () => undefined,
};

const StatusBarAlignment = { Left: 1, Right: 2 };

class Range {
  constructor(
    public startLine: number, public startCharacter: number,
    public endLine: number, public endCharacter: number,
  ) {}
}

class WorkspaceEdit {
  replace(_uri: Uri, _range: Range, _newText: string): void {}
}

export {
  Uri,
  RelativePattern,
  Range,
  WorkspaceEdit,
  StatusBarAlignment,
  workspace,
  window,
  commands,
  workspace as workspaceApi,
  window as windowApi,
  commands as commandsApi,
};

export default { workspace, window, commands, Uri, RelativePattern, Range, WorkspaceEdit, StatusBarAlignment };
