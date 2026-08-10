# Changelog

## [1.0.3] - 2026-08-10

### Added
- Aggregate functions in TABLE queries (`sum`, `average`, `min`, `max`, `length(rows)`) with automatic summary rows (per-group rows with `GROUP BY`)
- Multi-line TABLE column lists
- DataviewJS `dv.span()` / `dv.paragraph()` for formatted text (renders inline markdown)
- Link source `FROM [[X]]` now resolves by filename anywhere in the vault and works for dangling/unresolved links (matches Obsidian Dataview)
- Folder queries fall back to suffix matching when the vault is nested under the workspace root
- Automated test suite (89 tests) via `npm test`, including real `IndexerService` integration and preview renderer tests
- Debug harnesses: `scripts/debug-query.ts`, `scripts/debug-links.ts`

### Fixed
- `min()` / `max()` now correctly aggregate a single list argument
- `array.length` now returns the element count (e.g. `file.tasks.length`)
- Calendar renderer parses the local `YYYY-MM-DD HH:mm:ss` date format
- Multi-line aggregate queries no longer drop their columns

### Removed
- Experimental notebook output (`src/notebook.ts`, `esbuild-notebook.js`)

## [1.0.2] - 2026-08-10

### Added
- WikiLink `[[target|display]]` rendering in Markdown preview (clickable links)
- `CHANGELOG.md`

### Fixed
- Hidden inline fields `(key:: value)` now properly rendered (value only)
- Visible inline fields `[key:: value]` now show both key and value
- `WITHOUT ID` clause: regex `$` anchor prevented removal when placed before columns
- Single-line DQL queries (`LIST FROM #tag`) now correctly parse FROM/WHERE clauses
- Tags inside fenced code blocks no longer falsely extracted as page tags
- Date values now formatted in local timezone instead of UTC
- Demo (test) file updated with comprehensive English feature showcase

## [1.0.1] - 2026-08-07

### Fixed
- Local timezone date formatting for file create/modify times

## [1.0.0] - Initial Release

### Features
- Automatic indexing of all Markdown files with live-updating
- TABLE queries with custom columns, sorting, GROUP BY, and FLATTEN
- LIST queries with optional extra fields
- TASK queries across all files, with due dates and emoji shorthands
- CALENDAR view for date-based data
- Inline expressions (`= this.file.name`)
- Inline fields (`[key:: value]` and `(key:: value)`)
- DataviewJS support (optional, with trusted-path security control)
- 60+ built-in functions (date, string, list, math, logic)
- Full metadata support: YAML frontmatter, tags, wikilinks, implicit fields
- Parallel indexing (8x concurrent file processing)
