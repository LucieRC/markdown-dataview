# Dataview for VS Code Markdown Preview

Bring **[Obsidian Dataview](https://github.com/blacksmithgu/obsidian-dataview)** query power to VS Code's built-in Markdown preview.

Query your workspace's Markdown notes using **DQL (Dataview Query Language)** — with support for TABLE, LIST, TASK, and CALENDAR views, plus inline expressions and DataviewJS.

## Features

- 🔍 **Automatic indexing** of all Markdown files with live-updating
- 📊 **TABLE queries** with custom columns, sorting, `GROUP BY`, `FLATTEN`, and aggregate functions (`sum`/`average`/`min`/`max`/`length(rows)`) with automatic summary rows
- 📋 **LIST queries** with optional extra fields
- ✅ **TASK queries** across all files, with due dates and emoji shorthands (🗓️ ✅ ⏳ 🛫)
- 📅 **CALENDAR view** for date-based data
- 🧮 **Inline expressions** — `` `= this.file.name` `` renders current page metadata
- 🏷️ **Inline fields** — `[key:: value]` and `key:: value` syntax, with visual rendering
- 🧩 **DataviewJS** support (optional, with trusted-path security control)
- 📦 **70+ built-in functions** — date, string, list, math, logic operations
- 🏷️ **Full metadata support**: YAML frontmatter, tags, wikilinks, implicit fields
- ⚡ **Parallel indexing** — 8x concurrent file processing for large workspaces

## Usage

### DQL Queries

Create a `` ```dataview `` code block in any Markdown file:

````markdown
```dataview
TABLE file.ctime AS "Created", file.mtime AS "Modified"
FROM "notes"
WHERE file.size > 100
SORT file.mtime DESC
LIMIT 10
```
````

### Query Types

| Type | Description | Example |
|------|-------------|---------|
| `TABLE` | Tabular output with configurable columns | `TABLE field1, field2 AS "Label" FROM #tag` |
| `LIST` | Bulleted list of files | `LIST FROM "projects"` |
| `TASK` | Task list across files | `TASK FROM #todo` |
| `CALENDAR` | Calendar view by date | `CALENDAR due FROM #project` |

### Pipeline Commands

```dataview
TABLE column1, column2 AS "Name"
FROM #tag AND "folder"
WHERE condition
SORT field ASC
GROUP BY category
FLATTEN tags
LIMIT 20
```

- `FROM` — filter by tag (`#tag`), folder (`"path"`), file, or link (`[[page]]`)
- `WHERE` — filter rows with boolean expressions
- `SORT` — sort by one or more fields (ASC/DESC)
- `GROUP BY` — group results with `rows.field` swizzling
- `FLATTEN` — expand array fields into multiple rows
- `LIMIT` — restrict result count

### Aggregate Queries

Aggregate functions collapse the matched rows into a single summary row (or per-group rows with `GROUP BY`). Multi-line column lists are supported:

````markdown
```dataview
TABLE WITHOUT ID
  sum(file.tasks.length) AS "Total Tasks",
  average(budget) AS "Avg Budget",
  min(budget) AS "Min Budget",
  max(budget) AS "Max Budget",
  length(rows) AS "Projects"
FROM #project
```
````

### Inline Expressions

Use backtick-wrapped expressions in your prose:

```markdown
Created: `= this.file.ctime`
Tags: `= this.file.tags`
Rating: `= this.rating`
```

### Metadata Sources

Dataview indexes three sources of metadata:

1. **Implicit fields** — `file.name`, `file.path`, `file.ctime`, `file.mtime`, `file.size`, `file.tags`, `file.inlinks`, `file.outlinks`, `file.tasks`, and more
2. **YAML Frontmatter** — All fields in `---` blocks are queryable with dot notation for nested objects
3. **Inline fields** — `Key:: Value` syntax within Markdown body

### Available Functions

| Category | Functions |
|----------|-----------|
| Constructors | `date()`, `dur()` |
| Type checking | `typeof()`, `isnumber()`, `isstring()`, `isdate()`, `islink()`, etc. |
| Numeric | `round()`, `floor()`, `ceil()`, `min()`, `max()`, `sum()`, `average()` |
| String | `lower()`, `upper()`, `contains()`, `length()`, `regexmatch()`, `replace()`, `split()`, `join()`, `trim()` |
| List | `filter()`, `map()`, `flat()`, `extract()`, `sort()`, `reverse()`, `nonnull()` |
| Date | `dateformat()`, `dateadd()`, `datestart()`, `dateend()`, `striptime()` |
| Logic | `default()`, `choice()` |

### DataviewJS (Optional)

Enable DataviewJS in settings (`dataview.enableJavascript: true`), then use:

````markdown
```dataviewjs
dv.table(["Name", "Created"], dv.pages("#project")
  .sort(p => p.file.ctime, "desc")
  .limit(10)
  .map(p => [p.file.name, p.file.ctime]))
```
````

Use `dv.span()` / `dv.paragraph()` to append formatted text (inline markdown such as `**bold**` is rendered):

````markdown
```dataviewjs
const projects = dv.pages("#project");
dv.span("**Projects:** " + projects.length);
dv.paragraph("Total budget: " + projects.array().reduce((s, p) => s + (p.budget || 0), 0));
```
````

> ⚠️ **Security Warning**: DataviewJS runs arbitrary JavaScript from your notes in the Markdown preview. Only enable if you trust all content in your workspace.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `dataview.enableJavascript` | `false` | Enable DataviewJS code blocks |
| `dataview.enableInlineQueries` | `true` | Enable inline `= expr` expressions |
| `dataview.defaultDateFormat` | `"yyyy-MM-dd"` | Default date format |
| `dataview.warnOnEmptyResult` | `true` | Show warning for empty query results |
| `dataview.taskEmojis` | `true` | Parse task emoji shorthands (🗓️, ✅, etc.) |
| `dataview.excludedFolders` | `["node_modules", ".git", ".vscode"]` | Folders to exclude from indexing |
| `dataview.javascriptTrustedPaths` | `[]` | Folder paths trusted for DataviewJS. Empty = trust all. |

## Commands

- **Dataview: Re-index workspace** — Force a full reindex of all Markdown files
- **Dataview: Show index statistics** — Display page/tag/inlink counts

## Requirements

- VS Code 1.95.0 or later

## Known Limitations

- DataviewJS is sandboxed in the preview webview and cannot access the filesystem or VS Code API
- TASK queries are read-only (checking a task in the preview does not modify the source file)
- Link dereferencing (`[[Page]].field`) is limited to indexed pages
- Very large workspaces (10,000+ files) may experience slower indexing on startup

## Development

```sh
npm test          # type-check + run the automated test suite
npm run build     # type-check + bundle extension & preview
npm run package   # create the .vsix
```

The suite covers the parser, expression engine, query engine (integration against the real `test/` vault), and markdown-it plugin rendering. Standalone debug harnesses (`scripts/debug-query.ts`, `scripts/debug-links.ts`) run the real parser/engine without launching VS Code.

## License

MIT
