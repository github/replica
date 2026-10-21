---
name: css-styling
description: 'CSS Modules conventions, design tokens, container queries, and CSS-vs-component boundaries. USE WHEN: editing any `*.css` / `*.module.css` file in this repo, or writing styles for a new component.'
---

# CSS Editing Instructions

## CRITICAL: Before Editing Any CSS File

**REQUIRED STEP**: Before making any changes to a `.css` file, you MUST read the corresponding `.tsx` file(s) that use it:

1. Look for `.tsx` files with the same base name (e.g., `ComponentName.tsx` for `ComponentName.module.css`)
2. Search for imports of the CSS file using grep with pattern: `import.*from.*'\.\/.*\.module\.css'`
3. Read ALL `.tsx` files that import the CSS file before proceeding with edits

You may also need to edit the matching `.tsx` file and its structure to properly edit CSS.

## CSS Architecture

This project uses **CSS Modules**. Component CSS files should be named `*.module.css` and placed alongside their corresponding `.tsx` component files. Existing app-level stylesheets in `apps/prototype/app/styles/` are an exception for foundational styles such as resets and font registration; do not put component styles there.

Do not write inline css in the style attribute (unless there is a javascript value being attached).

### Custom Fluent Components

Do not use CSS to recreate components that already exist in CoreAI or Fluent. Before editing components, invoke the `react-components` skill for proper component usage guidelines. Most appearance and interaction styles are already handled by documented CoreAI components and props. If an appropriate prop is available, use it instead of writing CSS.

### CSS @layers

There are 3 named CSS `@layer`s in this app, ordered `base`, `griffel`, and `common`, plus unlayered CSS (which is not a named layer). The `base` layer contains the foundational box-sizing reset in `apps/prototype/app/styles/globals.css`. The `griffel` layer encapsulates Fluent's styles through the app-owned layered renderer - NEVER write CSS into the `griffel` layer. The `common` layer is for common components inside the `apps/prototype/app/components/common` folder and existing app-level resets; all components in this folder should use this layer, and component styles outside it should not. All other component styles should be written outside of these layers.

## General Guidelines

**No Global CSS**: Do not write global CSS selectors (e.g., `body`, `h1`) outside of a scoped CSS class for component styling. All component styles must be scoped using CSS Modules. Existing app-level stylesheets in `apps/prototype/app/styles/` are a narrow exception for foundational resets, font registration, and app-wide variable defaults, not component styling.
**Use Nested Classes**: Scope styles to specific elements within the component using nested class selectors.
**Avoid `!important`**: Do not use `!important` in CSS rules. Instead, refactor the CSS or component structure to achieve the desired specificity.

## Responsive Breakpoints — Container Queries

**CRITICAL**: Do NOT use `@media (width ...)` for responsive width breakpoints. Use `@container app (width ...)` instead.

This app uses **CSS container queries** so that responsive behavior responds to the actual available content width, not the viewport. Panels that reduce the content container's available width affect its breakpoints; the app-local floating feature selector is fixed-position and does not consume layout width.

The `ContainerQueryProvider` component (wrapping the app children with `styles.fullscreenContainer` in `apps/prototype/app/components/shell/AppContent.tsx`) establishes `container-type: inline-size` with `container-name: app`.

### Correct — Container Query

```css
@container app (width <= 768px) {
  .sidebar {
    display: none;
  }
}
```

### Wrong — Viewport Media Query

```css
/* ❌ DO NOT use @media for width breakpoints */
@media (width <= 768px) {
  .sidebar {
    display: none;
  }
}
```

### When to still use `@media`

- **Height queries**: `@media (height <= 480px)` — container queries only support inline-size
- **User preferences**: `@media (prefers-color-scheme: dark)`, `@media (prefers-reduced-motion: reduce)`
- **Accessibility**: `@media (forced-colors: active)`
- **Elements in portals/top-layer**: Dialogs, popovers, and other portal-rendered elements that exist outside the container tree (these still need viewport `@media` queries)

## Layout

CSS should primarily be used for layout, spacing, borders, and backgrounds. Avoid using CSS for text styles, component styles, or interaction styles. Most of these are handled by React components and props. Prefer using flexbox with gap for most layouts instead of block with margin. Grid is acceptable for more complex layouts.

Reduce nesting of HTML elements where possible - prefer a flatter structure.

## Text Styling

**Text Properties**: Avoid writing these CSS properties directly in CSS files. The components handle most of these by default.

- `font-size`
- `font-weight`
- `font-family`
- `line-height`
- `color` (for text color)

**EXCEPTION**: Text properties inside `@container` queries for responsive typography (e.g., scaling a heading on mobile) should be kept in CSS — the `Text` component doesn't handle container-based sizing.

**INSTEAD**: Where these properties are applied to a `Text`, `span`, or other text element, refactor to use the documented `Text` component from `@coreai-ds/react-components` and replace any text CSS properties with `preset` and `foreground` props.

```tsx
import { Text } from '@coreai-ds/react-components';

<Text preset="body" foreground={3}>
  Your text here
</Text>;
```

### Text Component Presets & Foreground

**Presets** (size from smallest to largest):

- `bodyXS` (10px) / `bodyXSStrong` (10px semibold)
- `bodyS` (12px) / `bodySStrong` (12px semibold); `heading6` is an alias of `bodySStrong`
- `body` (14px) / `bodyStrong` (14px semibold); `heading5` is an alias of `bodyStrong`
- `heading4` (16px semibold)
- `heading3` (20px semibold)
- `heading2` (28px semibold)
- `heading1` (40px semibold)

**Foreground** (text color intensity):

- `1` - Headings
- `2` - Body text
- `3` - Subtle/muted/secondary
- `4` - Disabled/placeholder
- `'disabled'` - Disabled text

Additional properties:

- `block` - makes the text a block element
- `italic` - makes the text italic
- `font` - sets the font family - `base` | `monospace`
- `as` - html element to render as (e.g., 'p', 'span', 'h1', etc.)

Don't use Fluent's fixed typography components (like `<Body1>` or `<Title2>`) directly. Always use CoreAI `<Text>` with `preset` and `foreground` props.

**When you encounter these properties in existing CSS**: Refactor the code to remove them from CSS and use the `Text` component in the `.tsx` file instead.

## Combining CSS Classes

When applying multiple CSS classes, use the `clsx` utility:

```tsx
import clsx from 'clsx';
import styles from './Component.module.css';

<div
  className={clsx(
    styles.class1,
    condition && styles.class2,
    className, // props.className mapped on to root element
  )}
/>;
```

## CSS Variables

Use Fluent semantic color tokens directly.

### Background

- `--colorNeutralBackground1` - Lighter primary background
- `--colorNeutralBackground2` - Middle background (uncommon)
- `--colorNeutralBackground3` - Darker background
- `--colorNeutralBackground4` - Very dark background (rarely used)

### Border/Stroke

- `--colorNeutralBackground4` - Existing panel-divider color
- `--colorNeutralStroke1` - Standard border color for elements

Usage: `border: 1px solid var(--colorNeutralStroke1);`

### Foreground/Text

Prefer using the `Text` component's `foreground` prop instead of setting text color in CSS.

- `--colorNeutralForeground1` - Intense (primary text/headings)
- `--colorNeutralForeground2` - Default body text color
- `--colorNeutralForeground3` - Subtle/muted (secondary text)
- `--colorNeutralForeground4` - Dim (disabled/placeholder text)
- `--colorBrandForeground1` - Brand color
- `--colorBrandForegroundLink` - Link color

### Interactive/States

Components own their hover, pressed, and selected states. Use the component API instead of
introducing application-level interaction-color aliases.

### Spacing - REQUIRED

**NEVER use hardcoded pixel values or rem values for spacing values less than 32px**. Always use these CSS variables:

- `--spacingNone` (0)
- `--spacingXXS` (2px)
- `--spacingXS` (4px)
- `--spacingSNudge` (6px)
- `--spacingS` (8px)
- `--spacingMNudge` (10px)
- `--spacingM` (12px)
- `--spacingL` (16px)
- `--spacingXL` (20px)
- `--spacingXXL` (24px)
- `--spacingXXXL` (32px)
- `--spacingPagePadding` - Special variable for horizontal page padding (adjusts by app container width, with a viewport-based fallback in the global stylesheet)

**DO NOT** use Fluent spacing variables that include "Horizontal" or "Vertical" in their names.

For pixel values 32px and above, you may use hardcoded values if necessary, but prefer using spacing variables where possible for consistency.

### Border Radius

- `--borderRadiusNone` (0)
- `--borderRadiusSmall` (2px)
- `--borderRadiusMedium` (4px)
- `--borderRadiusLarge` (6px)
- `--borderRadiusXLarge` (8px)
- `--borderRadius2XLarge` (12px)
- `--borderRadius3XLarge` (16px)
- `--borderRadius4XLarge` (24px)
- `--borderRadius5XLarge` (32px)
- `--borderRadius6XLarge` (40px)
- `--borderRadiusCircular` (9999px)

## Example CSS Patterns

### Good - Uses Variables

```css
.container {
  padding: var(--spacingL);
  background-color: var(--colorNeutralBackground1);
  border: 1px solid var(--colorNeutralStroke1);
  gap: var(--spacingM);
}
```

### Bad - Hardcoded Values

```css
.container {
  padding: 16px; /* WRONG - use var(--spacingL) */
  background-color: #f5f5f5; /* WRONG - use var(--colorNeutralBackground1) */
  font-size: 14px; /* WRONG - use Text component instead */
  color: #333; /* WRONG - use Text component instead */
}
```

## Summary Checklist

Before submitting CSS edits, verify:

- [ ] Read corresponding `.tsx` file(s) that use this CSS
- [ ] No text-styling properties (`font-*`, `color`) in CSS
- [ ] All colors use Fluent semantic tokens
- [ ] All spacing uses `--spacing*` variables
- [ ] Width breakpoints use `@container app (width ...)` not `@media (width ...)`
- [ ] Component CSS file is named `*.module.css`; any app-level stylesheet edit stays within the foundational-style exception
- [ ] Classes combined with `clsx` when multiple are needed
