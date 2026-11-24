# Review collaboration

Hub stores repository review conversations independently of the learning store. A thread belongs to one non-removed repository and one reviewable prototype branch. Its immutable anchor records the page and selected element or area from the successful Build where the conversation began.

Threads and messages have separate UUID storage identities. Each message also has a positive integer public ID; the root public ID remains the conversation ID used by the retained review client and future learning imports. Each message stores the stable Hub user UUID and a login and name snapshot. Replies stay flat under the root message. Authors may edit or soft-delete only their own messages. Soft deletion retains the source body and records the deletion time, while product reads and learning snapshots return `null` instead of the deleted text. A later learning redaction removes copied versions from the separate learning store.

Resolution is thread state, not message state. Each real resolve or reopen transition appends an immutable event with a monotonically increasing thread sequence, stable actor UUID, presentation snapshot, and occurrence time. Repeating an already-applied transition is idempotent and adds no event. A resolved thread must be reopened before it accepts another reply.

## Repository authorization

Local sessions can view and change reviews only for active repositories with a configured local path. The local sign-in still uses one fixed identity; collaborators in automated tests are separate saved identities, not another sign-in mode. GitHub sessions can review only non-local repositories included in their current installation access. Hub verifies the signed-in GitHub subject's current repository permission through the configured App. The route also rechecks the live session and persisted repository visibility. These checks do not grant any Hub or Entra role.

GitHub review access and mentions support Enterprise Managed User logins, including their underscore and enterprise shortcode. Permission checks still bind the returned account to its numeric GitHub identity.

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
| `POST …/review-comments/:commentId/reactions` | Adds a reaction using `{ review_comment_reaction: { content, activity_version } }` |
| `DELETE …/review-comments/:commentId/reactions/:content` | Removes a reaction using `{ review_comment_reaction: { activity_version } }` |
| `POST …/review-comments/:threadId/read` | Marks the displayed activity read using `{ review_thread_read: { activity_version } }` |
| `DELETE …/review-comments/:threadId/read` | Marks the conversation unread for the signed-in member |
| `GET …/review-comments/mention-candidates` | Lists eligible collaborators; accepts an optional `q` login filter |

Reads and mutations retain the existing flat `comments` response contract used by the review client. Root records also carry ordered resolution history for backend consumers; the retained client ignores fields it does not present. Expected failures use `401` for no live session, `403` for another user's message, `404` for inaccessible or cross-scope records, `409` for concurrent changes, and `422` for invalid content or a thread state that rejects the requested change.

The retained prototype screen loads this API directly. A conversation starts from an element or area anchor supplied by the preview bridge and records the selected successful Build number. Replies, edits, deletion, resolution, and reopening update the saved thread without changing Build artifacts. Ordinary failed writes keep the loaded conversation and draft available for retry. A refreshed `401`, `403`, `404`, or `503` clears comments that are no longer authorized.

## Reactions, mentions, and unread state

Members can react to both roots and replies. Each member can add a given reaction once. Repeating an add or removal does not create another activity. Reactions and read changes do not reorder conversations.

Opening a conversation marks the displayed activity read. New activity remains unread while the conversation stays open. Marking unread leaves the conversation and draft open, and saving a review action marks the resulting activity read for its actor. These changes do not mark Inbox notices read.

Members can type `@` to choose a collaborator while composing, replying, or editing. Hub searches eligible collaborators for the typed login instead of filtering the first page of suggestions. For GitHub repositories, Hub searches up to 2,000 collaborators and returns the matches it found within that limit. Each message accepts up to ten distinct case-insensitive logins. Hub checks GitHub identities and repository permissions at save time. Ineligible or unknown logins stay plain text; a provider failure stops the save. GitHub recipients do not need a Hub account. Local suggestions come only from saved identities with an active local membership assignment. The body remains exactly as entered; verified mentions are separate facts.

## Inbox and live review

New roots notify the recorded prototype owner. Replies notify the owner and participants. Participants include all authors and people still mentioned in a live message. Reactions notify only the message author; genuine resolution changes notify other participants. A direct mention takes precedence over a conversation notice, and members never receive notices for their own actions. Removing a reaction or mention withdraws its corresponding notice; deleting the source message removes notices attached to it. Earlier review activity is not backfilled.

Inbox lists only the viewer's accessible activity and returns a total unread count independent of pagination. It rechecks repository access before listing, opening, or changing notice state. Inbox changes use a separate version check. Opening an activity loads the current successful Build and focuses the exact message. Hub acknowledges the notice only after that message opens. Missing messages or repositories are not acknowledged. These are in-app notices only; there is no external delivery or Canvas review endpoint.

`GET /api/notifications/inbox` accepts `unread`, `limit`, and `before`. `GET /api/notifications/:notificationId` returns one authorized notice. `PATCH /api/notifications/:notificationId` accepts `{ notification: { read, version } }` and returns the saved read state and version. Single-notice requests verify only the notice's repository. After saving a read change, the browser checks for new activity before clearing the unread count or leaving the Unread view empty.

The workspace navigation response includes only whether the viewer has eligible unread activity. For GitHub sessions, including Hub administrators, this dot uses stored repository grants. It can lag a GitHub access change until Hub updates those grants. Hub still checks access live when it returns Inbox details or changes notice state.

Opening a notice marks that notice as read once its target message is shown, even when another notice already focused the same message.

When a saved conversation changes, PostgreSQL sends a scoped [WebSocket invalidation](websockets.md#review-delivery). The browser reloads authorized conversation data without closing its current draft, and reloads again after reconnecting. Thread receipts and Inbox read changes do not send review invalidations.

## Learning snapshot seam

Learning orchestration must call:

```ts
captureRepositoryReviewSnapshot(database, repositoryId, capturedAt?)
```

from `server/domains/review-comments/capture-repository-review-snapshot/`. The function uses one repeatable-read transaction and returns a new snapshot UUID, capture time, repository UUID and name, and every repository thread in chronological order. Each thread includes its numeric public ID, UUID storage identity, prototype and Build identity, immutable anchor, root, all replies including deleted messages, stable author UUIDs, edit and deletion times, current resolution, and ordered resolution history.

The snapshot is the complete Hub input for one future learning import. Reactions, mention records, and receipt state are not part of it. Reaction-only updates use a separate collaboration version so they do not change the source snapshot or resolution event sequence.
