---
name: icons
description: 'Conventions for picking, sizing, and bundling Fluent icons. USE WHEN: adding or changing an icon in a `*.tsx` file, or picking an icon name.'
---

# Icon Usage

When looking for icon names,

- **Prefer searching the installed `@fluentui/react-icons` exports** so the names match the version the app actually uses. Run this from `apps/prototype/` or the repository root, replacing the search expression with the concept you need:

```sh
node -e "const icons = require('@fluentui/react-icons'); console.log(Object.keys(icons).filter(name => /document.*add/i.test(name) && !/\d/.test(name) && /(?:Regular|Filled)$/.test(name)).join('\n'));"
```

The example searches document-add icons, excludes numbered-size exports, and keeps filled/regular styles.

- As an alternate, use the Fluent MCP tools: `search_fluent_icons` and `validate_fluent_icon` if available, especially for semantic suggestions.
- As an alternate, search the icon repo names for discovery or visual previews: `https://github.com/microsoft/fluentui-system-icons/blob/main/icons_regular.md` or `https://github.com/microsoft/fluentui-system-icons/blob/main/icons_filled.md`.
- After choosing an icon through an alternate method, verify that its exact export name exists in the installed `@fluentui/react-icons` package; the online catalog may include icons from newer versions.

Prefer using the unsized icons without the number suffix, e.g. `TextBulletListTreeFilled` instead of `TextBulletListTree20Filled`. This allows the icon to scale dynamically within buttons and other components.

When adding icons to Fluent components, use the `bundleIcon` utility from `@fluentui/react-icons` to combine filled and regular icons. For example:

```tsx
const TraceIcon = bundleIcon(TextBulletListTreeFilled, TextBulletListTreeRegular);

<Button icon={<TraceIcon />} />;
```
