import {
  InboxIcon,
  MentionIcon,
  CommentDiscussionIcon,
  SmileyIcon,
  CheckCircleIcon,
  SyncIcon,
} from "@primer/octicons-react"
import { Button, Heading } from "@primer/react-brand/esm"

import { HubAlert } from "@components/hub-alert"
import { HubUserAvatar } from "@components/hub-user-avatar"
import { ReviewRelativeTime } from "@features/review-relative-time"
import { reviewReactionEmoji } from "@utils/review-reaction-emoji"

import type { ConversationActivity, ConversationInboxCopy } from "./types"

import "./styles.css"

const icons = {
  comment: CommentDiscussionIcon,
  mention: MentionIcon,
  reply: CommentDiscussionIcon,
  reaction: SmileyIcon,
  resolved: CheckCircleIcon,
  reopened: SyncIcon,
}

export function ConversationInbox({
  items,
  copy,
  mode = "preview",
  unreadOnly,
  onFilter,
  onToggleRead,
  onViewAll,
  onOpenActivity,
  totalUnreadCount,
  viewAllPath,
  status,
}: {
  items: readonly ConversationActivity[]
  copy: ConversationInboxCopy
  mode?: "preview" | "page"
  unreadOnly: boolean
  onFilter: (unread: boolean) => void
  onToggleRead: (id: number) => void
  onViewAll?: () => void
  onOpenActivity?: (activity: ConversationActivity) => void
  totalUnreadCount?: number
  viewAllPath?: string
  status?: {
    loading: boolean
    failed: boolean
    copy: { loading: string; error: string; retry: string }
    onRetry: () => void
  }
}) {
  const filterUnread = mode === "preview" || unreadOnly
  const filtered = items.filter((item) => !filterUnread || !item.read)
  const visible = mode === "preview" ? filtered.slice(0, 10) : filtered
  const unreadCount = totalUnreadCount ?? items.filter((item) => !item.read).length

  return (
    <section className="conversation-inbox" data-mode={mode} aria-label={copy.heading}>
      <header className="conversation-inbox__header">
        <div className="conversation-inbox__title">
          <Heading as={mode === "page" ? "h1" : "h2"} size="6">
            {copy.heading}
          </Heading>
          {unreadCount ? (
            <span
              className="conversation-inbox__count"
              aria-label={copy.unreadCount.replace("%{count}", String(unreadCount))}
            >
              {unreadCount}
            </span>
          ) : null}
        </div>
        {mode === "preview" ? (
          <Button
            as={viewAllPath ? "a" : "button"}
            href={viewAllPath}
            data-sg-visit={viewAllPath ? "true" : undefined}
            size="small"
            variant="subtle"
            onClick={onViewAll}
          >
            {copy.viewAll}
          </Button>
        ) : (
          <div className="conversation-inbox__filters" role="group" aria-label={copy.heading}>
            <button type="button" aria-pressed={!unreadOnly} onClick={() => onFilter(false)}>
              {copy.all}
            </button>
            <button type="button" aria-pressed={unreadOnly} onClick={() => onFilter(true)}>
              {copy.unread}
            </button>
          </div>
        )}
      </header>

      {status?.failed ? (
        <div className="conversation-inbox__status" role="alert">
          <HubAlert variant="critical" title={status.copy.error} />
          <Button size="small" onClick={status.onRetry}>
            {status.copy.retry}
          </Button>
        </div>
      ) : null}
      {status?.loading && !visible.length ? (
        <p className="conversation-inbox__status" role="status">
          {status.copy.loading}
        </p>
      ) : null}
      {visible.length ? (
        <ul className="conversation-inbox__list">
          {visible.map((item) => {
            const Icon = icons[item.kind]
            return (
              <li key={item.id} className="conversation-inbox__item" data-unread={!item.read}>
                <div className="conversation-inbox__avatar">
                  <HubUserAvatar src={item.actor.avatarUrl} size={32} />
                  <span
                    className="conversation-inbox__kind"
                    data-kind={item.kind}
                    aria-hidden="true"
                  >
                    <Icon size={12} />
                  </span>
                </div>
                <a
                  className="conversation-inbox__message"
                  href={
                    item.path ??
                    `#prototype-${item.target.prototypeId}-comment-${item.target.commentId}`
                  }
                  data-sg-visit={item.path ? "true" : undefined}
                  onClick={(event) => {
                    if (!item.path) event.preventDefault()
                    onOpenActivity?.(item)
                  }}
                >
                  <p className="conversation-inbox__action">
                    <strong>{item.actor.name || `@${item.actor.login}`}</strong>{" "}
                    {copy.actions[item.kind]}
                  </p>
                  <p className="conversation-inbox__context">
                    {item.prototype} <span aria-hidden="true">·</span> {item.repository}{" "}
                    <span aria-hidden="true">·</span>{" "}
                    <ReviewRelativeTime value={item.createdAt} showTitle={false} />
                  </p>
                  <p
                    className="conversation-inbox__excerpt"
                    data-reaction={item.kind === "reaction"}
                  >
                    <span className="conversation-inbox__excerpt-text">{item.excerpt}</span>
                    {item.kind === "reaction" && item.reactionContent ? (
                      <span className="conversation-inbox__reaction">
                        {" "}
                        {reviewReactionEmoji(item.reactionContent)}
                      </span>
                    ) : null}
                  </p>
                </a>
                <button
                  type="button"
                  className="conversation-inbox__read"
                  data-read={item.read}
                  disabled={status?.loading}
                  aria-label={`${item.read ? copy.markUnread : copy.markRead}: ${item.actor.login}`}
                  onClick={() => onToggleRead(item.id)}
                >
                  <span className="conversation-inbox__dot" aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      ) : !status?.loading && !status?.failed ? (
        <div className="conversation-inbox__empty">
          <InboxIcon size={32} />
          <strong>{filterUnread ? copy.emptyUnread : copy.empty}</strong>
          <p>{filterUnread ? copy.emptyUnreadDescription : copy.emptyDescription}</p>
        </div>
      ) : null}
    </section>
  )
}
