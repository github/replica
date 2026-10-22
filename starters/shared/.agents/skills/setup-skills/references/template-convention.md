# Shared template library

`.agents/context-templates/` in the prototype repository is the single editable
source. It is a shared library, not a consuming workflow. The starter copies it
beside `.agents/skills/`; there are no templates or fallback copies inside
individual skills.

Resolve `../../context-templates/` from the setup-skills skill directory,
not the shell working directory. Require its `SKILL.md` and every selected
document. Do not search for a fallback library to hide missing files.

Do not scan the user's home, fetch a checkout, follow external symlinks or
substitute previous outputs. Missing library files stop setup with exact paths.
Repair the starter files separately; setup never auto-installs them.
Restart the agent after copying skills so it can discover them.

## Document selection and ownership

The library's `SKILL.md` lists complete documents and their source groups.
[Intake](./source-workflow.md#intake) owns shared questions and saved answer keys.
Only `design-system` and `product` select questions. `repository` selects the
source workflow's automatic current-consumer research scope, subject to saved
opt-outs and all exclusions. It requires no answer or per-file registration.
Each consumer declares its required/conditional documents in its context section
or the linked reference that owns that declaration, not a separate central map.
Plain setup selects every document once. An explicit consumer selection includes
both its required and conditional documents once, not one writer per consumer.
Explicit document selection is also supported. Relevant owner links at task time
remain conditional requirements, not permission to duplicate another owner.
The seven documents are root identities, not a flat-file-only output restriction.
Optional directly linked topics follow the library entrypoint's convention and
stay with the root's one author. A topic is not another template selection,
source group or independently dispatched document.

| Document | Owns |
| --- | --- |
| `DESIGN-SYSTEM.md` | APIs, components, patterns, tokens, themes, focus contracts, documentation and style-validator procedures |
| `PRODUCT-DESIGN.md` | Product behavior, tasks, states, themes, prototype fidelity, concept decisions and safe scenarios |
| `REPOSITORY.md` | Local structure, wrappers, commands, constraints, lifecycle and handoff locations |
| `SEED-DATA.md` | Domain scenarios, raw formats, integrity, fixture paths and assembly |
| `RESPONSIVE-DESIGN.md` | Product viewport matrix, narrow tasks, overflow and reflow requirements |
| `ACCESSIBILITY.md` | Supported accessibility environments, specific acceptance evidence and manual procedures |
| `BROWSER-VALIDATION.md` | Target/readiness, canvas/CLI capabilities, sessions, artifacts and recovery |

Generic procedures stay in skills. A template asks for reusable product,
design-system, repository or tool facts with applicability, exceptions, evidence
and limitations. It is neither approved context nor a questionnaire about the
current prototype. Add a document only for distinct context, not each skill or
each source owner. Multiple owners in one document retain separate authority.

## Bounded recommendations

Bounded proposals live beside their topics in `PRODUCT-DESIGN.md`. Keep their
text and applicability, labelled `proposed-default` in ordinary Markdown.
There is no separate recommendation file, claim format or renderer.
Only PRODUCT-DESIGN.md currently has recommendations. Other documents cannot
invent defaults to fill gaps. Approval does not promote a proposal to policy.
An explicit source skip permits applicable labelled proposals, not research
against the exclusion. An explicit topic exclusion prohibits its proposal too.
Never infer permissions, compliance, retention, persistence, undo or permanence.

## Changes and legacy material

If document selection, source groups, research authorization or template guidance
changes, reconcile it in a new run and obtain new approval. Never modify preserved
inputs of an ongoing run.
Old skill-owned templates and the claim/pack renderer are retired. Existing
approved packs, local source indexes, evidence and human prose remain comparison
material under [preservation](./source-workflow.md#existing-context-and-preservation).
Do not recreate their template copies or silently resume an old renderer review.
