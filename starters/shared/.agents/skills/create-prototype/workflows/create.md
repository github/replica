# New prototype

Read only after the entrypoint selects a new build.

1. Identify the requested user task, destination, main interactions, optional
   reference, requested deviation, acceptance inputs and constraints from the
   whole request and existing answers. An absent reference is not itself a gap.
   Do not ask questions already answered. If a consequential gap remains after a targeted
   lookup, read [clarify](./clarify.md), then return here. Do not ask the user to
   select technical components or a framework when the repository decides.
2. Read the shared [authoring reference](../references/authoring.md) and resolve
   its required context before implementation. Use `product-design` for the
   applicable behavior and layout decisions, not a new design-policy interview.
3. Use the authoring reference's targeted repository discovery to locate entry
   points, reusable compositions and data sources, not only context-declared
   paths. Select the simplest supported structure for the requested outcome.
   If the target already implements the requested surface and the request is
   really a change to it, return to entrypoint dispatch before writing. Do not
   silently create a duplicate route to avoid working with existing code.
4. Use the same targeted discovery to check for a repository-declared scaffold
   applicable to this new target. Before running it, check documented usage,
   required inputs, generated files, registration/metadata side effects and
   collision/rerun behavior. Inspect relevant script/config as needed to verify
   its behavior. Use only the declared runner and scaffold, never create or
   install a scaffolder to satisfy this workflow. Preserve unrelated work and
   do not run a command that also publishes, deletes or activates without
   explicit authorization. If it fails, investigate the failure and partial
   output before proceeding. Failure is not evidence that no scaffold exists
   or permission to overwrite partial output. Without an applicable scaffold,
   use existing local conventions. A static/offline prototype needs no routes,
   server-side data, live API, package installation or hosted infrastructure
   by default.
5. Establish the raw data and assembly boundary from the authoring reference,
   then implement the complete requested flow with supported components and
   applicable states. For a supplied approved reference, preserve it 1:1 except
   for the requested delta. Missing reference access is a visible fidelity
   blocker, not permission to invent a replacement.
6. Follow the authoring reference's completion checks for the requested outcome.
   Fix observed failures and rerun affected checks. Report the actual local
   target, implemented behavior and any untested or blocked portions.

Building locally does not authorize committing, publishing or activating.
Follow the consuming repository's validation and commit rules, not a
toolkit-owned lifecycle or automatic independent reviewer.
