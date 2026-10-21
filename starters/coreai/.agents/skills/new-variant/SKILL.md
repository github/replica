---
name: new-variant
description: 'Create a new design variant or alternative for a page using the built-in feature/variant system. USE WHEN: a designer wants to try a different layout, create an "option B" or "version 2", compare designs side by side, add an A/B alternative, or explore an alternate version. Do NOT build a custom toggle solution.'
argument-hint: 'Optional: route or feature name the variant targets'
---

# New Design Variant

You are helping a designer create a new design variant using CoreAI Sandbox's built-in feature/variant system. The designer may have no coding knowledge — they will describe what they want in plain language.

Paths below are relative to this app's directory.

## Before You Start

1. **Invoke the `features-variants` skill** — it is the definitive guide to the feature system (schemas, code patterns, field references, anti-patterns). Do not duplicate that information here — refer to it.
2. **Read** `app/features.json` — understand what features already exist.
3. **Invoke the `react-components` skill** — you will need to write `.tsx` code.
4. **Invoke the `css-styling` skill** — if you need to write styles.

## Workflow

### Step 1: Understand the Designer's Request

Identify from the user's message:

- **What page or feature** they want to change (e.g., "the playground", "the homepage hero", "the agent list")
- **What they want to try** (e.g., "a different layout", "move the config panel to a dialog", "bigger hero text")
- **How it differs from the current design** (the "current" design is always the first variant)

If the request is unclear, ask one focused question. Do not ask multiple questions — infer reasonable defaults.

### Step 2: Determine the Route

Read `app/routes.ts` to discover the current route structure. Map the designer's description to a route file and its URL pattern. Routes are defined using React Router v7 config — `index()`, `route()`, and `layout()` calls show the path segments and corresponding file paths.

### Step 3: Check for Existing Features

Read `app/features.json` and check if a feature already exists for this route.

- **If a feature exists**: Add a new variant to the existing feature. Follow the "Adding a New Variant to an Existing Feature" section in the `features-variants` skill.
- **If no feature exists**: Create a new feature. Follow the "Creating a New Feature" section in the `features-variants` skill.

### Step 4: Implement

1. Update `app/features.json` following the schema in the `features-variants` skill.
2. Read the route component file identified in Step 2 — understand its structure before editing.
3. Import `useFeature` from `~/features/FeatureContext` and add conditional rendering to the route component, following the patterns in the `features-variants` skill.

**Implementation sizing guidance:**

- For **small changes** (text, colors, visibility) — use inline conditionals within the existing JSX
- For **medium changes** (rearranging sections, swapping a panel) — extract the variant-specific section into a local component or conditional block
- For **large changes** (completely different page layout) — create the new layout inline in the same file or as a separate component in the same route folder

### Step 5: Start the App and Verify

If the dev server is not already running, invoke the `start-app` skill.

Use the repository's browser validation workflow to:

1. Navigate to the page
2. Confirm the floating feature strip appears with the correct feature name and variant tab links; if hidden, enable **Show feature selector** in the **Prototype** menu
3. Click each variant to verify switching works
4. Take a screenshot to show the designer the result

### Step 6: Report to the Designer

Tell the designer:

- What you built and which variant it is
- The URL they can use to see each variant (include `?variant=feature-id--variant-id`)
- How to switch between variants using the elevated tab links in the draggable floating strip (bottom-center by default)
