# Review collaboration

Hub stores repository review conversations independently of the learning store. A thread belongs to one non-removed repository and one reviewable prototype branch. Its immutable anchor records the page and selected element or area from the successful Build where the conversation began.

Threads and messages have separate UUID storage identities. Each message also has a positive integer public ID; the root public ID remains the conversation ID used by the retained review client and future learning imports. Each message stores the stable Hub user UUID and a login and name snapshot. Replies stay flat under the root message. Authors may edit or soft-delete only their own messages. Soft deletion retains the source body and records the deletion time, while product reads and learning snapshots return `null` instead of the deleted text. A later learning redaction removes copied versions from the separate learning store.

Resolution is thread state, not message state. Each real resolve or reopen transition appends an immutable event with a monotonically increasing thread sequence, stable actor UUID, presentation snapshot, and occurrence time. Repeating an already-applied transition is idempotent and adds no event. A resolved thread must be reopened before it accepts another reply.

## Repository authorization

Local sessions can view and change reviews only for active repositories with a configured local path. GitHub sessions can review only non-local repositories included in their current installation access. The route rechecks the live session, current repository visibility, and matching local or provider review mode before returning conversations. Other identities and inaccessible repositories receive the same not-found response.

Every query also binds prototype, Build, thread, and comment identifiers back to the requested repository, so an identifier from another repository or prototype is not usable through the route. The workspace advertises review and sharing capabilities on each repository instead of inferring them from the sign-in provider.

## Product API

The product review surface uses these authenticated JSON routes:

| HTTP interface | Result |
| --- | --- |
| `GET /api/repositories/:repositoryId/prototypes/:prototypeId/review-comments` | Complete threads for one prototype, newest first |
| `POST /api/repositories/:repositoryId/prototypes/:prototypeId/review-comments` | Starts a thread with `{ review_comment: { build_number, body, anchor } }` on a successful Build |
| `POST /api/repositories/:repositoryId/prototypes/:prototypeId/review-comments/:threadId/replies` | Adds `{ review_comment: { body } }` to an open thread |
| `PATCH /api/repositories/:repositoryId/prototypes/:prototypeId/review-comments/:commentId` | Edits the author's message with `{ review_comment: { body } }` |
| `DELETE /api/repositories/:repositoryId/prototypes/:prototypeId/review-comments/:commentId` | Soft-deletes the author's message |
| `POST /api/repositories/:repositoryId/prototypes/:prototypeId/review-comments/:threadId/resolution` | Resolves a thread |
| `DELETE /api/repositories/:repositoryId/prototypes/:prototypeId/review-comments/:threadId/resolution` | Reopens a thread |

Reads and mutations retain the existing flat `comments` response contract used by the review client. Root records also carry ordered resolution history for backend consumers; the retained client ignores fields it does not present. Expected failures use `401` for no live session, `403` for another user's message, `404` for inaccessible or cross-scope records, `409` for concurrent changes, and `422` for invalid content or a thread state that rejects the requested change.

The retained prototype screen loads this API directly. A conversation starts from an element or area anchor supplied by the preview bridge and records the selected successful Build number. Replies, edits, deletion, resolution, and reopening update the saved thread without changing Build artifacts. Ordinary failed writes keep the loaded conversation and draft available for retry. A refreshed `401`, `403`, `404`, or `503` clears comments that are no longer authorized.

Reactions, mentions, inbox notifications, read or unread state, public sharing, Canvas pairing, and live updates are not part of this flow. Real mode does not present their controls.

## Learning snapshot seam

Learning orchestration must call:

```ts
captureRepositoryReviewSnapshot(database, repositoryId, capturedAt?)
```

from `server/domains/review-comments/capture-repository-review-snapshot/`. The function uses one repeatable-read transaction and returns a new snapshot UUID, capture time, repository UUID and name, and every repository thread in chronological order. Each thread includes its numeric public ID, UUID storage identity, prototype and Build identity, immutable anchor, root, all replies including deleted messages, stable author UUIDs, edit and deletion times, current resolution, and ordered resolution history.

The snapshot is the complete Hub input for one future learning import. It does not prepare a learning store, run labeling or consolidation, make decisions, recall guidance, or perform redaction itself.
