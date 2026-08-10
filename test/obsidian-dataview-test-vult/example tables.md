# Tables
```dataview
table file.mtime as Modified, draft as Draft from "blog"
```

```dataview
table cuisine as Cuisine, needsStove as "Needs Stove"
from "recipes"
```


```dataview
TABLE file.name, file.folder, file.ctime, file.cday, file.mtime, file.mday, file.tags, file.frontmatter
from "recipes"
```

