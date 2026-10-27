---
name: browser-canvas-validation
description: "Use the Copilot browser canvas first for rendered route checks, interaction tests, screenshots and visual, responsive or accessibility evidence. Use configured isolated Playwright MCP only when the canvas is unavailable for a required check."
---

# Browser canvas validation

Canvas inspection requires a Copilot host exposing the browser canvas. It is not
a universal browser API. A repository-configured isolated Playwright MCP fallback
can cover authorized checks only when the canvas is unavailable for that check.
This policy also governs browser evidence gathered by other skills and agent
work. Existing automated suites and CI/capture drivers remain unchanged.
Default to read-only validation of the requested outcome.
A validation request does not authorize source fixes, commits, publishing or
real application mutations. Use approved test state and confirm side effects
before submissions, deletion, messages or changes to authentication.

## Required reads and dependencies

Read [context resolution](../product-design/references/context-resolution.md)
and the complete [workflow](./WORKFLOW.md) before driving a page.
Install `product-design` for the shared resolver and scenario policy.
The optional [agent-browser fallback](../agent-browser/SKILL.md) is needed only
for an explicit CLI-only request or a named requirement neither the canvas nor
configured MCP fallback can meet, not for ordinary checks.
If a required companion or sibling skill is missing, stop and name its path
before checks. Do not auto-install dependencies.

Select the first existing root, `.agents/context/`, then `.github/contexts/`.
Read the applicable `BROWSER-VALIDATION.md` sections and owner topics for target/readiness, canvas identifiers, safe state and recovery. In the shared template, these are `Target and readiness`, `Canvas host and identifiers`, `Sessions, safe state and artifacts`, and `Recovery and cleanup`. Read `Configured Playwright MCP fallback` or `Existing CLI adapter` only when that fallback is needed.

Read the applicable `REPOSITORY.md` section for the target (`Where UI lives` in the shared template), `Commands` when a command is needed, and `Constraints` for relevant permissions or lifecycle. Follow applicable owner links. If a consumer uses different headings, select the equivalent sections by owner rather than reading the entire file.

Read `PRODUCT-DESIGN.md` when expected product behavior is unresolved, when assessing scenario behavior or fidelity, or when checking forms, persistence, destructive actions or externally visible changes. A fully specified, read-only route or menu check can use the request as its expected outcome. Read `DESIGN-SYSTEM.md` for component-specific assertions, `ACCESSIBILITY.md` for accessibility checks and `RESPONSIVE-DESIGN.md` for responsive checks. No manifest or canvas-specific pack file is required. Never mix roots.

Missing required context stops validation. Report the selected root/file and
offer `setup-skills` to author or refresh context under the shared
resolution rules. Do not invoke it
automatically. Never read drafts as active context. Follow relevant owner links and evidence anchors, preserve `proposed-default` labels and disclose conflicts. Read the complete applicable owner sections, not unrelated sections or topics. Product context owns scenarios and state policy. Browser context owns target URL, server, routes and recovery.

Use only permitted sources. Do not research remotely or broaden exclusions
during validation. Request explicit refresh if required documentation is stale
or missing. A document with gaps does not prove runtime capabilities.

## Runtime contract

Do not discover canvas capabilities for source-only tasks. For rendered checks, identify the browser canvas and inspect its actual schemas before the first required operation. Reuse a schema already discovered for the same provider in this session. Rediscover only after provider reload/reconnect, a schema mismatch or an explicit request to check for changed capabilities; a timeout alone does not invalidate it. Never carry schemas across providers or sessions.

If the browser canvas or required tools are absent, report the blocker and use only the explicit configured MCP handoff in [WORKFLOW.md](./WORKFLOW.md) when applicable. Use the advertised open input and action schemas; no frozen action list overrides the runtime.

Keep the canvas type and caller-chosen `instanceId` handle distinct.
Address the panel with that handle through `invoke_canvas_action`. If the
advertised action needs no separate page identifier, call it directly; do not
wait for a page-acquisition tool. Reuse a context-declared session handle when
appropriate. Only when an action schema requires a separate page identifier,
obtain it from runtime results or an explicit supported host contract.
If discovery and returned identifiers cannot satisfy an action schema, report
the mismatch and stop rather than inventing a value or an unavailable tool.
Missing required page acquisition may use the same explicit MCP handoff; it is not an
action failure or permission to infer IDs. A missing action can use that handoff
for the affected assertion only; keep supported checks in the canvas.

Open/reuse once, read fresh rendered structure, assert the target rendered, then
act using observed elements and advertised actions. Re-read after DOM changes,
navigation or reload before using refs. Do not assume a click returns a snapshot
or that scoped reads/batching exist. Details and recovery are in
[WORKFLOW.md](./WORKFLOW.md).

## Output

Report target, context document paths, runtime, tested state/flow, assertions and evidence.
Separate confirmed failures from unavailable or untested assertions. An overall
pass requires every applicable requested assertion to be verified. No render,
missing evidence or unavailable runtime means failed or incomplete validation.
Static checks do not prove live browser behavior. Do not automatically run
broader design, accessibility, responsive or cross-browser audits.
