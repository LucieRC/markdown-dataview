---
title: Dataview Feature Showcase
author: VS Code Dataview
rating: 9
tags:
  - demo
  - showcase
status: published
created: 2026-08-01
updated: 2026-08-07
version: "2.0"
---

# 🚀 Dataview Feature Showcase

> [!tip] About
> This note demonstrates all core features of the VS Code Dataview extension. Open the Markdown preview to see Dataview queries rendered in real time.

---

## 1. Inline Expressions

Use `` `= expression` `` syntax to embed dynamic data inline.

| Expression | Output | Description |
|-----------|--------|-------------|
| `` `= this.file.name` `` | `= this.file.name` | Current file name |
| `` `= this.file.folder` `` | `= this.file.folder` | Parent folder |
| `` `= this.file.ext` `` | `= this.file.ext` | File extension |
| `` `= this.file.size` `` | `= this.file.size` | File size (bytes) |
| `` `= this.file.ctime` `` | `= this.file.ctime` | Created time |
| `` `= this.file.mtime` `` | `= this.file.mtime` | Modified time |
| `` `= this.title` `` | `= this.title` | Frontmatter field |
| `` `= this.rating` `` | `= this.rating` | Rating |
| `` `= length(this.file.tags)` `` | `= length(this.file.tags)` | Tag count (function) |
| `` `= date(today)` `` | `= date(today)` | Today's date |

---

## 2. Inline Fields

### Visible `[key:: value]`

This page is tagged as: type [type:: showcase], priority [priority:: high], difficulty [difficulty:: 3].

Target audience: [audience:: developers], [audience:: users]

### Hidden `(key:: value)`

This field is completely hidden in the preview: (hidden-note:: This is a hidden field, invisible in preview)

More hidden fields: (internal-id:: DWV-001) (cache-ttl:: 3600)

---

## 3. TABLE Queries

### 3.1 Basic TABLE — Filter by Tag

```dataview
TABLE file.ctime AS "Created", file.mtime AS "Modified", rating, status
FROM #demo
SORT file.ctime DESC
```

### 3.2 TABLE — Filter by Folder

```dataview
TABLE file.name AS "Name", status, priority
FROM "test/projects"
SORT file.name ASC
```

### 3.3 TABLE — With WHERE Filter

```dataview
TABLE file.name, budget, deadline, status
FROM #project
WHERE budget > 50000
SORT budget DESC
```

### 3.4 TABLE — String Functions

```dataview
TABLE file.name AS "File", upper(status) AS "Status", length(file.name) AS "Name Length"
FROM #project
```

### 3.5 TABLE — WITHOUT ID

```dataview
TABLE WITHOUT ID file.link AS "Link", status AS "Status", priority AS "Priority"
FROM "test/projects"
```

### 3.6 TABLE — Using contains / regexmatch

```dataview
TABLE file.name, status, priority
FROM #project
WHERE contains(status, "active") OR contains(status, "planning")
```

### 3.7 TABLE — Multiple Tags

```dataview
TABLE file.name, file.tags
FROM #demo AND #meeting
```

---

## 4. GROUP BY

```dataview
TABLE file.name AS "Project", budget AS "Budget", deadline AS "Deadline"
FROM #project
GROUP BY status
```

---

## 5. FLATTEN

```dataview
TABLE WITHOUT ID file.name AS "Project", team AS "Member", deadline AS "Deadline"
FROM #project
FLATTEN team
```

---

## 6. LIMIT

```dataview
TABLE file.name, budget
FROM #project
SORT budget DESC
LIMIT 3
```

---

## 7. LIST Queries

### 7.1 Basic LIST

```dataview
LIST FROM "test/notes"
```

### 7.2 LIST — By Tag

```dataview
LIST FROM #project
```

### 7.3 LIST — With Expression

```dataview
LIST budget + " ¥" FROM #project
```

---

## 8. TASK Queries

```dataview
TASK FROM #project
```

### 8.1 TASK — With Due Date

```dataview
TASK FROM #project
WHERE due
SORT due ASC
```

### 8.2 TASK — Completed

```dataview
TASK FROM #project
WHERE completed
```

---

## 9. CALENDAR View

```dataview
CALENDAR deadline
FROM #project
```

---

## 10. Aggregate Functions

```dataview
TABLE WITHOUT ID
  sum(file.tasks.length) AS "Total Tasks",
  average(budget) AS "Avg Budget",
  min(budget) AS "Min Budget",
  max(budget) AS "Max Budget",
  length(rows) AS "Projects"
FROM #project
```

---

## 11. DataviewJS

```dataviewjs
const pages = dv.pages("#project").sort(p => p.budget, "desc");
dv.table(
  ["Project", "Status", "Budget", "Deadline", "Team"],
  pages.map(p => [
    p.file.link,
    p.status,
    p.budget + " ¥",
    p.deadline,
    p.team ? p.team.join(", ") : "-"
  ])
);
```

### 11.1 DataviewJS — Summary

```dataviewjs
const projects = dv.pages("#project");
const total = projects.length;
const totalBudget = projects.array().reduce((sum, p) => sum + (p.budget || 0), 0);
const avgBudget = total > 0 ? Math.round(totalBudget / total) : 0;

dv.span("**Projects:** " + total + "  |  ");
dv.span("**Total Budget:** " + totalBudget.toLocaleString() + " ¥  |  ");
dv.span("**Avg Budget:** " + avgBudget.toLocaleString() + " ¥");
```

---

## 12. Tasks & Date Shorthands

Tasks support emoji date shorthands, queryable via Dataview TASK queries:

- [x] Completed task ✅2026-08-01
- [ ] Has due date 🗓️2026-08-20
- [ ] Has start date 🛫2026-08-10
- [ ] Has scheduled date ⏳2026-08-15
- [ ] Plain task

---

*See also: [README](README.md) for extension usage documentation.*
