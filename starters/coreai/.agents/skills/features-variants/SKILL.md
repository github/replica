---
name: features-variants
description: 'Definitive guide to the app-local prototype feature/variant system: configuration, `useFeature()`, URL params, and anti-patterns. USE WHEN: editing `app/features.json`, using `useFeature()` in routes, creating design alternatives, A/B comparisons, layout options, alternate versions, or switching between design proposals. Trigger keywords: feature, variant, version, option, alternate, prototype, design option, A/B, comparison, switch between, try a different, another way, layout option, explore, side by side.'
---

# Feature & Variant System Instructions

Paths below are relative to this app's directory.

## What Is the Feature System?

CoreAI Sandbox has a **built-in feature/variant system** for tracking prototyped features and presenting multiple UI alternatives on the same page. It uses a neutral floating selector with small, elevated tab links and a brand-colored Prototype InteractionTag menu trigger to distinguish itself from the designs being prototyped.

A **feature** represents a prototyped change from main. A feature may:

- Have **variants** — multiple design alternatives that can be switched between (e.g., different layouts)
- Be **variant-less** — a single prototyped change with no alternatives (just a link to the location of the change)

**Multiple features can be active simultaneously** on the same page, each with their own independent variant selection.

**You MUST use this system** whenever a user asks to:

- Try a different layout, design, or approach for a page or section
- Create an "option B" or "version 2" of something
- Compare two or more designs side by side
- Add an A/B test or design alternative
- Explore an alternate version of a feature

**Do NOT** build a custom toggle, tab switcher, or parallel component tree. The feature system already handles all of this.

> For a guided walk-through tailored to designer-style requests, invoke the `new-variant` skill.

---

## How It Works (Summary)

1. **Features** are defined in `app/features.json`. Each feature may have variant options. The registry is currently empty; add definitions to its top-level `features` array.
2. Active variants are encoded in the URL as repeated `?variant=feature-id--variant-id` params — every combination is a shareable deep link.
3. When a user navigates to a page with applicable features, the system **automatically populates** selections from valid URL values, then remembered client-navigation selections, then the first configured variant.
4. A **draggable floating switcher strip** appears bottom-center by default showing each feature's variants as small, elevated router-backed tab links, when applicable variants exist and **Show feature selector** is enabled in the Prototype menu.
5. Route components use the `useFeature(featureId)` hook to conditionally render based on the active variant.
6. **Multiple features** can be active on the same page simultaneously with independent variant selections.

---

## Architecture — Key Files

| File                                            | Purpose                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| `app/features.json`                             | App configuration: all features, routes, and variant labels            |
| `app/features/featureConfig.ts`                 | Feature schema, configuration validation, and route/URL helpers        |
| `app/features/FeatureContext.ts`                | Feature context and public context types                               |
| `app/features/FeatureProvider.tsx`              | URL state, route matching, defaults, and floating selector composition |
| `app/features/FeatureContext.ts` (`useFeature`) | Public hook for reading the active variant                             |
| `app/features/FeatureFloatingUI.tsx`            | Floating variant selector                                              |
| `app/features/FeatureMenu.tsx`                  | Prototype feature menu used by the app shell                           |

---

## URL Structure

Variants are encoded as repeated `variant` query params:

```
# Single feature with one variant active
?variant=agent-playground-layout--accordion

# Two features active simultaneously
?variant=agent-playground-layout--accordion&variant=code-tab--visible

# Variant-less features have no variant query param (they apply only on matching routes)
```

Each `variant` param is a `feature-id--variant-id` pair using kebab-case string identifiers.

---

## Step-by-Step: Adding a New Variant to an Existing Feature

If a feature already exists in `app/features.json` and has variants, add a new variant:

### 1. Update `app/features.json`

Add a new entry to the `variants` array of the existing feature:

```json
{
  "id": "your-new-variant",
  "label": "Your New Design Name"
}
```

Variant `id` values are **kebab-case strings**. Choose a descriptive, URL-friendly name.

### 2. Update the Route Component

In the route component that uses this feature, add a conditional branch for the new variant:

```tsx
import { useFeature } from '~/features/FeatureContext';

function MyPage() {
  const variant = useFeature('agent-playground-layout');

  if (variant === 'accordion') return <AccordionLayout />;
  if (variant === 'your-new-variant') return <YourNewDesign />; // ← new
  return <DefaultLayout />; // first variant or null
}
```

That's it. The floating UI automatically shows the new tab link when the selector is visible on an applicable route.

---

## Step-by-Step: Creating a New Feature

### Feature WITH Variants

When the feature explores multiple design alternatives:

#### 1. Add the feature to `app/features.json`

Add this object to the registry's top-level `features` array:

```json
{
  "id": "agent-playground-layout",
  "label": "Agent Playground Layout",
  "notes": "What design question this feature explores.",
  "defaultRoute": "/build/agents/:agent/playground",
  "defaultParams": { "agent": "agent-001" },
  "routes": ["/build/agents/:agent/playground"],
  "variants": [
    { "id": "side-panel", "label": "Side Panel (Current)" },
    { "id": "accordion", "label": "Accordion Layout" }
  ]
}
```

#### 2. Add `useFeature()` to the Route Component

```tsx
import { useFeature } from '~/features/FeatureContext';

function MyPage() {
  const variant = useFeature('agent-playground-layout');

  if (variant === 'accordion') return <AccordionLayout />;
  return <DefaultLayout />; // 'side-panel' or null
}
```

### Feature WITHOUT Variants

When the feature is a single prototyped change with no alternatives:

#### 1. Add the feature to `app/features.json`

Add this object to the registry's top-level `features` array:

```json
{
  "id": "dark-mode-revamp",
  "label": "Dark Mode Revamp",
  "notes": "Updated dark mode colors across settings page.",
  "defaultRoute": "/settings/appearance",
  "routes": ["/settings/appearance"]
}
```

No `variants` array needed. The feature appears in the Prototype InteractionTag menu as a navigation link. No `useFeature()` call is needed in the route component.

---

**Field reference:**

| Field           | Required | Description                                                                                                                    |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`            | Yes      | Kebab-case string identifier (used in URL params)                                                                              |
| `label`         | Yes      | Human-readable name shown in the floating UI                                                                                   |
| `notes`         | Yes      | Design context — what question does this feature explore?                                                                      |
| `defaultRoute`  | Yes      | The primary route to navigate to from the Prototype menu; must be in `routes`                                                  |
| `defaultParams` | No       | Fallback values for `:param` segments (e.g., `{ "agent": "agent-001" }`); required when `defaultRoute` has required parameters |
| `routes`        | Yes      | Route patterns this feature applies to. Supports `:param` wildcards                                                            |
| `variants`      | No       | Array of `{ id: string, label: string }`. Omit for variant-less features                                                       |

**Route pattern matching:** A pattern like `/build/agents/:agent/playground` matches any URL of that shape. The `:param` segments are wildcards matched segment-by-segment.

---

## `useFeature()` Return Values

```tsx
const result = useFeature('feature-id');
// Returns:
//   string  — active variant id (e.g., 'accordion') if feature has variants
//   true    — if feature is variant-less and applies to current route
//   null    — if feature doesn't apply to current route
```

---

## Multi-Feature Pages

A single page can have **multiple features** active simultaneously. Each component on the page calls `useFeature()` with its own feature ID independently.

```tsx
const layout = useFeature('agent-playground-layout');
const codeTab = useFeature('code-tab-visibility');

// Both return their own variant independently
// URL: ?variant=agent-playground-layout--accordion&variant=code-tab-visibility--visible
```

The floating strip shows variant tab links for all applicable features with variants, separated by dividers.

---

## Variant Scope — What Can Change?

A variant can change **anything** within its route component:

- **Full page replacement**: Return entirely different component trees per variant
- **Section swap**: Replace just one panel, card, or section
- **Prop changes**: Same component with different props
- **Style changes**: Different CSS classes per variant
- **Data presentation**: Same data shown in different formats
- **Conditional features**: Show/hide features like buttons, tabs, or panels

### Example — Small Change (text variant)

```tsx
const variant = useFeature('hero-text');
return (
  <Text preset="heading2" foreground={1}>
    {variant === 'version-b'
      ? 'Start Building with AI'
      : variant === 'version-c'
        ? 'Your AI Development Platform'
        : 'Welcome to CoreAI Sandbox'}
  </Text>
);
```

### Example — Full Layout Swap

```tsx
const variant = useFeature('playground-layout');
if (variant === 'accordion') return <AccordionLayout />;
if (variant === 'dialog') return <DialogLayout />;
return <SidePanelLayout />;
```

---

## Variant-Exclusive Routes

Some variants introduce routes that only exist for that variant (e.g., a "Code" tab route that only exists when `go-to-code--tab` is active). If a user lands on a variant-exclusive route with the wrong variant selected, the route component should redirect:

```tsx
const variant = useFeature('go-to-code');

// This route only exists for the "tab" variant — redirect otherwise
if (variant !== 'tab') return <Navigate to="../playground" replace />;
```

Keep this guard **in the route component itself**, colocated with the route that knows it's conditional. Do not add redirect logic to `FeatureProvider.tsx`.

---

## Anti-Patterns — Do NOT Do These

| ❌ Don't                                                                                                                             | ✅ Do Instead                                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Build a custom toggle/switch for design alternatives                                                                                 | Use `useFeature()` + `app/features.json`                    |
| Store variant state in localStorage or React state                                                                                   | URL query params (`?variant=...`) handle everything         |
| Create separate routes for each design alternative                                                                                   | One route, conditional rendering via `useFeature()`         |
| Import feature implementation internals from `app/features/featureConfig.ts` or `app/features/FeatureProvider.tsx` in app components | Use `useFeature()` from `~/features/FeatureContext`         |
| Hard-code variant IDs as numbers                                                                                                     | Feature and variant IDs are **kebab-case strings**          |
| Add a new variant switching UI element into the product design                                                                       | The floating tab-link UI is the switcher — it's meta-UI     |
| Modify app-local feature-system internals for an app feature                                                                         | Only modify `app/features.json` and the consuming component |

---

## Troubleshooting

**Floating strip doesn't appear on my page:**

- Check that the route pattern in `app/features.json` matches your page's URL exactly (segment-by-segment)
- `:param` segments match any value, but the number of segments must match
- Ensure the applicable feature has variants and **Show feature selector** is enabled in the Prototype menu
- Check browser console for errors

**`useFeature()` returns null:**

- Verify you're passing the **feature ID** (string), not the variant ID
- Verify the feature's `routes` array includes a pattern matching the current page

**Variant tab links show but clicking doesn't change anything:**

- Ensure your component reads `useFeature()` and conditionally renders based on it
- Make sure you're checking the correct variant IDs (kebab-case strings)

**URL params get cleared when navigating:**

- This is expected for off-route `variant` params: they are removed. When returning during client navigation, valid URL selections take priority, then remembered selections, then the first configured variant. A reload uses the URL or the first variant, not remembered client-navigation state. Unrelated query params are preserved.
