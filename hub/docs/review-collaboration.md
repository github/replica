# Review collaboration

Repository readers can discuss specific elements or highlighted regions inside a Prototype preview. Hub keeps those conversations with the Prototype branch so they remain available across Builds.

The prototype viewer's browser tab shows the saved prototype name, or its branch name when no name is saved. Other Hub pages keep their existing tab titles.

Author-owned [Pick & polish notes](prototype-canvas.md#pick--polish) use separate `ImprovementComment` records, not review conversations. Ordinary interfaces, summaries, unread state, notifications, and learning exclude them. Authorized paired comment list APIs include them only with an explicit `improvement_notes=include` or `only` filter; the default is `exclude`. The dedicated improvement-note collection returns only the authenticated creator's notes.

## Conversations

The starting comment records where the conversation began. Every reply stays directly under it.

Resolved conversations show who resolved them and the instruction to reopen in one message below the comments. The Reopen action remains in the header. If the resolver is unavailable, the footer shows only the reopen instruction.

Reviewers can:

- Start a conversation on an element or highlighted region.
- Reply to an open conversation.
- React to a message.
- Edit or delete their own messages.
- Resolve or reopen a conversation.

New comments and replies send with Cmd+Return on macOS or Ctrl+Enter on Windows and Linux. The submit button tooltip shows the shortcut for the reviewer's platform. Enter inserts a newline in a new comment. The compact reply field also sends on Enter, while Shift+Enter inserts a newline. Shortcuts do not submit empty or oversized drafts, during text composition, while a request is pending, or while a discard confirmation is open.

A pending reply stays visible until Hub confirms it was saved, and a failed request leaves the draft available to retry.
The existing eight reaction options work on both starting comments and replies. Reaction counts and selection update immediately in Hub and the Copilot canvas. A failed request restores the latest saved reactions and shows an error. Pending reactions keep the comment menu and reaction controls in place without disabled styling. Reviewers can open an edit while a reaction saves, but another reaction, saving text, deleting, or resolving waits for that request to finish. Reaction failures stay visible during editing and after canceling the edit. Live updates retain the pending selection without double-counting it.

An accepted reaction add immediately plays a short emoji burst at the action point unless reduced motion is preferred. Removing a reaction or clicking again while a change is pending does not play a burst. A failed add still restores the saved reactions and shows an error. Closing the reaction picker keeps keyboard focus on Add reaction without reopening its tooltip. The tooltip remains available on a fresh hover or focus.
Comment timestamps show short relative ages; the full UTC date remains available to assistive
technology and on hover.

Hub tracks whether each reviewer has seen the latest activity. When someone takes an action in a conversation, Hub treats the current state as read for that person. Only a new conversation or reply changes the order of the list.

In Hub and the Copilot canvas, **Mark as unread** is the first action in the starting comment's menu, including for readers who cannot edit or delete it. **Delete** is separated from the other actions by a divider. Marking unread changes only the current reviewer's conversation read state, not other reviewers or inbox notifications. The conversation and any draft stay open; simply leaving it open does not mark it read again. Closing and reopening marks the displayed activity read. Replying, editing, reacting, or changing resolution retains the existing mark-as-read behavior. A failed unread change shows an error and can be retried from the menu.

## Mentions and inbox

In Hub and the Copilot canvas, type `@` in a new comment, reply, or edit to choose a GitHub repository collaborator. People do not need a Hub account to appear. For repositories where GitHub cannot enumerate every reader, type a login directly; Hub verifies that account's current repository access when saving. Unrecognized or ineligible logins remain plain text. Valid mentions are highlighted, while the saved body remains plain text.

If mention suggestions fail to load, Tab moves from the composer to Retry without closing the popup or changing the draft. Shift+Tab returns to the composer; Escape closes the popup and returns focus there.

Each individual message allows ten distinct mention logins, case-insensitively. A reply has its own allowance, independent of its root and other replies. Duplicate tokens and self-mentions never create additional notifications. A GitHub verification failure prevents the message from saving, shows an error, and leaves the draft available to retry.

Hub resolves recipients to immutable GitHub identities, not mutable logins or Hub registration. `CommentMention` records each message's recipients. Each `Notification` has recipient-specific read state and `NotificationResource` rows identifying its source message as primary and its Prototype as context. Notifications are saved atomically with the action. Someone who has not signed in yet receives their retained notifications on their first authorized Hub sign-in. Standard installations send no invitation, email, or external message. An operator may separately install the optional [external delivery adapter](#external-notification-delivery).

Both Hub and canvas actions create these activities:

- Newly added mentions notify each mentioned person once.
- New conversations notify the recorded prototype owner, even if they have not participated.
- Replies notify the recorded prototype owner and other conversation participants. Someone directly mentioned in a new conversation or reply receives only the mention notification, not an additional comment or reply notification.
- Reactions notify only the author of the reacted-to message.
- Resolving or reopening notifies other participants only when the conversation's state actually changes.

Participants are the people who started, replied to, or remain mentioned anywhere in the conversation. Authors remain participants after their messages are soft-deleted. Someone who participated only through mentions stops receiving future conversation updates when their last mention in any live message is removed. Nobody receives notifications for their own actions.

Inbox is available only in Hub, immediately after Prototypes in the shared sidebar, including administration pages. Without repository context, it follows the Repositories link. Its dark-green badge counts all currently accessible unread notifications, not only loaded rows, and disappears at zero. Hovering or focusing Inbox loads unread activity wherever the sidebar appears, in both expanded and collapsed states, including the Inbox page itself. The preview is rendered outside the sidebar's scrolling area so it is not clipped. Its unread filter is independent of the full page's All/Unread filter, and read changes stay synchronized between both surfaces. View all and the Inbox link open the full page with filters, pagination, and individual read controls. Both surfaces show the actor, repository, Prototype, excerpt, and time. Time appears beside the repository above the excerpt. Reaction notifications retain the smiley badge and show the actual reaction emoji on the excerpt. Unread rows use the default canvas surface; read rows on the full page use the subtle canvas surface and muted text. These surfaces adapt to the current theme. The full-page scroll container reserves a stable scrollbar gutter.

Reaction excerpts use a theme-aware muted canvas background with medium-radius rounded corners. The reaction emoji sits at the quote's bottom-right edge with a small inset, without its own background or border.

The hover preview shows up to ten unread notifications and sits 8 pixels from the Inbox button. Reopening it keeps cached notifications visible while Hub checks for updates. Marking a notification read removes it from the preview. The full page also keeps loaded notifications when switching between All and Unread. Refreshes put new notifications first without discarding older loaded pages.

Each notification has one clickable read-state dot: filled green for unread and outlined gray for read. Hover or keyboard focus previews the state a click will select, filling a read dot green or outlining an unread dot. The dot keeps an accessible action label and a larger click target. Inbox entries and their read controls have no native title tooltips.

Repository access is checked freshly before refreshing notification content, counts, or mutations. An initial load shows a loading state; later refreshes keep cached items visible. Failures clear cached content and offer Retry rather than presenting a failed request as an empty inbox. Counts refresh on page entry and when opening the hover preview; the inbox does not subscribe to live conversation notices or poll.

The Inbox page retains the shared sidebar's permission-aware Analytics, security audit, and Hub administration links. Repository administrators receive repository tools; Hub administrators retain their administration links even when no repository is accessible.

Inbox uses the same Hub workspace data as Welcome and administration pages, including the account menu's System, Light, and Dark theme controls. Opening Inbox preserves the originating readable repository in sidebar navigation without filtering notification activity. Without an accessible repository, the sidebar offers Repositories instead of an empty repository selector. Administration reauthorization pages retain the Inbox hover and focus preview.

Opening an activity from either surface opens its conversation on the current successful Build and focuses and highlights the exact message, including a reply, without automatically opening the Prototype description dialog over it. Only after that message opens does Hub mark that notification read and synchronize the returned read state with the sidebar badge and any loaded preview rows. A missing or inaccessible source is not acknowledged. Explicit read and unread controls use version checks to reject concurrent changes and update the server-derived unread total without discarding loaded pages. Visiting the inbox or reading a thread elsewhere does not change notification read state; existing thread unread rules remain separate.

Ordinary edits do not notify; newly added mentions do. Removing a mention or reaction withdraws its notification and resource associations. Deleting a source message removes notifications for that message. Re-adding a removed mention or reaction creates a new unread activity. Losing mention-only participation does not remove unrelated older activities. Losing repository access hides retained notifications; it does not grant access through a deep link. Existing mentions keep their immutable recipient across GitHub login changes. New activity in existing conversations is supported, but historical activity is not scanned or backfilled.

## External notification delivery

External delivery is inactive unless the operator installs a server-only adapter. Hub ships no messaging provider, internal service endpoint, or recipient directory. A configured deployment starts delivering new activity by default, subject to the adapter's recipient eligibility. It never scans historical Inbox activity.

Open the account menu and choose **Notifications** to turn personal delivery on or off. A Prototype's **More actions** menu can mute or unmute its external updates for yourself. The Notifications page lists your currently accessible muted Prototypes with Unmute controls. Both preferences include mentions and leave Hub Inbox activity, read state, and other people's preferences unchanged.

Hub administrators also have a **Hub delivery** control on that page. Deployment changes require explicit confirmation and fresh GitHub verification. Disabling personal, Prototype, or deployment delivery cancels pending and retryable items; reenabling delivers only new activity. A request already in flight cannot be recalled.

New notifications and their external delivery rows commit together in the primary database. The scheduler recovers due work every minute; activity becomes due at the next UTC hour boundary. A recipient's digest contains at most 25 items per request, so high-volume hours can produce multiple messages. Each item includes its actor, repository, Prototype, a comment excerpt of at most 240 characters, and an authenticated Hub conversation link. Hub refreshes the recipient's login from the immutable GitHub ID and verifies current repository access before sending. Deleted or withdrawn activity is excluded. Sending an item never marks its Inbox notification read, and reading it does not cancel external delivery.

Delivery is at least once, with bounded retries for transient authorization or transport failures. Persisted claims recover from queue failures and abandoned worker leases. A destination key binds queued activity to its original adapter configuration; a different key cancels old work rather than forwarding a backlog. Adapters must change that key when the destination or identity mapping changes. Administrators see a sanitized failure indicator; the server retains fixed failure codes, never provider response bodies or digest text. Delivery history expires after 90 days.

Text already sent to an external provider remains subject to that provider's access and retention rules. Deleting a comment, muting delivery, or losing repository access cannot reliably remove a previously delivered excerpt.

### Adapter contract

Install the adapter separately from the standard Hub image and set `REPLICA_NOTIFICATION_PROVIDER_PATH` to an absolute Ruby initializer path inside the container. Hub loads it during Rails preparation and repeats registration on development reloads. The file registers an object with `NotificationDelivery.provider = adapter` and must support repeated loading. Keep provider code, endpoints, identity mapping, and credentials on the server; inject credentials at runtime, never into public source, browser data, or images.

The adapter implements:

- `key`: a nonsecret stable destination/revision identifier, 1–255 printable ASCII characters. A changed destination or recipient mapping requires a different key. Hub snapshots it with new Inbox activity, so it must be cheap and perform no network requests.
- `label`: a safe display name, 1–80 characters, used in personal controls.
- `eligible?(recipient:)`: returns a boolean. Unknown or ineligible recipients return false, not a guessed destination.
- `deliver!(recipient:, messages:, preferences_url:)`: accepts one bounded digest. Successful return means provider acceptance, not proof someone received or read the message.

`recipient` is a symbol-keyed Hash with `github_id` (Integer) and the freshly resolved `login` (String). `messages` is an Array of at most 25 symbol-keyed Hashes: `id` (Inbox notification ID), `kind`, `actor_login`, `repository` (name with owner), `prototype` (display name), `excerpt`, `occurred_at` (ISO 8601), and `url` (authenticated absolute Hub URL). `preferences_url` is the authenticated absolute Notifications settings URL.

An adapter raises `NotificationDelivery::Failure.new(code:, retryable:)` for an expected configuration, delivery, or eligibility failure. Allowed codes are `transport_timeout`, `rate_limited`, `service_unavailable`, `authentication_failed`, `recipient_unavailable`, `invalid_payload`, and `eligibility_unavailable`; `authorization_unavailable` is reserved for Hub access checks. A key lookup failure records a failed delivery rather than rolling back the comment or Inbox activity; Hub cannot safely retry without an original destination key. Exceptions must not contain credentials, provider response text, endpoint URLs, or message bodies. The adapter must bound timeouts, validate provider acknowledgments, avoid duplicate internal retry loops, and fail closed on ambiguous recipient mapping. An uncertain network response may still lead to a duplicate on retry.

Apply the same adapter and runtime configuration to every web and job process. Run `NotificationDelivery.recover!` to recover due work or `NotificationDelivery.clear_expired!` to expire old delivery records. These operations are also scheduled by Solid Queue. Provider configuration changes and removal require restarting all web and job processes consistently.

## Saved targets

Hub stores a description of the selected target so the preview bridge can find it again. This description is called an anchor.

| Target             | What Hub saves                                         |
| ------------------ | ------------------------------------------------------ |
| Element            | Page details, an element description, and its position |
| Highlighted region | The drawn shape and descriptions of nearby elements    |

An element marker follows the element's current position without easing behind it during scrolling. Ordinary targets retain document coordinates while fixed and sticky targets follow their viewport positions. Nested scrolling and layout changes refresh the target geometry. A highlighted region uses its saved position on the Build where it was created. On another Build, the bridge shows the target only when it can match it safely.

The interface reports **Moved**, **Context changed**, or **Not found** when the saved target no longer matches cleanly. The conversation remains available even when Hub cannot place a marker.

## Creating and finding conversations

```text
reviewer selects an element or region
  -> preview bridge describes the target
  -> Hub saves the comment and target
  -> Hub shows a sidebar row and preview marker
```

`C` starts comment selection, matching the canvas: click an element, or drag a rectangle at least eight pixels wide and tall to highlight a region. The header comment menu offers the same single **Add a comment** action. `Shift+C` toggles the comments sidebar, including during target selection, without cancelling it. `O` toggles **Options**. These shortcuts apply when focus is not in an editable field, menu or dialog. Open drafts keep their existing shortcut protections.

The header shows the total number of conversations beside the add-comment control and marks it
when any conversation is unread. Its count opens the comments panel, which sits beside the
preview rather than covering it; on narrow screens it sits below the preview.

Posting an anchored comment or selecting a preview pin opens only that conversation beside its target. Neither action opens or closes the comments panel. Starting comment selection also keeps the panel's current state. Reviewers can open or close the panel with its count or Shift+C.

Minimizing Hub keeps the same comment controls in a draggable review bar over the full-page preview. The comments panel overlays the preview until it is closed. Reviewers can move the bar with its drag handle or the arrow keys and maximize Hub without leaving the current page or losing a draft.

The sidebar lists conversations across Builds and pages. Search and filters affect rows and
markers together. "Unread only" hides read conversations; reviewers can also show only threads they started or
replied to. Filtering never changes the saved read state. Selecting a conversation never changes
the current Build or preview page.

Wide layouts place a conversation beside its displayed first avatar, including when the participant stack shifts away from the preview's right edge. Placement updates when the stack or preview resizes. The conversation flips to the other side and stays within the preview when space is limited. Narrow layouts use a full-width conversation.
Pin stacks show up to four participants, replacing the fourth avatar with an overflow count when
more people join. The stack expands to the right on hover, and the marker tooltip names hidden
participants; pin labels include the number of comments in a thread with replies. Outside clicks
and Escape protect an unfinished new comment with Keep or Discard. Canceling a changed edit asks
for the same choice. A reviewer must save or discard unfinished text before opening another target.

Each pin remains one keyboard target. Its focus ring surrounds the first avatar, not the whole participant stack.

After posting a comment, Escape dismisses its conversation without deleting the saved comment. This also works when focus has moved outside the conversation or into the preview. Unfinished replies and edits still require Keep or Discard; Escape never dismisses a pending save or overrides an open menu or another dialog. A prototype that cancels Escape keeps its own action without dismissing the conversation.

## Live updates and unread state

```text
one reviewer changes a conversation
  -> Hub saves the change
  -> Hub tells other open review pages that comments changed
  -> each page reloads conversations after checking repository access
```

Hub uses Action Cable for the small change notice. The notice contains no comments, saved targets, people, reactions, or read state. The preview does not receive it.

Production uses Solid Cable to write notices in asynchronous batches before delivering them. A saved comment does not wait for its notice to be written. Solid Cable reports failed notice writes through Rails error reporting rather than raising them to the caller; reconnecting review pages reload conversations through the authorized API. Canvas revocation saves the revoked grant before queuing its disconnect notice, so the API rejects the revoked credential even while delivery is pending.

The Copilot canvas's agent actions read these same conversations through a repository-scoped Hub connection and can explicitly act on existing threads. Pick & polish is the default native canvas selection and sidebar workflow; its creator-owned notes replace ordinary review controls and pins in that preview. Start new team conversations on the published Build in Hub. Legacy renderers without Pick & polish retain their anchored conversation controls and local review pins. See [Prototype canvas](prototype-canvas.md#pairing-and-review) for the two modes.

Browser and canvas comment endpoints share their listing, creation, editing, and deletion actions through `ReviewCommentActions`. Their controllers retain separate authentication: the browser uses its Session and anti-forgery token, while the canvas uses a repository-scoped bearer token.

The browser keeps the current preview, open conversation, drafts, menus, and focus while it reloads the complete conversation list. It reloads again after reconnecting.

Unread behavior:

- Opening a conversation marks the activity currently shown as read.
- New activity stays unread while that conversation remains open.
- Closing and reopening marks the newer activity as read.
- Reacting or replying also marks the current activity as read.
- Read changes do not send live notices or reorder conversations.

If Hub can no longer confirm repository access, it removes the loaded review data. Other refresh failures keep the current conversations visible and show an error.

## Browser safety

Hub checks the browser Session, repository access, and an anti-forgery token before changing review data. The GitHub-backed flow confirms current access with GitHub; [development-only local mode](local-development.md) grants access to its one local identity instead.

The Hub page and preview bridge reject messages from unexpected addresses or browser windows and reject unexpected data. Prototype code shares the preview frame with the bridge, so Hub sends the bridge only the comment ID and saved target needed to place a marker.

The preview does not receive comment text, replies, participants, reactions, read state, or credentials. Optional [external notification delivery](#external-notification-delivery) has its own disclosure and retention limits.

## Related guides

- [Gallery](gallery.md)
- [Preview serving](preview-serving.md)
- [Security](security.md)
