---
name: coreai-ds-fluentui-react
description: 'Find and apply CoreAI design-system documentation. Use when choosing or reviewing @coreai-ds/react-components components, props, tokens, themes, templates, or UI patterns.'
---

# Use CoreAI Documentation

1. Fetch the [CoreAI documentation index](https://microsoft.github.io/coreai-design-system/index.md) once per task.
2. Follow its current links to the guidance, APIs, and examples needed for the task. Resolve relative links against their containing page. Use linked Markdown and source files; do not guess routes or fetch the whole catalog.
3. Read the selected reference's UX and accessibility guidance alongside its API and examples. CoreAI guidance takes precedence over upstream demonstrations.
4. Compare documented and installed package versions. Report mismatches and check required exports and props against installed TypeScript declarations.
5. For templates, read the linked source files and dependency requirements before adapting them. Templates are copy-and-adapt source, not package exports.

## Retrieval failures

If a page fails, rediscover its link from the index. Report unresolved URLs and errors, and identify any installed package README, declarations, or changelog used as a fallback. Ask for guidance if the available evidence does not resolve a required API or design decision.
