---
name: coreai-ds-fluentui-react
description: 'Use only when editing ./apps/prototype/* with @coreai-ds/react-components; requires the local CoreAI documentation MCP before choosing components, props, templates, or patterns.'
---

Read and follow the canonical [coreai-ds-fluentui-react skill](../../../../../packages/react-components/agent/SKILL.md).

## Prototype-specific exceptions

- Use `coreai-ds-docs-localhost` at `http://localhost:6006/mcp`, configured in
  [the workspace MCP configuration](../../../../../.vscode/mcp.json), instead of the hosted
  endpoint. If it is unavailable, troubleshoot the local server and retry before proceeding.
- Discover the local server's actual schemas. Its current equivalents are
  `list-all-documentation` for `docs-list`, `get-documentation` for `docs-show`, and
  `get-documentation-for-story` for `docs-show-story`.
- Invoke `react-components` to classify the repository boundary. It owns
  prototype adapter and composition guidance; the canonical package skill owns CoreAI API
  questions.
- Resolve app-relative paths from `apps/prototype/`. Inspect local adapters and compositions
  under `app/components/common/**`; use the app-owned `Card`, `Image`, and `Link` adapters
  instead of importing those components directly from the CoreAI package.
