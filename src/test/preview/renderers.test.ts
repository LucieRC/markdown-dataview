import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTable } from '../../preview/renderers/table';
import { renderList } from '../../preview/renderers/list';
import { renderTaskList } from '../../preview/renderers/task';
import { renderCalendar } from '../../preview/renderers/calendar';
import { renderInlineMarkdown } from '../../preview/markdown';

// Renderers only write to `container.innerHTML`, so a plain object suffices.
function container(): any {
  return { innerHTML: '' };
}

test('table renderer builds an HTML table with columns and links', () => {
  const c = container();
  renderTable(c, {
    type: 'table',
    data: [
      {
        _page: { file: { name: 'alpha', link: { path: 'a', display: 'alpha' } } },
        budget: 120000,
      },
    ],
    columns: [{ field: 'budget', alias: 'Budget' }],
    withoutId: false,
    isGrouped: false,
    totalCount: 1,
  });
  assert.ok(c.innerHTML.includes('<table class="dataview-table">'));
  assert.ok(c.innerHTML.includes('Budget'));
  assert.ok(c.innerHTML.includes('alpha'));
  assert.ok(c.innerHTML.includes('120000'));
  assert.ok(c.innerHTML.includes('1 result(s)'));
});

test('table WITHOUT ID omits the file column', () => {
  const c = container();
  renderTable(c, {
    type: 'table',
    data: [{ budget: 1 }],
    columns: [{ field: 'budget', alias: 'B' }],
    withoutId: true,
    isGrouped: false,
    totalCount: 1,
  });
  assert.ok(!c.innerHTML.includes('dataview-col-file'));
});

test('list renderer builds a bulleted list', () => {
  const c = container();
  renderList(c, {
    data: [{ _page: { file: { name: 'alpha', link: { path: 'a', display: 'alpha' } } } }],
    withoutId: false,
    isGrouped: false,
    totalCount: 1,
  });
  assert.ok(c.innerHTML.includes('<ul'));
  assert.ok(c.innerHTML.includes('alpha'));
});

test('task renderer builds task items with a result count', () => {
  const c = container();
  renderTaskList(c, {
    data: [
      { text: 'Do thing', completed: false, status: ' ', path: 'demo.md', lineNumber: 1 },
      { text: 'Done thing', completed: true, status: 'x', path: 'demo.md', lineNumber: 2 },
    ],
    isGrouped: false,
    totalCount: 2,
  });
  assert.ok(c.innerHTML.includes('dataview-task'));
  assert.ok(c.innerHTML.includes('Do thing'));
  assert.ok(c.innerHTML.includes('2 task(s)'));
});

test('calendar renderer builds a month grid from dates', () => {
  const c = container();
  renderCalendar(c, {
    data: [{ deadline: { type: 'date', value: '2026-09-15 08:00:00', ts: 1 } }],
    columns: [{ field: 'deadline', alias: 'Date' }],
    totalCount: 1,
  });
  assert.ok(c.innerHTML.includes('dataview-calendar-container'));
  assert.ok(c.innerHTML.includes('September'));
});

test('renderers show an empty state for no data', () => {
  const table = container();
  renderTable(table, { type: 'table', data: [], columns: [], withoutId: false, isGrouped: false, totalCount: 0 });
  assert.ok(table.innerHTML.includes('No results to show.'));

  const list = container();
  renderList(list, { data: [], withoutId: false, isGrouped: false, totalCount: 0 });
  assert.ok(list.innerHTML.includes('No results to show.'));
});

test('renderInlineMarkdown converts common inline formatting', () => {
  assert.equal(renderInlineMarkdown('**bold**'), '<strong>bold</strong>');
  assert.equal(renderInlineMarkdown('*italic*'), '<em>italic</em>');
  assert.equal(renderInlineMarkdown('`code`'), '<code>code</code>');
  assert.equal(renderInlineMarkdown('[text](http://x)'), '<a href="http://x">text</a>');
  assert.equal(renderInlineMarkdown('line1\nline2'), 'line1<br>line2');
  // bold wins over italic for **...**
  assert.equal(renderInlineMarkdown('a **b** c'), 'a <strong>b</strong> c');
  // plain text passes through untouched
  assert.equal(renderInlineMarkdown('Total Budget: 200000 ¥'), 'Total Budget: 200000 ¥');
});
