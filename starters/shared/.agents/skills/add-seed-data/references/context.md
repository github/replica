# Seed-data context contract

Required before fixture implementation: read the shared
[context resolution rules](../../product-design/references/context-resolution.md).
Select the first existing root, `.agents/context/`, then `.github/contexts/`.
Read `SEED-DATA.md` and `REPOSITORY.md` directly there. Never fill gaps from a
lower-priority root or use drafts as active context. No manifest is required.

Seed context owns scenario meaning, raw formats, identities and assembly.
Repository context owns shared commands and lifecycle. Read relevant owner links,
source citations and limitations, preserving authority and `proposed-default` labels.

Data-only work does not require `DESIGN-SYSTEM.md` or `PRODUCT-DESIGN.md`
unless a relevant active owner link needs that guidance.
Do not load unrelated UI guidance through such links. UI changes use the
conditional authoring gate in the entrypoint, including its design context.

Missing documents, relevant linked evidence or consequential
rules must be explicit, not invented. Report the selected root and exact
missing path or decision. Stop the unsupported portion, not unrelated supported
work. Offer [setup-skills](../../setup-skills/SKILL.md) to author or refresh the
missing context. That skill reuses complete saved intake and explicit skips.
Do not repeat source intake as a scenario questionnaire or invoke setup automatically.

Install `product-design` for shared resolution and `setup-skills` with its template
library alongside this skill. `create-prototype` is needed only for
the conditional UI authoring read. Missing required installed files stop
affected work with their exact paths, never trigger installation.

The [template protocol](../../setup-skills/references/template-convention.md)
owns document discovery and source selection. Plain setup configures all
documents once. Data-only work does not create an empty design-system template.
Existing legacy context needs reviewed migration, not filename substitution.
Setup/refresh does not approve activation or automatic context writes.
