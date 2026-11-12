import { XIcon } from "@primer/octicons-react"
import { Button, Heading } from "@primer/react-brand"

import { HubCounter } from "@components/hub-counter"
import { HubIconButton } from "@components/hub-icon-button"
import { HubSpinner } from "@components/hub-spinner"
import { HubSidebar } from "@components/hub-sidebar"
import { ReviewCommentFilterControls } from "@features/review-comment-filter-controls"
import { ReviewCommentRow } from "@features/review-comment-row"

import type { ReviewCommentsSidebarProps } from "./types"

import "./styles.css"

export function ReviewCommentsSidebar({
  frame,
  threads,
  currentBuildNumber,
  buildLinkOrigin,
  totalCount,
  hasThreads,
  filters,
  participants,
  resolutions,
  selectedThreadId,
  selectionBlocked,
  closeBlocked,
  showPins,
  loading,
  loadFailed,
  notice,
  copy,
  onClose,
  onFiltersChange,
  onShowPinsChange,
  onRetry,
  onSelect,
}: ReviewCommentsSidebarProps) {
  const emptyLabel = hasThreads ? copy.noMatchesLabel : copy.emptyLabel

  const content = (
    <>
      {notice}

      <ReviewCommentFilterControls
        compact={!frame}
        filters={filters}
        participants={participants}
        showPins={showPins}
        copy={copy}
        onFiltersChange={onFiltersChange}
        onShowPinsChange={onShowPinsChange}
      />

      <div className="review-comments-sidebar__body" aria-live="polite">
        {loadFailed ? (
          <div className="review-comments-sidebar__state" role="alert">
            <span>{copy.loadErrorLabel}</span>

            <Button size="small" onClick={onRetry}>
              {copy.retryLabel}
            </Button>
          </div>
        ) : threads.length === 0 && !loading ? (
          <div className="review-comments-sidebar__state">{emptyLabel}</div>
        ) : (
          <div className="review-comments-sidebar__threads">
            {threads.map((thread) => (
              <ReviewCommentRow
                key={thread.root.id}
                thread={thread}
                currentBuildNumber={currentBuildNumber}
                buildHref={
                  buildLinkOrigin && thread.root.buildPath
                    ? new URL(thread.root.buildPath, buildLinkOrigin).href
                    : undefined
                }
                resolution={resolutions.get(thread.root.id)}
                selected={selectedThreadId === thread.root.id}
                selectionBlocked={selectionBlocked}
                copy={copy}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}

        {loading ? (
          <div className="review-comments-sidebar__loading">
            <HubSpinner decorative size="small" />

            <span>{copy.loadingLabel}</span>
          </div>
        ) : null}
      </div>
    </>
  )

  if (frame)
    return (
      <HubSidebar
        {...frame}
        title={copy.heading}
        closeLabel={copy.closeLabel}
        closeDisabled={closeBlocked}
        closeShortcut="Shift+C"
        onClose={onClose}
        headerAccessory={<HubCounter>{totalCount}</HubCounter>}
      >
        {content}
      </HubSidebar>
    )

  return (
    <aside className="review-comments-sidebar" aria-label={copy.heading}>
      <header className="review-comments-sidebar__header">
        <span className="review-comments-sidebar__heading">
          <Heading as="h2" size="6">
            {copy.heading}
          </Heading>
          <HubCounter>{totalCount}</HubCounter>
        </span>
        <HubIconButton
          icon={XIcon}
          aria-label={copy.closeLabel}
          aria-keyshortcuts="Shift+C"
          description={copy.closeLabel}
          size="small"
          variant="invisible"
          className="review-comments-sidebar__close"
          disabled={closeBlocked}
          onClick={onClose}
        />
      </header>
      {content}
    </aside>
  )
}
