---
name: context-templates
description: "Shared context template library for setup-skills. Read when discovering context documents or their ownership. This library supplies research inputs, not active product context or a separate authoring workflow."
---

# Shared context templates

This directory is the only editable template library. It is copied with the
starter beside `.agents/skills/`. Do not duplicate templates inside individual
skills or infer approved context from templates themselves.

## Documents and research sources

Plain setup selects every document below once. For a named consumer, read its
required-context declaration, including any linked reference that owns that
declaration, and select its required and conditional documents once. Do not
maintain a second consumer dependency map here. Users can also name documents
directly. This entrypoint is not itself a context document.

| Document | Source groups |
| --- | --- |
| [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) | `design-system` |
| [PRODUCT-DESIGN.md](./PRODUCT-DESIGN.md) | `product` |
| [REPOSITORY.md](./REPOSITORY.md) | `repository` |
| [SEED-DATA.md](./SEED-DATA.md) | `product`, `repository` |
| [RESPONSIVE-DESIGN.md](./RESPONSIVE-DESIGN.md) | `product` |
| [ACCESSIBILITY.md](./ACCESSIBILITY.md) | `product`, `repository` |
| [BROWSER-VALIDATION.md](./BROWSER-VALIDATION.md) | `repository` |

Source groups identify research ownership. `design-system` and `product` select
the six shared intake questions in setup-skills' `references/source-workflow.md`.
The `repository` group selects automatic, bounded, read-only research of the
current consumer checkout under that workflow, not a source/permission question.
Repository-only selection needs no intake answers. Missing repository answers or
file registrations do not block this local scope. Other groups' research is not
automatically authorized by a file being local.
Collect each applicable question once across selected documents. Preserve all
restrictions and explicit skips, including legacy repository opt-outs, and honor
content exclusions. Volunteered docs add leads, not a new required question.
Bounded proposals live in [PRODUCT-DESIGN.md](./PRODUCT-DESIGN.md) and apply only
where permitted, never as researched product policy.
An empty source registry does not disable automatic local research. Excluded,
missing or inaccessible evidence must produce specific limitations, not fictional
facts or replacement research against a skip.

## Optional owner topics

Keep all seven root identities. Authors may keep a document whole or move
task-specific detail into directly linked owner topics when supported tasks can
skip genuinely irrelevant detail. Choose boundaries by task applicability and
cohesion: keep a decision's requirements, conditions, exceptions, examples and
citations together. Keep short, cohesive guidance whole when splitting would
only add navigation. Check evidenced consumer constraints, such as incoming
anchors or a parser that requires a particular structure, before moving content;
do not assume one consumer's constraints apply to others.
Observed oversized or truncated reads can motivate review, but file size,
consistency with other owners or a fixed topic count does not justify a split.
Splitting alone does not establish faster discovery or better task outcomes.
Preserve correct existing text and its authority and historical qualifications;
relocation is not permission to rewrite policy or claim fresh verification.
Do not physically split every template or add new owners, intake or authors.
Roots retain authority, common rules, universal obligations, known gaps and
direct links to every topic with concrete applicability conditions. New topics
use the owner's exclusive `topics/<DOCUMENT-STEM>/` directory within active
context; existing linked paths need preservation and explicit inventory.

Each trigger covers normal successful work and readiness as well as relevant
failure/recovery work. For example, supported component selection, opening and
checking an ordinary preview, and adding valid fixtures must select their
applicable details before a failure occurs. Avoid read-all lists and topic chains.
Each topic keeps complete usable rules, examples, conditions, exceptions and
citations. Shared-owner links transfer ownership, not duplicate policy.

Apply setup's complete-set authoring, preservation and approval contract to
roots and topics together. Library templates are research prompts, not approved
consumer guidance or permission to activate extra files.

## Location

Setup reads this library from `.agents/context-templates/` in the current
prototype repository. It does not fetch or install another copy. Context
documents become active only after separate explicit approval.
