import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownPage } from '../../indexer/parser';
import { PageMetadata } from '../../indexer/types';

const STAT = { ctimeMs: 1000, mtimeMs: 2000, size: 42 };

function parse(content: string, filePath = 'notes/sample.md'): PageMetadata {
  return parseMarkdownPage(content, filePath, STAT).metadata;
}

test('frontmatter fields are parsed and flattened onto metadata', () => {
  const md = parse(
    `---
title: Hello
rating: 9
tags: [a, b]
status: published
---
Body`,
    'notes/hello.md'
  );
  assert.equal(md.title, 'Hello');
  assert.equal(md.rating, 9);
  assert.equal(md.status, 'published');
  assert.equal(md.file.name, 'hello');
  assert.equal(md.file.folder, 'notes');
  assert.equal(md.file.path, 'notes/hello.md');
  assert.equal(md.file.ext, 'md');
});

test('inline fields (visible + hidden) become metadata', () => {
  const md = parse(
    'This is [priority:: high] and (hidden-note:: secret) here.\nTag:: [[Non-Fiction]]'
  );
  assert.equal(md.priority, 'high');
  assert.equal(md['hidden-note'], 'secret');
  // Wikilink values become Link objects under the normalized key
  const tag: any = (md as any).tag;
  assert.equal(tag?.type, 'link');
  assert.equal(tag?.path, 'Non-Fiction');
});

test('tags include subtag breakdown and skip code blocks', () => {
  const md = parse(`#a/b/c

\`\`\`dataview
list from #not-a-tag
\`\`\`
`);
  assert.deepEqual(md.file.tags, ['#a', '#a/b', '#a/b/c']);
  assert.ok(!md.file.tags.includes('#not-a-tag'));
});

test('wikilinks are extracted as outlinks (with display/subpath)', () => {
  const md = parse('- Link: [[projects/project-alpha|Project Alpha]]\n- Heading: [[demo#Section]]');
  const paths = md.file.outlinks.map((l) => l.path);
  assert.ok(paths.includes('projects/project-alpha'));
  assert.ok(paths.includes('demo'));
  const heading = md.file.outlinks.find((l) => l.path === 'demo');
  assert.equal(heading?.subpath, 'Section');
});

test('links inside dataview code fences are NOT outlinks', () => {
  const md = parse('```dataview\nlist from [[Non-Fiction]]\n```');
  assert.equal(md.file.outlinks.length, 0);
});

test('tasks: status, text, emoji date shorthands, nesting', () => {
  const md = parse(
    '- [x] Completed task ✅2026-08-01\n' +
      '- [ ] Has due 🗓️2026-08-20\n' +
      '  - [ ] Nested subtask\n' +
      '- Plain item'
  );
  // file.tasks = top-level tasks only; nested tasks live in children
  assert.equal(md.file.tasks.length, 2);
  const [t0, t1] = md.file.tasks;

  assert.equal(t0.status, 'x');
  assert.equal(t0.completed, true);
  assert.equal(t0.text, 'Completed task ✅2026-08-01'); // emoji kept in text
  assert.equal(t0.lineNumber, 0);

  assert.equal(t1.status, ' ');
  assert.equal(t1.completed, false);
  assert.equal(t1.due?.value, '2026-08-20');

  // nested subtask is a child of t1, not a top-level task
  assert.ok(t1.children.some((c: any) => c.text === 'Nested subtask'));
});

test('file day derived from filename date', () => {
  const md = parse('content', 'journal/2026-08-01-note.md');
  assert.equal(md.file.day?.value, '2026-08-01');
});

test('frontmatter date values become SDate objects', () => {
  const md = parse('---\ndeadline: 2026-09-15\n---\nBody', 'x.md');
  assert.equal((md.deadline as any)?.type, 'date');
  assert.ok((md.deadline as any)?.value.startsWith('2026-09-15'));
});
