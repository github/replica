import { HistoryIcon } from "@primer/octicons-react"
import { Stack } from "@primer/react-brand/esm"
import { useEffect, useRef, useState } from "react"
import type { SubmitEvent } from "react"

import { HubAlert } from "@components/hub-alert"
import type { CopilotAppSubmission } from "@components/copilot-app-continuation/types"
import { CopilotAppContinuationDialog } from "@components/copilot-app-continuation-dialog"
import { HubEmptyState } from "@components/hub-empty-state"
import { PrototypeBriefComposer } from "@components/prototype-brief-composer"
import { PrototypePreview } from "@features/prototype-preview"
import { MinimizedReviewToolbar } from "@features/minimized-review-toolbar"
import { PrototypeWorkspace } from "@features/prototype-workspace"
import type { PrototypeWorkspaceHeaderProps } from "@features/prototype-workspace-header/types"
import { ReviewCommentComposer } from "@features/review-comment-composer"
import { ReviewCommentMarkers } from "@features/review-comment-markers"
import { ReviewCommentsSidebar } from "@features/review-comments-sidebar"
import { ReviewThreadConversation } from "@features/review-thread-conversation"
import { createPrototypeSubmission } from "@utils/create-prototype-submission"
import { createPreviewPrototypePrompt } from "@utils/create-preview-prototype-prompt"

import { PrototypeDescriptionDialog } from "./prototype-description-dialog"
import type { PrototypesShowPageProps } from "./types"

import "./styles.css"

export function PrototypesShowPage({
  data,
  iframeRef,
  previewTheme,
  review,
  initialInfoOpen = data.showPrototypeInfo || Boolean(data.alert),
  initialComposerExpanded = false,
  onOpenApp,
  viewerUrl,
  minimized: controlledMinimized,
  initialMinimized = false,
  onMinimizedChange,
}: PrototypesShowPageProps) {
  const [localMinimized, setLocalMinimized] = useState(initialMinimized)
  const [controlsToolbar, setControlsToolbar] = useState<HTMLSpanElement | null>(null)
  const [workspaceControlsToolbar, setWorkspaceControlsToolbar] = useState<HTMLSpanElement | null>(
    null,
  )
  const minimized = controlledMinimized ?? localMinimized
  const [infoMode, setInfoMode] = useState<"view" | "edit" | null>(
    initialInfoOpen ? (data.alert && data.detailsEditPath ? "edit" : "view") : null,
  )
  const infoOpen = infoMode !== null
  const [composerExpanded, setComposerExpanded] = useState(initialComposerExpanded)
  const [branchBrief, setBranchBrief] = useState("")
  const branchInput = useRef<HTMLTextAreaElement>(null)
  const [submission, setSubmission] = useState<CopilotAppSubmission | null>(null)
  const canBranch = data.branchSubmissionMode === "copilot" && Boolean(data.newPrototypePath)
  const modalOpen = infoOpen || Boolean(submission)
  const selectedThread = review.selectedThread
  const reviewControls: NonNullable<PrototypeWorkspaceHeaderProps["reviewControls"]> = {
    bridgeReady: review.bridge.ready && Boolean(data.selectedBuild),
    selectionBlocked: review.bridge.selectedAnchor !== null || review.conversationDraftActive,
    selecting: review.bridge.selecting,
    onCancelSelection: review.bridge.cancelSelection,
    onStartAreaSelection: review.startAreaSelection,
    onStartElementSelection: review.startElementSelection,
    commentCount: review.threads.length,
    hasUnreadComments: review.threads.some((thread) => thread.unread),
    sidebarToggleBlocked: review.bridge.selectedAnchor !== null || review.conversationDraftActive,
    sidebarOpen: review.sidebarOpen,
    onToggleSidebar: review.toggleSidebar,
    copy: data.reviewComments.copy,
  }

  function changeMinimized(value: boolean) {
    setLocalMinimized(value)
    onMinimizedChange?.(value)
    if (!review.bridge.selectedAnchor && !review.conversationDraftActive) {
      iframeRef.current?.focus({ preventScroll: true })
    }
  }
  useEffect(() => {
    if (!infoOpen && !composerExpanded && !submission && document.activeElement === document.body) {
      iframeRef.current?.focus({ preventScroll: true })
    }
  }, [infoOpen, composerExpanded, submission, iframeRef])

  let address = data.selectedBuild?.previewUrl ?? ""
  if (address && review.bridge.route) {
    const url = new URL(address)
    url.pathname = review.bridge.route.pathname
    url.search = review.bridge.route.search
    url.hash = review.bridge.route.hash
    address = url.toString()
  }
  address = viewerUrl ?? address

  function branchFromHere() {
    setInfoMode(null)
    setComposerExpanded(true)
    if (composerExpanded) branchInput.current?.focus()
  }

  function submitBranch(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!branchBrief.trim() || !canBranch) return

    const prompt = createPreviewPrototypePrompt({
      brief: branchBrief,
      branchInstructions: data.branchInstructions,
      branchPageInstructions: data.branchPageInstructions,
      previewUrl: data.selectedBuild?.previewUrl,
      route: review.bridge.route,
    })
    setSubmission(
      createPrototypeSubmission({
        repositoryName: data.repositoryName,
        branchName: data.branchName,
        prompt,
      }),
    )
  }

  function closeContinuation() {
    setSubmission(null)
    setComposerExpanded(true)
  }

  return (
    <>
      <div className="review-workspace-layer" data-minimized={minimized}>
        <PrototypeWorkspace
          data={data}
          preview
          onShowInfo={() => setInfoMode("view")}
          editDetails={
            data.detailsEditPath && data.editDetailsLabel
              ? { label: data.editDetailsLabel, onClick: () => setInfoMode("edit") }
              : undefined
          }
          fork={canBranch ? { label: data.forkLabel, onClick: branchFromHere } : undefined}
          reviewControls={reviewControls}
          onControlsToolbarMount={data.controlsIdentity ? setWorkspaceControlsToolbar : undefined}
        >
          <div
            className={`review-page${review.sidebarOpen ? " review-page--comments-open" : ""}${minimized ? " review-page--minimized" : ""}`}
          >
            <Stack gap="none" className="review-shell" padding="none">
              {review.comments.mutationError ? (
                <HubAlert
                  variant="warning"
                  title={review.comments.mutationError}
                  layout="compact"
                />
              ) : null}

              {data.selectedBuild ? (
                <PrototypePreview
                  address={address}
                  copy={data}
                  iframeRef={iframeRef}
                  previewUrl={data.selectedBuild.previewUrl}
                  frameTitle={data.selectedBuild.frameTitle}
                  previewTheme={previewTheme}
                  modalOpen={modalOpen}
                  controlsIdentity={data.controlsIdentity}
                  controlsToolbar={workspaceControlsToolbar}
                  minimizedControlsToolbar={controlsToolbar}
                  onLoad={review.bridge.handleFrameLoad}
                  minimized={minimized}
                  minimize={{ label: data.minimizeHubLabel, onClick: () => changeMinimized(true) }}
                >
                  {review.showPins ? (
                    <ReviewCommentMarkers
                      threads={review.visibleThreads}
                      resolutions={review.bridge.resolutions}
                      selectedThreadId={review.selectedThreadId}
                      selectionBlocked={
                        review.bridge.selectedAnchor !== null || review.conversationDraftActive
                      }
                      copy={data.reviewComments.copy}
                      onSelect={review.selectThread}
                    />
                  ) : null}

                  {selectedThread ? (
                    <div className="review-thread-conversation-layer">
                      <ReviewThreadConversation
                        key={selectedThread.root.id}
                        thread={selectedThread}
                        anchorPoint={review.selectedThreadPoint}
                        bodyMaximumBytes={data.reviewComments.bodyMaximumBytes}
                        mutation={review.comments.mutation}
                        copy={data.reviewComments.copy}
                        onClose={review.closeThread}
                        onDraftStateChange={review.setConversationDraftActive}
                        onReply={async (body) =>
                          Boolean(await review.comments.createReply(selectedThread.root.id, body))
                        }
                        onEdit={async (commentId, body) =>
                          Boolean(await review.comments.editComment(commentId, body))
                        }
                        onDelete={async (commentId) =>
                          Boolean(await review.comments.deleteComment(commentId))
                        }
                        onResolve={async () =>
                          Boolean(await review.comments.resolveThread(selectedThread.root.id))
                        }
                        onReopen={async () =>
                          Boolean(await review.comments.reopenThread(selectedThread.root.id))
                        }
                        onAddReaction={async (commentId, content) =>
                          Boolean(await review.comments.addReaction(commentId, content))
                        }
                        onRemoveReaction={async (commentId, content) =>
                          Boolean(await review.comments.removeReaction(commentId, content))
                        }
                        onMarkRead={async (activityVersion) =>
                          Boolean(
                            await review.comments.markThreadRead(
                              selectedThread.root.id,
                              activityVersion,
                            ),
                          )
                        }
                        onMarkUnread={async () =>
                          Boolean(await review.comments.markThreadUnread(selectedThread.root.id))
                        }
                      />
                    </div>
                  ) : null}

                  {review.bridge.selectionFailure ? (
                    <div className="review-shell__notice">
                      <HubAlert
                        variant="critical"
                        title={
                          review.bridge.selectionFailure === "area-too-small"
                            ? data.reviewComments.copy.areaTooSmallLabel
                            : review.bridge.selectionFailure === "area-unavailable"
                              ? data.reviewComments.copy.areaUnavailableLabel
                              : data.reviewComments.copy.selectionFailedLabel
                        }
                        layout="compact"
                      />
                    </div>
                  ) : null}

                  {review.bridge.selectedAnchor && review.selectedAnchorPoint ? (
                    <ReviewCommentComposer
                      anchorPoint={review.selectedAnchorPoint}
                      bodyMaximumBytes={data.reviewComments.bodyMaximumBytes}
                      copy={data.reviewComments.copy}
                      creating={review.comments.mutation?.kind === "create"}
                      onSubmit={review.createComment}
                      onDiscard={review.bridge.clearSelection}
                    />
                  ) : null}
                </PrototypePreview>
              ) : (
                <div className="review-shell__empty">
                  <HubEmptyState
                    visual={<HistoryIcon size={24} />}
                    heading={data.emptyHeading}
                    description={data.emptyLabel}
                  />
                </div>
              )}
            </Stack>
            {canBranch ? (
              <div className="review-branch-composer">
                <form onSubmit={submitBranch}>
                  <PrototypeBriefComposer
                    inputRef={branchInput}
                    variant="branch"
                    expanded={composerExpanded}
                    onExpand={() => setComposerExpanded(true)}
                    onCollapse={() => setComposerExpanded(false)}
                    value={branchBrief}
                    onChange={(value) => {
                      setBranchBrief(value)
                    }}
                    label={data.branchPlaceholder}
                    placeholder={data.branchPlaceholder}
                    submitLabel={data.branchSubmitLabel}
                    branchFrom={data.branchFromLabel}
                  />
                </form>
              </div>
            ) : null}
            {data.selectedBuild ? (
              <div
                className="review-page__comments"
                aria-hidden={!review.sidebarOpen}
                inert={!review.sidebarOpen}
              >
                <ReviewCommentsSidebar
                  threads={review.visibleThreads}
                  currentBuildNumber={data.selectedBuild.number}
                  totalCount={review.visibleThreads.length}
                  hasThreads={review.threads.length > 0}
                  filters={review.filters}
                  participants={review.participants}
                  resolutions={review.bridge.resolutions}
                  selectedThreadId={review.selectedThreadId}
                  selectionBlocked={
                    review.bridge.selectedAnchor !== null || review.conversationDraftActive
                  }
                  closeBlocked={review.conversationDraftActive}
                  showPins={review.showPins}
                  loading={review.comments.loading}
                  loadFailed={review.comments.loadFailed}
                  copy={data.reviewComments.copy}
                  onClose={review.toggleSidebar}
                  onFiltersChange={review.setFilters}
                  onShowPinsChange={review.setShowPins}
                  onRetry={review.comments.refreshComments}
                  onSelect={review.selectThread}
                />
              </div>
            ) : null}
          </div>
        </PrototypeWorkspace>
      </div>
      {minimized && data.selectedBuild ? (
        <MinimizedReviewToolbar
          controlsSlotRef={data.controlsIdentity ? setControlsToolbar : undefined}
          reviewControls={reviewControls}
          maximizeLabel={data.maximizeHubLabel}
          dragLabel={data.dragControlsLabel}
          onMaximize={() => changeMinimized(false)}
        />
      ) : null}
      {infoOpen ? (
        <PrototypeDescriptionDialog
          data={data}
          editing={infoMode === "edit" && Boolean(data.detailsEditPath)}
          onEditingChange={(editing) => setInfoMode(editing ? "edit" : "view")}
          onClose={() => setInfoMode(null)}
          onBranch={branchFromHere}
        />
      ) : null}
      {submission ? (
        <CopilotAppContinuationDialog
          submission={submission}
          copy={data.branchContinuation}
          onClose={closeContinuation}
          onOpenApp={onOpenApp}
        />
      ) : null}
    </>
  )
}
