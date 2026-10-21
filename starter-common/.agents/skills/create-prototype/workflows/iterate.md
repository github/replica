# Existing prototype iteration

Read only after the entrypoint selects a change to an existing prototype.

1. Resolve the current or explicitly named target using session context and
   the repository's entry-point map if present. Preserve the current target,
   route and worktree. If several targets fit and the choice changes what will
   be edited, read [clarify](./clarify.md), then return here. Do not silently
   create a duplicate route, fork, branch or session.
2. Read the target's directly affected implementation and nearest focused test. If the change might qualify for the root instructions' narrow-edit path, classify it now. For an eligible change, follow that path and skip the remaining authoring and context reads. If eligibility is uncertain or scope grows, continue with the normal workflow.
3. Read the shared [authoring reference](../references/authoring.md) before
   editing. Reuse unchanged, already-read evidence only when it still resolves
   the current decision. Do not repeat setup, intake, scaffolding or broad
   repository orientation merely because this is a follow-up.
4. Read the target's directly relevant implementation, styles and data wiring.
   Identify the requested delta, acceptance inputs and affected behavior from
   the request and existing answers. A new reference is not required. Preserve
   the existing page structure, navigation, data sources, persistence and unrelated content.
   An approved reference is a 1:1 requirement except for the requested delta.
   When moving or recreating UI at an explicitly requested destination, inspect
   the approved source and preserve its layout, copy, states and interactions.
   Do not redesign it or remove the source unless separately authorized.
5. Use `product-design` for new or changed behavior. If any consequential scope
   or behavior gap remains, read [clarify](./clarify.md), not the create workflow.
   Make the smallest complete change across the necessary files. New domain
   fields follow the shared data boundary, not component-local mock collections.
6. Reuse the current preview when available. If its location or runtime is
   unknown, follow the consumer's documented discovery/recovery procedure.
   Do not guess a port, restart a healthy server or rerun scaffolding just to
   recover a URL. Update registration only when the requested change needs it,
   using the repository's documented mechanism and preserving the target.
7. Follow the authoring reference's completion checks for the changed surface
   and directly affected behavior. Verify reference fidelity where applicable.
   Do not tour unrelated flows or claim unchanged regions were retested.

Report the exact target, requested delta, preserved reference and observed
results, including unavailable checks. Follow consumer validation and commit
rules. Iteration does not authorize publication, deletion or activation.
