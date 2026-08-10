# AGENTS.md — markdown-dataview

## Build & Debug

| Command | Purpose |
|---------|---------|
| `npm run build` | Type-check (`tsc --noEmit`) + bundle extension (`dist/extension.js`) + bundle preview (`dist/preview.js`) |
| `npm run watch` | Same as build, with file watchers |
| `npm run package` | Create `.vsix` via `@vscode/vsce` |
| `F5` | Debug: launches Extension Development Host with `test/` as workspace root |

There are **three esbuild scripts**:
- `esbuild.js` → `dist/extension.js` (CJS, Node)
- `esbuild-preview.js` → `dist/preview.js` (IIFE, browser) + `dist/preview.css`
- `esbuild-notebook.js` → `dist/notebook.js` (ESM, browser)

## Architecture

```
extension.ts                ← activate → IndexerService + extendMarkdownIt
  ├─ indexer/              ← Page index (full-scan, watchers, in-memory)
  │   ├─ types.ts          ← ALL core types (PageMetadata, Expression AST, ParsedQuery, etc.)
  │   ├─ parser.ts         ← Markdown parser (frontmatter, tasks, tags, wikilinks, inline fields)
  │   └─ index.ts          ← IndexerService
  ├─ expression/           ← DQL expression engine
  │   ├─ parser.ts         ← Tokenizer + recursive-descent ExpressionParser
  │   ├─ evaluator.ts      ← AST evaluator, type guards, value utilities
  │   └─ functions.ts      ← ~50 built-in functions (date, string, list, math)
  ├─ query/
  │   ├─ parser.ts         ← QueryParser (TABLE/LIST/TASK/CALENDAR + FROM/WHERE/SORT/…)
  │   └─ engine.ts         ← QueryEngine (resolve → filter → sort → group → flatten → limit)
  ├─ markdown/
  │   └─ plugin.ts         ← markdown-it plugin (fences, inline expressions, wikilinks, fields)
  └─ preview/
      ├─ index.ts          ← DOM-based renderer (reads data-result JSON → dispatches)
      └─ renderers/        ← table.ts, list.ts, task.ts, calendar.ts
```

Full data flow: [README.md](README.md)

## Debug Harnesses

Reusable standalone scripts for diagnosing indexer/engine behavior WITHOUT launching VS Code (no `vscode` dependency). Reuse these instead of writing ad-hoc scripts; keep them in sync when changing resolution logic.

- `scripts/debug-query.ts` — runs the REAL `QueryParser` + `QueryEngine` against a folder using a mock indexer (page index + inlink index mirrored from `IndexerService`). Great for checking what `FROM "folder"`, `FROM [[link]]`, etc. actually return.
- `scripts/debug-links.ts` — replicates link resolution only (`resolveLinkTarget` / `buildInlinkIndex`) to diagnose `FROM [[X]]` inlink issues.

Build & run (esbuild bundles TS → temp CJS; delete the `.cjs` after):

```sh
./node_modules/.bin/esbuild scripts/debug-query.ts --bundle --platform=node --format=cjs --outfile=scripts/debug-query.cjs --external:vscode
node scripts/debug-query.cjs [root]     # default root = test/; pass a vault folder to simulate vault-as-root
```

## Testing

Automated suite (~88 tests) covering parser, expression engine, query engine (integration against the real `test/` vault), markdown-it plugin rendering, preview renderers, the REAL `IndexerService`, and the extension `activate()`/commands:

```sh
npm test          # type-check + bundle tests (esbuild-test.js) + run node --test
```

- Test files live in `src/test/**/*.test.ts`; `esbuild-test.js` bundles each into `dist/test/` (CJS) and aliases `vscode` → `src/test/stubs/vscode.ts` so plugin/indexer/extension tests run in plain Node.
- `src/test/helpers.ts buildIndex(root)` builds a MOCK indexer (mirrors `IndexerService` resolution incl. dangling links + folder suffix). `src/test/indexer/index.test.ts` instead drives the REAL `IndexerService` + `QueryEngine` end-to-end against the vault — use this to catch mock drift.
- `DATAVIEW_TEST_ROOT` (set to `$PWD/test` by `npm test`) is the stub workspace root; the stub reads it lazily.
- Preview renderers only write `container.innerHTML`, so they're tested with a plain `{ innerHTML: '' }` fake (no jsdom needed).
- Extend `src/test/query/engine.test.ts` when changing resolution; add coverage for any new DQL feature.

## Key Pitfalls

1. **`extendMarkdownIt` must be returned from `activate()`**, not pushed to `context.subscriptions`. VS Code only picks it up if it's a return property.

2. **Hidden inline fields `(key:: value)`** use a `md.core` rule (post-processes text tokens), NOT `md.inline.ruler`. The `(` character is consumed by markdown-it internals before inline rules can match it.

3. **Code block tag stripping**: `stripCodeBlocks()` in `parser.ts` must run BEFORE `extractTags()` to prevent `#tag` inside dataview fences from being indexed as page tags.

4. **Inline rule order matters**: Rules registered with `md.inline.ruler.before('escape', ...)` are tried in reverse registration order. The last registered runs first. Place more specific rules (wikilinks `[[`) before general ones (fields `[key::`).

5. **Subtag breakdown**: `#a/b/c` yields tags `[#a, #a/b, #a/b/c]` everywhere — both inline tags and frontmatter arrays.

6. **Array auto-mapping (swizzling)**: `evaluateField` maps over arrays: `arr.field` → `[e1.field, e2.field, ...]`.

7. **Date formatting**: `formatLocalISO` / `formatLocalDate` in `types.ts` use local timezone with `YYYY-MM-DD HH:mm:ss` format (no `T`, no offset). Apply consistently when creating `SDate` objects.

8. **Workspace root mismatch**: F5 debug opens `test/` as workspace root. Folder paths in queries are relative to workspace root. `FROM "test/projects"` won't work; use `FROM "projects"`.
