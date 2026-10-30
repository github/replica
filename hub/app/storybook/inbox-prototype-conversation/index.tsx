import { useEffect, useRef, useState } from "react"
import { Button, Heading } from "@primer/react-brand"

import { ReviewThreadMessage } from "@features/review-thread-message"
import type { ConversationActivity } from "@features/conversation-inbox/types"
import type { ReviewComment, ReviewRootComment } from "@utils/review-comment/types"

import { octocatRootComment } from "../fixtures/review/comments"
import { reviewCommentsCopy } from "@utils/review-comment/en"
import { octocat } from "../fixtures/users"

import "./styles.css"

export function InboxPrototypeConversation({
  activity,
  onBack,
}: {
  activity: ConversationActivity
  onBack: () => void
}) {
  const conversationRef = useRef<HTMLDivElement>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const root: ReviewRootComment = {
    ...octocatRootComment,
    id: activity.target.threadId,
    body:
      activity.kind === "reply"
        ? "Let's review this iteration together."
        : activity.kind === "reaction"
          ? "This makes the first step feel clearer."
          : activity.excerpt,
    author: activity.kind === "reply" ? octocat : activity.actor,
    createdAt: activity.createdAt,
    updatedAt: activity.createdAt,
    viewerCanEdit: false,
    viewerCanDelete: false,
    reactions:
      activity.kind === "reaction" ? [{ content: "+1", count: 1, viewerHasReacted: false }] : [],
  }
  const messages: ReviewComment[] = [root]
  if (activity.target.commentId !== root.id) {
    messages.push({
      id: activity.target.commentId,
      kind: "reply",
      rootId: root.id,
      body: activity.excerpt,
      author: activity.actor,
      createdAt: activity.createdAt,
      updatedAt: activity.createdAt,
      editedAt: null,
      deletedAt: null,
      viewerCanEdit: false,
      viewerCanDelete: false,
      reactions: [],
    })
  }

  useEffect(() => {
    const message = conversationRef.current?.querySelector<HTMLElement>(
      `[data-review-message-id="${activity.target.commentId}"]`,
    )
    if (!message) throw new Error("The mock conversation target is missing")

    message.dataset.notificationTarget = "true"
    message.tabIndex = -1
    message.scrollIntoView?.({ block: "nearest" })
    message.focus({ preventScroll: true })
  }, [activity.target.commentId])

  function readOnly(): never {
    throw new Error("This conversation is a read-only visual sample")
  }

  return (
    <section
      className="inbox-prototype-conversation"
      aria-label={`${activity.prototype} prototype`}
    >
      <header className="inbox-prototype-conversation__header">
        <div>
          <span>{activity.repository} / v1</span>
          <Heading as="h1" size="6">
            {activity.prototype}
          </Heading>
        </div>
        <Button size="small" variant="subtle" onClick={onBack}>
          Back to inbox
        </Button>
      </header>
      {previewFailed ? <p role="alert">The sample prototype could not load.</p> : null}
      <div className="inbox-prototype-conversation__body">
        <iframe
          src="/prototype-preview/index.html"
          title={`${activity.prototype} prototype (visual sample)`}
          onLoad={(event) => {
            const doc = event.currentTarget.contentDocument
            const heading = doc?.querySelector("h1")
            const target = doc?.getElementById("save")
            if (!doc || !heading || !target) {
              setPreviewFailed(true)
              return
            }
            heading.textContent = activity.prototype
            target.style.outline = "2px solid var(--inbox-target-color)"
            doc.documentElement.style.setProperty(
              "--inbox-target-color",
              getComputedStyle(event.currentTarget).getPropertyValue("--hub-focus"),
            )
          }}
        />
        <aside className="inbox-prototype-conversation__thread" aria-label="Conversation">
          <header>
            <Heading as="h2" size="6">
              Conversation
            </Heading>
            <span>Read-only sample</span>
          </header>
          <div ref={conversationRef}>
            {messages.map((comment) => (
              <ReviewThreadMessage
                key={comment.id}
                comment={comment}
                copy={reviewCommentsCopy}
                mutation={null}
                editing={false}
                editDraft=""
                editBodyTooLong={false}
                editFailed={false}
                confirmingEditDiscard={false}
                saving={false}
                confirmingDelete={false}
                deleting={false}
                deleteFailed={false}
                actionsDisabled
                onStartEdit={readOnly}
                onEditDraftChange={readOnly}
                onSaveEdit={readOnly}
                onCancelEdit={readOnly}
                onKeepEdit={readOnly}
                onDiscardEdit={readOnly}
                onRequestDelete={readOnly}
                onCancelDelete={readOnly}
                onDelete={readOnly}
                onAddReaction={readOnly}
                onRemoveReaction={readOnly}
                onBurstReaction={readOnly}
              />
            ))}
          </div>
        </aside>
      </div>
    </section>
  )
}
