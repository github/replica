# Feedback sources

Use this contract for collection, judging and the private proposal handoff. Both ordinary reviews and Pick & polish can contain reusable human observations; neither source kind grants authority or extra weight.

## Identity and conversation

Use one source per retrieved root conversation. Preserve the canvas root `id` unchanged: ordinary reviews use positive safe integers; Pick & polish uses `improvement_note-<id>`, where `<id>` is a positive safe integer in canonical decimal form. Numeric `7` and string `"improvement_note-7"` are different sources. Reject numeric strings, bare improvement database IDs, unsafe integers, invented prefixes and IDs whose type disagrees with `kind`. Judge membership and handoff references use these same typed IDs, never coercion.

Keep each source's `kind`, root/thread ID, prototype identity and complete retrieved root record. Ordinary roots have `kind: "root"` and ordered `replies`. Improvements have `kind: "improvement_note"`, a root `localId` UUID and ordered `thread.messages`. Message UUIDs are local to that conversation for this review: identify them by the source ID plus message ID, never by UUID alone. Follow-ups and answers stay inside their source rather than becoming additional independent sources.

For improvements, the root `body` is the original human request, with `thread.originalStatus` and optional `thread.originalAuthor`. Messages with `role: "author"` are human follow-ups; `role: "copilot"` denotes agent answers whose `requestIds` reference the root `localId` or preceding human message UUIDs. Preserve those links and statuses. A message appearing on a later continuation may answer an earlier page; validate relationships only after assembling the full conversation. Reject duplicate/reordered messages or dangling references as incomplete evidence.

Retain human corrections, withdrawals and contradictions even when they weaken a candidate. An answer cannot replace a human request, establish independent agreement or verify a fix. Count a conversation once and deduplicate repeated observations across both source kinds; repeated requests by one owner do not create independent reviewers or distinct contexts.

## Available metadata

These are retrieval limits, not fields to infer from the current checkout or a live preview.

| Information | Ordinary reviews | Pick & polish |
| --- | --- | --- |
| Original Build and target | Root `buildNumber` and saved `anchor`; compact summaries also return `buildPath` and `targetContext` | Immutable root `buildNumber` and `anchor`; follows the captured source's matching Build, not the latest Build |
| Root lifecycle | `createdAt`, `updatedAt`, `editedAt`, `deletedAt`, `resolvedAt`, `resolvedBy` | `createdAt`, `updatedAt`, `deletedAt`, `revision`, aggregate `status`; no `editedAt`, resolution time or resolver |
| Text changes | Current text and edit time, not previous text versions | Saved text/order are immutable; append a human follow-up to correct a request. Request work statuses can change |
| Message time | Replies have creation/edit/deletion metadata | Message rows have Hub persistence timestamps, but `thread.messages` exports none. Root times are Hub persistence times, not local capture time; preserve order without inventing message dates |
| Author | Returned account login/name/avatar; no explicit human/agent role or immutable user ID in the review record | Root account plus optional historical `originalAuthor`/message `author` snapshots with immutable Hub user IDs; explicit message role. Agent rows belong to the owner in storage but are not authored human evidence |
| Deletion | Deleted placeholders omit deleted text; retained replies may remain | Whole-conversation tombstone: `body` and `thread` are null; Hub clears message text and author snapshots. No deleted text recovery |
| Other context | Saved anchor; screenshots may be referenced by review metadata | Target metadata, no screenshots; no exported local source commit/tree, reactions, mentions or unread state |

Preserve all returned anchor, author and prototype fields without treating them as a verified DOM match. Historical author snapshots may retain an old login; missing snapshots remain unknown, not invented history or a second reviewer. Preserve original Build identity even when no URL is returned. Use only returned or independently verified links; label unavailable links rather than constructing guessed routes.

## Coverage

The default mixed review uses full-detail repository snapshots with `improvementNotes: "include"` and `read: "all"`. Summaries are review-only. Every root page and every ordinary reply or improvement message continuation must finish, including deleted placeholders, before declaring collection complete. A truncated or invalid conversation cannot be promoted as complete evidence.

Record source-kind filters, excluded kinds and reasons, date/read restrictions, root and message counts by kind/role, and continuation completion. `from`/`to` select improvements by root creation only, so recent follow-ups on an older root may be outside a date-limited review. The feed is non-atomic, includes only reviewable prototypes and Hub-synchronized notes, and cannot see private unsynchronized local notes. Do not describe it as all local feedback.
