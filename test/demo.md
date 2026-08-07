---
title: Test Note
author: Dataview
rating: 8
tags:
  - project
  - demo
status: active
created: 2026-08-01
reviewed: 2026-08-07
---

# Dataview Test Note

This is a test note to verify the Dataview VS Code extension.

## Inline Expressions

The current file name is: `= this.file.name`

Created on: `= this.file.ctime`

Rating: `= this.rating` / 10

## Inline Fields

This project has a priority of [priority:: high] and the budget is [budget:: 50000].

target-date:: 2026-12-31

## Dataview Queries

### TABLE Query

```dataview
TABLE file.ctime AS "Created", file.mtime AS "Modified", rating, status
FROM #demo
SORT file.ctime DESC
```

### LIST Query

```dataview
LIST FROM "test"
```

### TASK Query

```dataview
TASK FROM #project
```

### With WHERE

```dataview
TABLE file.name, rating, author
FROM #demo
WHERE rating > 5
SORT rating DESC
```

### Inline Fields Query

```dataview
TABLE priority, budget, target-date AS "Target"
FROM #demo
WHERE priority
```

### GROUP BY

```dataview
TABLE status, budget, deadline
FROM #project
GROUP BY status
```

### FLATTEN

```dataview
TABLE file.name, team
FROM #project
FLATTEN team
```

### CALENDAR

```dataview
CALENDAR deadline
FROM #project
```

### DataviewJS

```dataviewjs
const pages = dv.pages("#project").sort(p => p.deadline);
dv.table(
  ["Project", "Status", "Deadline", "Budget"],
  pages.map(p => [
    p.file.name,
    p.status,
    p.deadline,
    p.budget
  ])
);
```

## Tasks

- [ ] Write documentation 🗓️2026-08-15
- [x] Initial setup ✅2026-08-01
- [ ] Review with team ⏳2026-08-10
- [ ] Deploy to production 🛫2026-08-20
