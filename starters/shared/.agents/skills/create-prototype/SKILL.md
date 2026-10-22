---
name: create-prototype
description: "Builds new UI prototypes and makes targeted changes to existing prototypes using consumer-owned context. Use when asked to build a prototype, mock up a UI, or add, change, refine or recreate part of an existing prototype. Do not use for unrelated tasks, routine commands, Git lifecycle actions, acknowledgements or infrastructure work."
---

# Create prototype

When asked to create controls for variants, scenarios, adjustable previews or data-source
switches, read the adjacent [prototype-controls skill](../prototype-controls/SKILL.md),
even when the request never says "canvas controls". Product UI form fields and
filters alone stay in this skill. Controls guidance does not establish panel availability.

## Dispatch before reading workflows

Determine the branch from the original request, prior answers and current
target before loading any workflow files. Use a short, targeted lookup of
consumer repository instructions or the named target if needed, not a broad
repository tour. The word "new" alone does not decide: "add a new tab to this
prototype" is iteration.

| Request                                                                                           | Required read, only for this branch                                              |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Clear new build, such as "build an offline inventory prototype"                                   | [create](./workflows/create.md)                                                  |
| Change to an existing prototype, such as "add filtering to this page"                             | [iterate](./workflows/iterate.md)                                                |
| Candidate narrow edit to an existing prototype                                                   | [iterate](./workflows/iterate.md), then apply the root instructions' narrow-edit path |
| Consequential missing information, including an unresolved target or create-versus-iterate choice | [clarify](./workflows/clarify.md), then the selected build or iteration workflow |
| Behavior-preserving test-only work                                                                | Use the root instructions' task-scope guidance; do not load a prototype workflow |
| Unrelated task or routine command                                                                 | Stop using this skill and continue the original task                             |

Load only the selected workflow, not all companions as a required-read bundle.
Clarification is conditional, not a startup step. Either build or iteration
can need it later, but a clear request skips it entirely. Do not load the
other branch for orientation. If the selected companion is missing, report its
exact installed path and stop. Do not improvise it or use the other branch.

Preserve the original request and every answer in session context throughout
the work. A choice answers only its question, not unrelated scope. There is no
mandatory brief file, schema, build-mode quiz or separate intake skill.

Stay in the current target and worktree unless the user explicitly requests a
different destination. A reference URL is not permission to fork, duplicate,
publish, delete or activate anything. Approved references are 1:1 requirements
except for the requested delta, not design inspiration.

The selected create or normal iteration workflow reads the shared
[authoring reference](./references/authoring.md) before implementation. A
candidate narrow edit follows the iteration workflow's classification step and,
when eligible, skips that reference and its context dependencies.
It owns context resolution, design evidence, data boundaries and completion.
It does not load another workflow. Install `product-design`, `setup-skills`
and the `context-templates` library alongside this skill.
Missing installed dependencies stop
the affected work with their exact paths, never trigger automatic installation.

Context research uses the centralized library through setup-skills.
The shared authoring reference declares this consumer's context reads. Templates are setup
inputs, not additional per-task reads or active product facts.
