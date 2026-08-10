import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { activate } from '../extension';
import { commandsApi, windowApi } from './stubs/vscode';

function vaultRoot(): string {
  const fromCwd = path.resolve(process.cwd(), 'test');
  return fs.existsSync(fromCwd) ? fromCwd : path.resolve(__dirname, '..', '..', 'test');
}

let infoMessages: string[] = [];
let openedDocs: string[] = [];

before(() => {
  process.env.DATAVIEW_TEST_ROOT = vaultRoot();

  windowApi.showInformationMessage = (async (msg: any) => { infoMessages.push(String(msg)); return undefined; }) as any;
  windowApi.showTextDocument = (async (doc: any) => { openedDocs.push(doc?.uri?.fsPath ?? ''); return undefined; }) as any;

  const context: any = { subscriptions: [] };
  const ret = activate(context);
  // Must return extendMarkdownIt (the extension relies on the return value)
  assert.ok(ret && typeof ret.extendMarkdownIt === 'function');
});

test('activate registers the dataview commands', () => {
  for (const id of ['dataview.reindex', 'dataview.showIndexStats', 'dataview.openFile']) {
    assert.ok(commandsApi._handlers[id], `missing command ${id}`);
  }
});

test('dataview.reindex re-indexes and reports the page count', async () => {
  infoMessages = [];
  await commandsApi._handlers['dataview.reindex']();
  assert.ok(
    infoMessages.some((m) => /Dataview: Indexed \d+ pages/.test(m)),
    `expected "Indexed N pages" message, got: ${JSON.stringify(infoMessages)}`
  );
});

test('dataview.showIndexStats reports index stats', async () => {
  infoMessages = [];
  await commandsApi._handlers['dataview.showIndexStats']();
  assert.ok(
    infoMessages.some((m) => m.includes('Dataview Index') && /pages/.test(m)),
    `expected stats message, got: ${JSON.stringify(infoMessages)}`
  );
});

test('dataview.openFile opens a valid vault file', async () => {
  openedDocs = [];
  await commandsApi._handlers['dataview.openFile']({ path: 'projects/project-alpha.md' });
  assert.ok(openedDocs.some((p) => p.includes('project-alpha.md')), `opened: ${JSON.stringify(openedDocs)}`);
});
