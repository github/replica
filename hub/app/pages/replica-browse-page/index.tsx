import { GlobeIcon } from "@primer/octicons-react"
import { Stack } from "@primer/react-brand"
import { useEffect, useRef, useState } from "react"
import type { SubmitEvent } from "react"

import type { CopilotAppSubmission } from "@components/copilot-app-continuation/types"
import { CopilotAppContinuationDialog } from "@components/copilot-app-continuation-dialog"
import { HubAlert } from "@components/hub-alert"
import { HubEmptyState } from "@components/hub-empty-state"
import { PrototypeBriefComposer } from "@components/prototype-brief-composer"
import { MinimizedReviewToolbar } from "@features/minimized-review-toolbar"
import { PrototypePreview } from "@features/prototype-preview"
import { PrototypeWorkspace } from "@features/prototype-workspace"
import { createPrototypeSubmission } from "@utils/create-prototype-submission"
import { createPreviewPrototypePrompt } from "@utils/create-preview-prototype-prompt"

import type { ReplicaBrowsePageProps } from "./types"

export function ReplicaBrowsePage({
  data,
  iframeRef,
  previewTheme,
  route,
  viewerUrl,
  minimized: controlledMinimized,
  initialMinimized = false,
  onMinimizedChange,
  onFrameLoad,
  onOpenApp,
}: ReplicaBrowsePageProps) {
  const [localMinimized, setLocalMinimized] = useState(initialMinimized)
  const [controlsToolbar, setControlsToolbar] = useState<HTMLSpanElement | null>(null)
  const [workspaceControlsToolbar, setWorkspaceControlsToolbar] = useState<HTMLSpanElement | null>(
    null,
  )
  const minimized = Boolean(data.selectedBuild) && (controlledMinimized ?? localMinimized)
  const [expanded, setExpanded] = useState(false)
  const [brief, setBrief] = useState("")
  const briefInput = useRef<HTMLTextAreaElement>(null)
  const [submission, setSubmission] = useState<CopilotAppSubmission | null>(null)
  const [copyResult, setCopyResult] = useState<{
    prompt: string
    status: "copied" | "error"
  } | null>(null)
  const prompt = createPreviewPrototypePrompt({
    brief,
    branchInstructions: data.branchInstructions,
    branchPageInstructions: data.branchPageInstructions,
    templateLandingPageInstructions:
      data.templateId === "default" ? undefined : data.templateLandingPageInstructions,
    previewUrl: data.selectedBuild?.previewUrl,
    route,
  })
  const copyStatus = copyResult?.prompt === prompt ? copyResult.status : null
  const copyPrompt = data.branchSubmissionMode === "copy"

  function branchFromHere() {
    setExpanded(true)
    if (expanded) briefInput.current?.focus()
  }

  function changeMinimized(value: boolean) {
    setLocalMinimized(value)
    onMinimizedChange?.(value)
    iframeRef.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (!expanded && !submission && document.activeElement === document.body) {
      iframeRef.current?.focus({ preventScroll: true })
    }
  }, [expanded, submission, iframeRef])

  let address = data.selectedBuild?.previewUrl ?? ""
  if (address && route) {
    const url = new URL(address)
    url.pathname = route.pathname
    url.search = route.search
    url.hash = route.hash
    address = url.toString()
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!brief.trim()) return

    if (copyPrompt) {
      setCopyResult(null)
      try {
        await navigator.clipboard.writeText(prompt)
        setCopyResult({ prompt, status: "copied" })
      } catch {
        setCopyResult({ prompt, status: "error" })
      }
      return
    }

    if (!data.newPrototypePath) return

    setSubmission(
      createPrototypeSubmission({
        repositoryName: data.repositoryName,
        branchName: data.branchName,
        prompt,
      }),
    )
  }

  return (
    <>
      <div className="review-workspace-layer" data-minimized={minimized}>
        <PrototypeWorkspace
          data={data}
          preview
          onControlsToolbarMount={data.controlsIdentity ? setWorkspaceControlsToolbar : undefined}
          fork={
            copyPrompt || data.newPrototypePath
              ? { label: data.forkLabel, onClick: branchFromHere }
              : undefined
          }
        >
          <div className={`review-page${minimized ? " review-page--minimized" : ""}`}>
            <Stack gap="none" className="review-shell" padding="none">
              {data.selectedBuild ? (
                <PrototypePreview
                  address={viewerUrl ?? address}
                  copy={data}
                  iframeRef={iframeRef}
                  previewUrl={data.selectedBuild.previewUrl}
                  frameTitle={data.selectedBuild.frameTitle}
                  previewTheme={previewTheme}
                  modalOpen={Boolean(submission)}
                  controlsIdentity={data.controlsIdentity}
                  controlsToolbar={workspaceControlsToolbar}
                  minimizedControlsToolbar={controlsToolbar}
                  onLoad={onFrameLoad}
                  minimized={minimized}
                  minimize={{ label: data.minimizeHubLabel, onClick: () => changeMinimized(true) }}
                />
              ) : (
                <div className="review-shell__empty">
                  <HubEmptyState
                    visual={<GlobeIcon size={24} />}
                    heading={data.emptyHeading}
                    description={data.emptyLabel}
                  />
                </div>
              )}
            </Stack>

            {copyPrompt || data.newPrototypePath ? (
              <div className="review-branch-composer">
                <form onSubmit={(event) => void submit(event)}>
                  <PrototypeBriefComposer
                    inputRef={briefInput}
                    variant="branch"
                    expanded={expanded}
                    onExpand={() => setExpanded(true)}
                    onCollapse={() => setExpanded(false)}
                    value={brief}
                    onChange={setBrief}
                    label={data.branchPlaceholder}
                    placeholder={data.branchPlaceholder}
                    submitLabel={data.branchSubmitLabel}
                    branchFrom={data.branchFromLabel}
                  />
                </form>

                {copyPrompt && copyStatus ? (
                  <HubAlert
                    variant={copyStatus === "copied" ? "success" : "critical"}
                    layout="compact"
                    title={
                      copyStatus === "copied"
                        ? data.branchContinuation.copiedLabel
                        : data.branchContinuation.copyErrorLabel
                    }
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </PrototypeWorkspace>
      </div>

      {minimized ? (
        <MinimizedReviewToolbar
          controlsSlotRef={data.controlsIdentity ? setControlsToolbar : undefined}
          maximizeLabel={data.maximizeHubLabel}
          dragLabel={data.dragControlsLabel}
          onMaximize={() => changeMinimized(false)}
        />
      ) : null}

      {submission ? (
        <CopilotAppContinuationDialog
          submission={submission}
          copy={data.branchContinuation}
          onClose={() => {
            setSubmission(null)
            setExpanded(true)
          }}
          onOpenApp={onOpenApp}
        />
      ) : null}
    </>
  )
}
