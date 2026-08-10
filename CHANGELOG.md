# Changelog

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
