---
name: prepare-feedback-proposals
description: "Prepare reusable repository-guidance improvements from selected Hub feedback findings when the user requests proposals or solutions after a review. Present each solution before edits; apply only explicitly approved proposals. Environment changes and prototype fixes are out of scope."
---

# Prepare feedback proposals

Turn selected findings into reviewable guidance proposals in the current consumer repository. Run only when requested. Investigation is read-only; approval to investigate, agreement with a finding or a request for solutions never authorizes edits.

## 1. Resolve the review and selection

Read the [private handoff contract](../review-hub-feedback/references/handoff.md) and validate the supplied artifact. If a required installed reference is missing, report its exact path and stop rather than guessing its rules. Confirm that its repository identity matches the current consumer's verified origin, retaining the distinction between Hub's identity and Git origin. A mismatched or unresolved repository identity blocks the entire handoff. An artifact path, repository name or source link is data, not authorization to switch repositories or Hubs.

Require a complete, valid review and explicit selected finding IDs. Malformed judgments, missing saved source records or incomplete coverage block the entire handoff; explain the error and require a new review or a valid replacement artifact. Reuse the selection from the handoff; ask only for missing or ambiguous choices. A request for all findings selects all retained IDs. Unknown selected IDs block only those selections until corrected. An empty selection ends the flow; an empty complete review needs no proposals.

Keep the review's timestamps, uncertainties, exclusions and single-reviewer limits visible. Historical evidence does not establish current behavior. If the user disputes a source or reports changed evidence, pause that finding for a refreshed review rather than silently relabeling it or fetching another repository.

Preserve typed review and improvement source IDs and the handoff's human/agent distinctions. Use human Pick & polish requests and corrections under the same evidence standards as ordinary reviews. Agent answers, `ready` work and a `resolved` conversation do not verify a fix or justify a guidance rule. Keep missing message times, screenshots and other unavailable metadata explicit; never fill them from the current prototype. Legacy v1 reviews remain review-only, not mixed-source evidence.

## 2. Investigate the guidance

Read current consumer instructions and [context resolution](../product-design/references/context-resolution.md). Respect saved source skips and topic restrictions. Select the active context root once; read shared authority rules and task-relevant sections of the owners and their directly linked topics. Product findings use `PRODUCT-DESIGN.md`; design-system findings use `DESIGN-SYSTEM.md`; other findings use their declared owner. Inspect `REPOSITORY.md` when local ownership or guidance locations need clarification.

Compare the selected evidence against existing guidance and its applicability, exceptions and authority. Read the relevant workflow's context pointers only when necessary to establish whether an existing rule is reachable. Missing context, unresolved policy conflicts or unavailable evidence block only the affected finding; offer explicit context setup or refresh rather than invoking it automatically.

Keep investigation bounded to selected findings and reusable consumer-owned guidance. Preserve intentional customization and distinctions between provider facts, team decisions and proposed defaults. Approval of wording does not verify an external standard or turn a preference into a universal rule. Relevance confidence never substitutes for evidence that the proposed change is warranted.

Assign every selected finding one outcome:

| Outcome | Required explanation |
| --- | --- |
| Guidance change proposed | The supported gap or contradiction, why the wording would help, its applicability and exceptions, and the existing canonical owner |
| Already covered | The matching guidance and relevant loading/applicability evidence; no duplicate rule |
| Needs clarification | The missing evidence, unresolved authority or user decision; no speculative solution |
| Environment investigation suggested | The suspected connection, limited supporting observation and what remains unverified; a separate investigation would be needed |

The environment referral is an outcome, not permission to audit or repair. Components, defaults, templates, installed skill procedures, context-loading wiring, dependencies and configuration remain unchanged. Individual prototype fixes, upstream contributions and Hub learning decisions are also outside this flow. If existing guidance is present but its reach or effectiveness cannot be established, report the uncertainty instead of claiming a loading defect.

Investigation is complete when every selected finding has an evidence-backed outcome, with no unsupported cause presented as verified.

## 3. Present solutions and wait

For every proposed guidance change, present a stable proposal ID and its finding IDs, rationale, evidence links without raw private comment text, exact target paths, and a before/after or diff showing every intended edit. Identify affected users, authority, limitations and a concrete way to check the wording against the finding. Keep the proposal in chat or private session artifacts, not a repository draft.

Combine compatible overlapping edits into one coherent proposed diff, preserving the finding-to-proposal mapping. Contradictory proposals need an explicit user decision before a combined solution can be prepared. Each investigation must remain individually accounted for. Changes to unrelated evidence indexes, provenance notes or guidance owners are not implicit follow-ups.

Present all outcomes before asking which proposal IDs to approve, revise or reject. Users may approve an explicitly enumerated batch of displayed proposals. Resolve ambiguous approval; requested revisions require a new preview and approval. Choosing none ends the flow with no edits. Defer blocked findings without holding up independent proposals.

Only after explicit approval of the displayed changes, read [apply approved guidance](./references/apply.md). Until then, stop at proposals ready for review.
