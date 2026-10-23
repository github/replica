import {
  CheckCircleIcon,
  CopilotIcon,
  CrosshairsIcon,
  KebabHorizontalIcon,
  ReplyIcon,
  SparkleIcon,
  TrashIcon,
  XIcon,
} from "@primer/octicons-react"
import { ActionMenu, Button, Heading } from "@primer/react-brand"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { renderToStaticMarkup } from "react-dom/server"

import { HubSidebar } from "@components/hub-sidebar"
import { HubCounter } from "@components/hub-counter"
import { HubIconButton } from "@components/hub-icon-button"
import { CanvasDialog } from "@components/prototype-canvas-dialog"
import { ReviewMessageHeading } from "@components/review-message-heading"
import { ReviewConversationFrame } from "@components/review-conversation-frame"
import { HubUserAvatar } from "@components/hub-user-avatar"
import { ReviewParticipantStack } from "@features/review-participant-stack"
import { useReviewCardPosition } from "@hooks/use-review-card-position"
import { ReviewThreadReplyForm } from "@features/review-thread-reply-form"
import { copy } from "./en"
import type { ImprovementThread, ImprovementThreadsProps } from "./types"
import avatarPlaceholder from "../../../../public/avatar-placeholder.svg?raw"

import "@features/review-comment-row/styles.css"
import "@features/review-thread-message/styles.css"
import "@features/review-thread-conversation/styles.css"
import "@features/prototype-canvas-hub-panel/styles.css"
import "@features/review-comment-markers/styles.css"
import "./styles.css"

const fallbackAvatar = `data:image/svg+xml,${encodeURIComponent(avatarPlaceholder)}`
const copilotAvatar = `data:image/svg+xml,${encodeURIComponent(
  renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <CopilotIcon size={16} fill="white" />
    </svg>,
  ),
)}`

export function ImprovementThreads({
  threads,
  open,
  active = open,
  onOpen,
  onClose,
  onFollowUp,
  onResolve,
  onDelete,
  onFix,
  onSelect,
  onRetry,
  identity,
  busy = false,
  activeBatch = false,
  error = "",
  returnFocusRef,
  controls = true,
}: ImprovementThreadsProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const [openedThread, setOpenedThread] = useState<ImprovementThread | null>(null)
  const [draft, setDraft] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [deleting, setDeleting] = useState<ImprovementThread | null>(null)
  const [openedIdentity, setOpenedIdentity] = useState(identity)
  const [message, setMessage] = useState("")
  const [filter, setFilter] = useState("active")
  const [surface, setSurface] = useState<HTMLDivElement | null>(null)
  const [slot] = useState(() => document.querySelector("#canvas-improvement-controls"))
  const trigger = useRef<HTMLButtonElement>(null)
  const fallbackFocus = returnFocusRef ?? trigger
  const opener = useRef<HTMLElement | null>(null)
  const menuThread = useRef<{ identity: string; id: number; revision: number } | null>(null)
  const cardButtons = useRef(new Map<number, HTMLButtonElement>())
  const returnTo = useRef<number | null>(null)
  const closingSidebar = useRef(false)
  const currentThread = threads.find((item) => item.id === selected)
  const changedIdentity = (selected !== null || deleting !== null) && identity !== openedIdentity
  const thread = identity !== openedIdentity ? openedThread : (currentThread ?? openedThread)
  const removed = selected !== null && !currentThread
  const deletionRemoved = deleting !== null && !threads.some((item) => item.id === deleting.id)
  const { cardRef: conversation, position } = useReviewCardPosition({
    anchorPoint: { x: 12, y: 12 },
    anchorSelector: selected === null ? undefined : `[data-improvement-thread-id="${selected}"]`,
    layoutKey: `${selected}:${discarding}:${thread?.messages.length}:${thread?.status}`,
  })
  const pending = threads.reduce(
    (count, item) =>
      count + Number(item.originalPending) + item.messages.filter((entry) => entry.pending).length,
    0,
  )
  const tooLong = new TextEncoder().encode(draft).length > 10_000
  const filters = [
    { value: "active", label: copy.allActive },
    { value: "ready", label: copy.ready },
    { value: "resolved", label: copy.resolved },
  ]
  const filterLabel = filters.find((item) => item.value === filter)!.label
  const visible = threads.filter((item) =>
    filter === "resolved"
      ? item.status === "resolved"
      : filter === "ready"
        ? item.status === "ready"
        : item.status !== "resolved",
  )

  useLayoutEffect(() => {
    if (selected !== null) {
      if (discarding)
        conversation.current
          ?.querySelector<HTMLButtonElement>(".review-confirmation-panel button")
          ?.focus()
      else if (changedIdentity || removed)
        conversation.current?.querySelector<HTMLButtonElement>(".thread-sample__close")?.focus()
      else conversation.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus()
    } else if (returnTo.current !== null) {
      const target = opener.current?.isConnected
        ? opener.current
        : (cardButtons.current.get(returnTo.current) ?? fallbackFocus.current)
      target?.focus()
      returnTo.current = null
    }
  }, [selected, discarding, conversation, fallbackFocus, changedIdentity, removed])

  const leave = useCallback(
    (restoreFocus = true) => {
      returnTo.current = restoreFocus ? selected : null
      setSelected(null)
      setOpenedThread(null)
      setDraft("")
      setDiscarding(false)
      if (closingSidebar.current) {
        onClose()
        fallbackFocus.current?.focus()
        closingSidebar.current = false
      }
    },
    [selected, onClose, fallbackFocus],
  )

  const requestClose = useCallback(
    (restoreFocus = true) => {
      if (draft.trim()) setDiscarding(true)
      else if (selected !== null) leave(restoreFocus)
      else {
        onClose()
        fallbackFocus.current?.focus()
      }
    },
    [draft, selected, leave, onClose, fallbackFocus],
  )

  useEffect(() => {
    if (selected === null) return
    function dismiss(restoreFocus = true) {
      if (document.querySelector('[role="menu"]') || deleting) return
      if (discarding) {
        if (!restoreFocus) return
        closingSidebar.current = false
        setDiscarding(false)
      } else requestClose(restoreFocus)
    }
    function bridgeDismiss(event: Event) {
      if (!(event instanceof CustomEvent)) {
        dismiss()
        return
      }
      const detail: unknown = event.detail
      dismiss(
        !detail ||
          typeof detail !== "object" ||
          !("restoreFocus" in detail) ||
          detail.restoreFocus !== false,
      )
    }
    function escape(event: KeyboardEvent) {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        (event.target instanceof Element && event.target.closest('[role="menu"], dialog'))
      )
        return
      event.preventDefault()
      dismiss()
    }
    function pointerDown(event: PointerEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.isPrimary === false ||
        deleting ||
        discarding ||
        !(event.target instanceof Element) ||
        conversation.current?.contains(event.target) ||
        event.target.closest(
          '.thread-sample__card-button, .thread-sample__marker, .thread-sample__menu, [role="menu"], dialog',
        )
      )
        return
      requestClose(false)
    }
    document.addEventListener("keydown", escape)
    document.addEventListener("pointerdown", pointerDown, true)
    window.addEventListener("replica:review-dismiss", bridgeDismiss)
    return () => {
      document.removeEventListener("keydown", escape)
      document.removeEventListener("pointerdown", pointerDown, true)
      window.removeEventListener("replica:review-dismiss", bridgeDismiss)
    }
  }, [selected, discarding, deleting, requestClose, conversation])

  function show(id: number, element: HTMLElement) {
    if (draft.trim() || discarding) return
    opener.current = element
    setOpenedIdentity(identity)
    setOpenedThread(threads.find((item) => item.id === id) ?? null)
    setSelected(id)
    onSelect?.(id)
  }

  async function submit() {
    if (!thread || !draft.trim() || tooLong || changedIdentity || removed || busy || submitting)
      return
    const submitted = draft.trim()
    setSubmitting(true)
    try {
      if (!(await onFollowUp(thread, submitted))) return
      setDraft((current) => (current.trim() === submitted ? "" : current))
      setMessage(copy.added)
    } finally {
      setSubmitting(false)
    }
  }

  async function resolveFromMenu(item: ImprovementThread) {
    if (
      menuThread.current?.identity !== identity ||
      menuThread.current.id !== item.id ||
      menuThread.current.revision !== item.revision ||
      item.status !== "ready" ||
      busy ||
      draft.trim() ||
      discarding
    )
      return
    const returnFocus = opener.current
    if ((await onResolve(item)) && !returnFocus?.isConnected) fallbackFocus.current?.focus()
  }

  async function retryFromMenu(item: ImprovementThread) {
    if (
      menuThread.current?.identity !== identity ||
      menuThread.current.id !== item.id ||
      menuThread.current.revision !== item.revision ||
      !onRetry ||
      !item.retryStatus ||
      busy ||
      draft.trim() ||
      discarding
    )
      return
    await onRetry(item)
  }

  const toolbarControl = (
    <Button
      ref={trigger}
      size="small"
      variant="secondary"
      className="canvas-toolbar-compact-button"
      leadingVisual={<CrosshairsIcon size={16} />}
      aria-label={copy.open}
      title={copy.open}
      aria-expanded={open}
      onClick={onOpen}
    >
      <span className="canvas-toolbar-button-label">{copy.title}</span>
    </Button>
  )

  return (
    <>
      {controls ? (slot ? createPortal(toolbarControl, slot) : toolbarControl) : null}
      <HubSidebar
        title={copy.title}
        open={open}
        closeLabel={copy.close}
        onClose={() => {
          if (selected !== null) {
            closingSidebar.current = true
            requestClose()
          } else {
            onClose()
            fallbackFocus.current?.focus()
          }
        }}
        closeDisabled={discarding}
        className="thread-sample"
        contentClassName="thread-sample__content"
      >
        {error ? (
          <p role="alert" className="thread-sample__error">
            {error}
          </p>
        ) : null}
        <div className="thread-sample__toolbar">
          <div className="thread-sample__filters">
            <ActionMenu
              size="small"
              selectionVariant="single"
              menuAlignment="start"
              onSelect={setFilter}
            >
              <ActionMenu.Button
                size="small"
                variant="secondary"
                aria-label={`${copy.filter}: ${filterLabel}`}
              >
                {filterLabel}
              </ActionMenu.Button>
              <ActionMenu.Overlay aria-label={copy.filter}>
                {filters.map((item) => (
                  <ActionMenu.Item
                    key={item.value}
                    value={item.value}
                    selected={filter === item.value}
                    role="menuitemradio"
                    onKeyDownCapture={(event) => {
                      if (event.key !== " " && event.key !== "Enter") return
                      event.preventDefault()
                      event.stopPropagation()
                      event.currentTarget.click()
                    }}
                  >
                    {item.label}
                  </ActionMenu.Item>
                ))}
              </ActionMenu.Overlay>
            </ActionMenu>
            {filter === "active" ? (
              <Button
                size="small"
                variant="primary"
                className="thread-sample__fix-all"
                leadingVisual={<SparkleIcon size={16} />}
                disabled={!pending || Boolean(draft.trim()) || discarding || busy || activeBatch}
                aria-busy={busy}
                aria-label={copy.simulate(pending)}
                onClick={() => {
                  void onFix()
                }}
              >
                <span className="thread-sample__fix-label">
                  {copy.fix}
                  <HubCounter aria-hidden="true">{pending}</HubCounter>
                </span>
              </Button>
            ) : null}
          </div>
        </div>
        {thread && surface
          ? createPortal(
              <ReviewConversationFrame
                ref={conversation}
                aria-label={copy.conversation}
                anchored
                position={position}
                className="thread-sample__conversation"
                onKeyDown={(event) => {
                  if (
                    event.key === "Escape" &&
                    !event.defaultPrevented &&
                    !event.nativeEvent.isComposing &&
                    !(event.target instanceof Element && event.target.closest('[role="menu"]'))
                  ) {
                    event.preventDefault()
                    if (discarding) {
                      closingSidebar.current = false
                      setDiscarding(false)
                    } else requestClose()
                  }
                }}
              >
                <div className="review-thread-conversation__layout">
                  <header className="review-thread-conversation__header">
                    <Heading as="h3" size="6">
                      {copy.conversation}
                    </Heading>
                    {thread.status === "ready" ? (
                      <Button
                        size="small"
                        variant="secondary"
                        className="thread-sample__resolve"
                        disabled={Boolean(draft.trim()) || busy || changedIdentity || removed}
                        leadingVisual={<CheckCircleIcon size={16} />}
                        onClick={() => {
                          void onResolve(thread)
                        }}
                      >
                        {copy.resolve}
                      </Button>
                    ) : null}
                    <HubIconButton
                      icon={XIcon}
                      size="small"
                      variant="invisible"
                      aria-label={copy.back}
                      className="thread-sample__close"
                      onClick={() => requestClose()}
                    />
                  </header>
                  {changedIdentity ? (
                    <p role="alert" className="thread-sample__error">
                      {copy.changedIdentity}
                    </p>
                  ) : null}
                  {removed ? (
                    <p role="alert" className="thread-sample__error">
                      {copy.removed}
                    </p>
                  ) : null}
                  {error ? (
                    <p role="alert" className="thread-sample__error">
                      {error}
                    </p>
                  ) : null}
                  {!thread.point ? (
                    <p role="status" className="thread-sample__target-status">
                      {copy.targetUnavailable}
                    </p>
                  ) : null}
                  <div className="review-thread-conversation__messages">
                    <article className="review-thread-message">
                      <ReviewMessageHeading
                        visual={
                          <HubUserAvatar src={thread.avatarUrl ?? fallbackAvatar} size={28} />
                        }
                        author={thread.author}
                      />
                      <p className="review-thread-message__body">{thread.body}</p>
                    </article>
                    {thread.messages.map((entry) => (
                      <article className="review-thread-message" key={entry.id}>
                        <ReviewMessageHeading
                          visual={
                            entry.role === "copilot" ? (
                              <HubUserAvatar
                                src={copilotAvatar}
                                size={28}
                                className="thread-sample__copilot-avatar"
                              />
                            ) : (
                              <HubUserAvatar
                                src={
                                  entry.author
                                    ? (entry.avatarUrl ?? fallbackAvatar)
                                    : (thread.avatarUrl ?? fallbackAvatar)
                                }
                                size={28}
                              />
                            )
                          }
                          author={
                            entry.role === "copilot"
                              ? copy.copilot
                              : (entry.author ?? thread.author)
                          }
                          metadata={
                            entry.role === "author" && entry.status && entry.status !== "ready" ? (
                              <span>{copy.workStatus(entry.status)}</span>
                            ) : undefined
                          }
                        />
                        <p className="review-thread-message__body">{entry.body}</p>
                      </article>
                    ))}
                  </div>
                  <div className="review-thread-conversation__footer">
                    <ReviewThreadReplyForm
                      blockedLabel={null}
                      confirmingDiscard={discarding}
                      replyDraft={draft}
                      replyBodyTooLong={tooLong}
                      replyFailed={false}
                      replyDisabled={changedIdentity || removed}
                      replying={submitting}
                      submitDisabled={busy}
                      copy={copy.comments}
                      onKeepDraft={() => {
                        closingSidebar.current = false
                        setDiscarding(false)
                      }}
                      onDiscardDraft={leave}
                      onSubmit={() => {
                        void submit()
                      }}
                      onDraftChange={setDraft}
                    />
                  </div>
                </div>
              </ReviewConversationFrame>,
              surface,
            )
          : null}
        <div className="thread-sample__list">
          {visible.length === 0 ? <p className="thread-sample__empty">{copy.empty}</p> : null}
          {visible.map((item) => {
            const count = item.messages.filter((entry) => entry.role === "author").length
            return (
              <article
                className={`review-comment-row thread-sample__card${item.status === "resolved" ? " thread-sample__card--resolved" : ""}`}
                key={item.id}
              >
                <button
                  ref={(element) => {
                    if (element) cardButtons.current.set(item.id, element)
                    else cardButtons.current.delete(item.id)
                  }}
                  className="review-comment-row__button thread-sample__card-button"
                  aria-label={`Open improvement: ${item.body}`}
                  aria-expanded={selected === item.id}
                  disabled={Boolean(draft.trim()) || discarding}
                  onClick={(event) => show(item.id, event.currentTarget)}
                >
                  <span className="review-comment-row__layout">
                    <HubUserAvatar src={item.avatarUrl ?? fallbackAvatar} size={20} />
                    <span className="review-comment-row__content">
                      <span className="review-comment-row__copy">
                        <span className="thread-sample__heading">
                          <strong className="review-comment-row__author">{item.author}</strong>
                          {item.status !== "open" ? (
                            <span
                              className={`thread-sample__status${item.status === "ready" ? " thread-sample__status--ready" : ""}`}
                            >
                              {copy.workStatus(item.status)}
                            </span>
                          ) : null}
                        </span>
                        <span className="review-comment-row__body">{item.body}</span>
                      </span>
                    </span>
                  </span>
                </button>
                <div className="thread-sample__metadata">
                  <span>{item.target}</span>
                  <span aria-hidden="true">·</span>
                  <code>{item.path}</code>
                </div>
                {count > 0 ? (
                  <span className="thread-sample__follow-ups">
                    <ReplyIcon size={12} aria-hidden="true" />
                    {copy.followUps(count)}
                  </span>
                ) : null}
                <div className="thread-sample__menu">
                  <ActionMenu
                    selectionVariant="none"
                    size="small"
                    menuAlignment="end"
                    disabled={Boolean(draft.trim()) || discarding}
                  >
                    <ActionMenu.IconButton
                      icon={KebabHorizontalIcon}
                      aria-label={`${copy.actions}: ${item.id}`}
                      variant="invisible"
                      onClick={(event) => {
                        opener.current = event.currentTarget
                        menuThread.current = { identity, id: item.id, revision: item.revision }
                      }}
                    />
                    <ActionMenu.Overlay aria-label={`${copy.actions}: ${item.id}`}>
                      {onRetry && item.retryStatus ? (
                        <ActionMenu.Item
                          value="retry"
                          disabled={busy}
                          className="thread-sample__menu-item"
                          onClick={() => {
                            void retryFromMenu(item)
                          }}
                        >
                          {item.retryStatus === "sent" ? copy.returnToActive : copy.retry}
                        </ActionMenu.Item>
                      ) : null}
                      {item.status === "ready" ? (
                        <ActionMenu.Item
                          value="resolve"
                          className="thread-sample__menu-item"
                          disabled={busy}
                          leadingVisual={<CheckCircleIcon size={16} />}
                          onClick={() => {
                            void resolveFromMenu(item)
                          }}
                        >
                          {copy.markResolved}
                        </ActionMenu.Item>
                      ) : null}
                      <ActionMenu.Item
                        value="delete"
                        className="thread-sample__menu-item thread-sample__delete"
                        disabled={busy}
                        leadingVisual={<TrashIcon size={16} />}
                        onClick={() => {
                          if (busy || draft.trim() || discarding) return
                          setOpenedIdentity(identity)
                          setDeleting(item)
                        }}
                      >
                        {copy.delete}
                      </ActionMenu.Item>
                    </ActionMenu.Overlay>
                  </ActionMenu>
                </div>
              </article>
            )
          })}
        </div>
      </HubSidebar>
      <div
        ref={setSurface}
        className="canvas-conversation-shell thread-sample__surface"
        hidden={!active}
      />
      <div className="canvas-conversation-shell thread-sample__markers" hidden={!active}>
        {threads
          .filter((item) => item.id === selected || visible.includes(item))
          .filter((item) => item.point)
          .map((item) => (
            <button
              type="button"
              key={item.id}
              className={`review-comment-marker thread-sample__marker${selected === item.id ? " review-comment-marker--selected" : ""}`}
              data-improvement-thread-id={item.id}
              aria-label={copy.point(item.id)}
              aria-expanded={selected === item.id}
              disabled={Boolean(draft.trim()) || discarding}
              style={{
                left: item.point!.x,
                top: item.point!.y,
              }}
              onClick={(event) => show(item.id, event.currentTarget)}
            >
              <ReviewParticipantStack
                participants={[
                  { login: item.author, name: null, avatarUrl: item.avatarUrl ?? fallbackAvatar },
                ]}
                size="small"
              />
            </button>
          ))}
      </div>
      <p className="visually-hidden" role="status">
        {message}
      </p>
      {deleting ? (
        <CanvasDialog
          title={copy.deleteTitle}
          closeLabel={copy.comments.cancelEditLabel}
          onClose={() => setDeleting(null)}
          returnFocusRef={opener}
        >
          {changedIdentity ? (
            <p role="alert" className="thread-sample__error">
              {copy.changedIdentity}
            </p>
          ) : null}
          {deletionRemoved ? (
            <p role="alert" className="thread-sample__error">
              {copy.removed}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="thread-sample__error">
              {error}
            </p>
          ) : null}
          <blockquote className="thread-sample__quote">{deleting.body}</blockquote>
          <div className="thread-sample__delete-actions">
            <Button size="small" variant="secondary" onClick={() => setDeleting(null)}>
              {copy.comments.cancelEditLabel}
            </Button>
            <Button
              size="small"
              variant="primary"
              className="thread-sample__delete-confirm"
              disabled={busy || changedIdentity || deletionRemoved}
              onClick={async () => {
                if (busy || changedIdentity || deletionRemoved) return
                if (await onDelete(deleting)) {
                  const next = visible.find((item) => item.id !== deleting.id)
                  opener.current =
                    (next ? cardButtons.current.get(next.id) : null) ?? fallbackFocus.current
                  if (selected === deleting.id) leave()
                  setDeleting(null)
                }
              }}
            >
              {copy.delete}
            </Button>
          </div>
        </CanvasDialog>
      ) : null}
    </>
  )
}
