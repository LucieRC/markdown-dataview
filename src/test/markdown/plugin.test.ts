import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import MarkdownIt from 'markdown-it';
import { buildIndex } from '../helpers';
import { createDataviewPlugin, DataviewPluginConfig } from '../../markdown/plugin';

const PROJECT_ROOT = process.cwd();
const VAULT_ROOT = path.resolve(PROJECT_ROOT, 'test');

let md: MarkdownIt;
// JS-enabled instances: trusted (no warning) and untrusted (warning)
let mdJS: MarkdownIt;
let mdJSWarn: MarkdownIt;
const env = {
  currentDocument: { _fsPath: path.join(VAULT_ROOT, 'demo.md') },
};

before(() => {
  if (!fs.existsSync(VAULT_ROOT)) {
    throw new Error(`Vault root not found: ${VAULT_ROOT}`);
  }
  const { indexer } = buildIndex(VAULT_ROOT);
  const base: DataviewPluginConfig = {
    enableJavascript: false,
    enableInlineQueries: true,
    warnOnEmptyResult: true,
    javascriptTrustedPaths: [],
  };
  md = new MarkdownIt({ html: true });
  createDataviewPlugin(indexer, { ...base, enableJavascript: false })(md);

  mdJS = new MarkdownIt({ html: true });
  createDataviewPlugin(indexer, { ...base, enableJavascript: true })(mdJS);

  mdJSWarn = new MarkdownIt({ html: true });
  createDataviewPlugin(indexer, { ...base, enableJavascript: true, javascriptTrustedPaths: ['blocked'] })(mdJSWarn);
});

function render(src: string): string {
  return md.render(src, env);
}

function renderJS(src: string, jsMd: MarkdownIt = mdJS): string {
  return jsMd.render(src, env);
}

test('dataview fence renders a result placeholder with serialized data', () => {
  const html = render('```dataview\nlist from [[Non-Fiction]]\n```');
  assert.ok(html.includes('dataview-result'));
  assert.ok(html.includes('data-type="list"'));
  assert.ok(html.includes('Origin of Species'));
});

test('dataview fence with empty result shows warning when enabled', () => {
  const html = render('```dataview\nlist from #no-such-tag\n```');
  assert.ok(html.includes('No results to show.'));
});

test('visible inline field renders key + value', () => {
  const html = render('This is [priority:: high] here');
  assert.ok(html.includes('dataview-inline-field'));
  assert.ok(html.includes('priority'));
  assert.ok(html.includes('high'));
});

test('hidden inline field renders value only', () => {
  const html = render('Secret (note:: secret-value) hidden');
  assert.ok(html.includes('secret-value'));
  assert.ok(!html.includes('note::'));
});

test('wikilinks render as dataview links', () => {
  const html = render('See [[demo|Demo Note]]');
  assert.ok(html.includes('dataview-wikilink'));
  assert.ok(html.includes('Demo Note'));
});

test('dataview TASK fence renders a placeholder with serialized tasks', () => {
  const html = render('```dataview\nTASK FROM #project\n```');
  assert.ok(html.includes('dataview-result'));
  assert.ok(html.includes('data-type="task"'));
  assert.ok(html.includes('Implement core module') || html.includes('Literature review'));
});

test('plain task lists render as literal markdown (no checkbox feature)', () => {
  const html = render('- [ ] Todo item\n- [x] Done item');
  assert.ok(!html.includes('dataview-checkbox'));
  assert.ok(html.includes('[ ]')); // marker left as text by default markdown-it
});

test('inline expression renders current page metadata', () => {
  const html = render('Name: `= this.file.name`');
  assert.ok(html.includes('dataview-inline'));
  assert.ok(html.includes('demo'));
});

test('dataviewjs fence falls back to a code block when JS is disabled', () => {
  const html = render('```dataviewjs\ndv.span("hi")\n```');
  assert.ok(!html.includes('dataviewjs-result'));
});

test('dataviewjs fence renders a placeholder with serialized pages when enabled', () => {
  const html = renderJS('```dataviewjs\ndv.span("hi")\n```');
  assert.ok(html.includes('dataviewjs-result'));
  assert.ok(html.includes('project-alpha')); // serialized page data
  assert.ok(!html.includes('dataviewjs-warning')); // trusted by default
});

test('dataviewjs fence shows a security warning for untrusted paths', () => {
  const html = renderJS('```dataviewjs\ndv.span("hi")\n```', mdJSWarn);
  assert.ok(html.includes('dataviewjs-result'));
  assert.ok(html.includes('dataviewjs-warning'));
});
