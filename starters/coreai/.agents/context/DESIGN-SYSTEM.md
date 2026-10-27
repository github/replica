# CoreAI design system

## Shared defaults

Use `@coreai-ds/react-components` for product-facing components and `~/components/common` for app-owned adapters. Use `@fluentui/react-icons` for icons. Do not import components directly from `@fluentui/react-components`. Keep component styles in colocated CSS Modules and preserve the app-owned Griffel renderer.

Follow the [CoreAI documentation skill](../skills/coreai-ds-fluentui-react/SKILL.md) from the [current documentation index](https://microsoft.github.io/coreai-design-system/index.md). Discover relevant current Markdown and example-source links rather than assuming a fixed site structure. Compare the documented version with the installed package and verify unfamiliar APIs against its actual exports and types.

Use the [component skill](../skills/react-components/SKILL.md), [styling skill](../skills/css-styling/SKILL.md) and [icon skill](../skills/icons/SKILL.md) when applicable.

## States and feedback

Reuse existing shell and page compositions for loading, empty, error and successful states. Read the current component documentation for semantics, supported compositions and accessibility behavior. Do not invent unsupported props, token names or capability claims. If the existing composition or documented API cannot express required behavior, report the gap before choosing a custom replacement.

## Limitations

This is example-app guidance, not a team's brand or product specification. A task requiring a different system or an unsupported composition needs an explicit decision. Report unavailable documentation or conflicting installed APIs; do not substitute another system silently.
