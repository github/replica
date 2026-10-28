# Control sets

Use one set unless controls have different page lifetimes or shared/page roles. Sets already exist; their labels are accessible names, not visible panel headings.

```json
{
  "version": 1,
  "sets": [
    {
      "version": 1,
      "scope": "layout",
      "label": "Shared layout",
      "role": "shared",
      "controls": [
        {
          "id": "density", "label": "Density", "type": "number", "default": 1,
          "min": 0.5, "max": 2, "step": 0.1,
          "binding": { "type": "style", "selector": ":root", "property": "--density" }
        }
      ]
    },
    {
      "version": 1,
      "scope": "catalog",
      "label": "Catalog page",
      "container": "#catalog-page",
      "panel": { "width": 400 },
      "controls": [
        {
          "id": "items", "label": "Items", "type": "number", "default": 3,
          "min": 1, "max": 20,
          "binding": { "type": "field", "selector": "#item-count" }
        }
      ]
    }
  ]
}
```

`container` is an optional selector for an existing page container. The set appears while that container matches. Without it, the set can stay mounted for the page's lifetime. Do not add app-side controllers or mount hooks. Values survive ordinary container removal and return; the returning targets receive those cached values. Reset-all also covers inactive and unvisited sets.

`role` is `shared` or `page` (default). It controls ordering and width priority, not route matching. Shared fields appear first, followed by active page fields in one panel, separated by existing dividers. Do not add new grouping UI or scope headings.

`panel.width` is an integer from 160 to 4096, default 288, capped to the viewport. Active page widths take priority over shared widths; the widest active page wins. With no page set, the widest shared width wins.

Scopes are unique within the document. Control IDs may repeat across sets; conditions refer only within their own set. Reuse a scope intentionally to share settings between pages. Keep a Build's definitions in its static asset so later source edits cannot change retained review behavior.
