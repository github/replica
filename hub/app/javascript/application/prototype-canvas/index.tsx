import { ThemeProvider } from "@primer/react-brand/esm"
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from "react"

import { AppDialogs } from "@features/prototype-canvas-dialogs"
import { BrowserBar } from "@components/prototype-browser-bar"
import { CanvasReviewFeedback } from "@components/canvas-review-feedback"
import { ControlsPanel } from "@components/prototype-controls-panel"
import type { ControlsPanelLayout } from "@components/prototype-controls-panel/types"
import { PrototypeCanvasHubPanel } from "@features/prototype-canvas-hub-panel"
import { copy } from "@utils/prototype-canvas/en"
import { request } from "@utils/prototype-canvas-request"
import { resolveShareReadiness } from "@utils/resolve-prototype-share-readiness"
import { Toolbar } from "@components/prototype-canvas-toolbar"
import type { CanvasConfig } from "@utils/prototype-canvas/types"
import { useCanvasAgent } from "@hooks/use-canvas-agent"
import { useCanvasPublication } from "@hooks/use-canvas-publication"
import { useControlsConnection } from "@hooks/use-prototype-controls-connection"
import { useHubConnection } from "@hooks/use-canvas-hub-connection"
import { useHubStatus } from "@hooks/use-canvas-hub-status"
import { usePreviewNavigation } from "@hooks/use-canvas-preview-navigation"
import { usePrototypeState } from "@hooks/use-canvas-prototype-state"
import { usePublishPreference } from "@hooks/use-canvas-publish-preference"
import { useShareControlSettings } from "@hooks/use-prototype-share-control-settings"
import { useShareIntent } from "@hooks/use-canvas-share-intent"
import { useShareLinks } from "@hooks/use-canvas-share-links"
import { controlsStatus } from "@utils/prototype-controls-status"

import "./styles.css"

type Props = { config: CanvasConfig }

const ImprovementNotesPrototype = lazy(() =>
  import("@features/prototype-canvas-improvement-notes").then((module) => ({
    default: module.ImprovementNotesPrototype,
  })),
)

const PrototypeCanvasThreadSample = lazy(() =>
  import("@features/prototype-canvas-thread-sample").then((module) => ({
    default: module.PrototypeCanvasThreadSample,
  })),
)

/** Composes canvas workflows while preserving the preview across panels and dialogs. */
export function App({ config }: Props) {
  const shellRef = useRef<HTMLElement>(null)
  const toolbarRef = useRef<HTMLElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const publishButtonRef = useRef<HTMLButtonElement>(null)
  const shareButtonRef = useRef<HTMLButtonElement>(null)
  const hubButtonRef = useRef<HTMLButtonElement>(null)
  const connectionButtonRef = useRef<HTMLButtonElement>(null)
  const titleButtonRef = useRef<HTMLButtonElement>(null)
  const controlsButtonRef = useRef<HTMLButtonElement>(null)
  const cancelClick = useRef<(() => void) | null>(null)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [controlsLayout, setControlsLayout] = useState<ControlsPanelLayout>({
    position: null,
    collapsed: false,
    collapsedGroups: {},
  })
  const [hubOpen, setHubOpen] = useState(false)
  const [reviewSurface, setReviewSurface] = useState<"comments" | "improvements">(
    config.pickAndPolish ? "improvements" : "comments",
  )
  const [commentInteraction, setCommentInteraction] = useState(false)
  const [improvementInteraction, setImprovementInteraction] = useState(false)
  const [improvementControls, setImprovementControls] = useState<HTMLDivElement | null>(null)
  const [buildDetailsOpen, setBuildDetailsOpen] = useState(false)
  const feedbackInFlight = useRef(false)
  const [improvingContext, setImprovingContext] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState<{
    target: string
    message: string
  } | null>(null)
  const closeHub = useCallback(() => {
    setHubOpen(false)
    hubButtonRef.current?.focus()
  }, [])
  const {
    frameRef,
    frameKey,
    source,
    navigation,
    address,
    replaceAddress,
    appearance,
    setAppearance,
    liveRoute,
    initialize,
    reportRoute,
    reload,
    navigate,
    travel,
  } = usePreviewNavigation({
    prototypeUrl: config.prototypeUrl,
    previewUrl: config.previewUrl,
    shellRef,
    cancelClick,
  })
  const controls = useControlsConnection({ ...config, frameRef, address, replaceAddress })
  const controlsState = controls.state
  useCanvasAgent({
    ...config,
    frameRef,
    addressRef,
    appearance,
    navigation,
    liveRoute,
    cancelClick,
    reload,
    controlsConnection: controls.connection,
  })
  const { state, error, setError, refresh } = usePrototypeState(config.token)
  const hub = useHubStatus({
    token: config.token,
    onStatus: initialize,
    onError: setError,
  })
  const connection = useHubConnection({
    token: config.token,
    status: hub.status,
    onStatusChange: hub.refresh,
    onSelectHub: hub.select,
  })
  const feedbackTarget = JSON.stringify([
    hub.status?.hubOrigin,
    hub.status?.repository,
    hub.status?.branch,
  ])
  const canReviewFeedback =
    hub.status?.repositoryAuthorized === true &&
    (hub.status.state === "connected" || hub.status.state === "undiscovered") &&
    Boolean(hub.status.repository && hub.status.branch && hub.status.hubOrigin)
  const sharing = useShareLinks({
    token: config.token,
    hubStatus: hub.status,
    prototypeState: state,
  })
  const shareIntent = useShareIntent({ token: config.token, state, hubStatus: hub.status })
  const publishPreference = usePublishPreference({
    token: config.token,
    enabled:
      hubOpen &&
      hub.status?.state === "connected" &&
      hub.status.prototype?.registered === true &&
      Boolean(hub.status.prototype.build) &&
      hub.status.repository === state?.stats.repository &&
      hub.status.branch === state?.stats.branch,
    repository: state?.stats.repository,
    branch: state?.stats.branch,
    commitSha: state?.stats.commitSha,
    publicationRevision: state?.publishRequest?.requestedAt,
  })
  const publication = useCanvasPublication({
    token: config.token,
    state,
    hubStatus: hub.status,
    error,
    setError,
    refresh,
    refreshHub: hub.refresh,
    preferenceSaving: publishPreference.saving,
  })
  const readiness = resolveShareReadiness(state, hub.status, publication.publication)
  const shareContext = sharing.state.context
  const shareControlSettings = useShareControlSettings(
    shareContext
      ? `${shareContext.hubOrigin}:${shareContext.prototype.repositoryId}:${shareContext.prototype.id}`
      : undefined,
    controls.connection?.getControlValues() ?? {},
    {
      included: shareContext?.controlSettingsIncluded ?? false,
      error: shareContext?.controlSettingsError,
      revision: shareContext?.target,
      onChange: sharing.setControlPreference,
    },
  )

  useLayoutEffect(() => {
    document.body.classList.remove("renderer-loading")
    const shell = shellRef.current
    const toolbar = toolbarRef.current
    if (!shell || !toolbar) return

    function updateToolbarHeight() {
      const height = toolbar?.getBoundingClientRect().height
      if (height) shell?.style.setProperty("--canvas-toolbar-height", `${height}px`)
    }
    const observer = new ResizeObserver(updateToolbarHeight)
    observer.observe(toolbar)
    updateToolbarHeight()
    return () => observer.disconnect()
  }, [])

  function handleShare() {
    connection.close()
    if (readiness.kind === "ready") {
      void sharing.open()
      return
    }

    shareIntent.begin()
  }

  async function handleImproveContext() {
    if (!canReviewFeedback || feedbackInFlight.current) return

    feedbackInFlight.current = true
    setImprovingContext(true)
    setFeedbackMessage(null)
    try {
      const result = await request<{ requested: boolean }>(
        "/api/hub/feedback-review",
        config.token,
        {
          method: "POST",
          body: JSON.stringify({
            repository: hub.status?.repository,
            branch: hub.status?.branch,
            hubOrigin: hub.status?.hubOrigin,
          }),
        },
      )
      if (result.requested !== true) throw new Error(copy.invalidResponse)
    } catch (cause) {
      setFeedbackMessage({
        target: feedbackTarget,
        message: copy.feedbackReviewFailed(cause instanceof Error ? cause.message : String(cause)),
      })
      await hub.refresh()
    } finally {
      feedbackInFlight.current = false
      setImprovingContext(false)
    }
  }

  return (
    <ThemeProvider colorMode={appearance} className="canvas-base">
      <main
        ref={shellRef}
        className={`canvas-shell${sharing.state.open ? " canvas-shell--inactive" : ""}`}
        inert={sharing.state.open}
        aria-hidden={sharing.state.open ? true : undefined}
      >
        <CanvasReviewFeedback>
          <BrowserBar
            address={address}
            addressRef={addressRef}
            canGoBack={navigation.index > 0}
            canGoForward={navigation.index < navigation.entries.length - 1}
            appearance={appearance}
            onAppearanceChange={setAppearance}
            onBack={() => travel(navigation.index - 1)}
            onForward={() => travel(navigation.index + 1)}
            onNavigate={navigate}
            onOpenTab={async () => {
              await request("/api/prototype/open", config.token, {
                method: "POST",
                body: JSON.stringify({ url: address }),
              })
            }}
            onReload={reload}
          />

          <Toolbar
            toolbarRef={toolbarRef}
            improvementControlsRef={setImprovementControls}
            config={config}
            state={publication.presentedState}
            prototypeName={
              hub.status?.state === "connected"
                ? hub.status.prototype?.name || undefined
                : undefined
            }
            publishing={publication.busy}
            publication={publication.publication}
            publishButtonRef={publishButtonRef}
            hubButtonRef={hubButtonRef}
            titleButtonRef={titleButtonRef}
            onBuildDetails={() => setBuildDetailsOpen(true)}
            controlsButtonRef={controlsButtonRef}
            controlsOpen={controlsOpen}
            onControls={() => setControlsOpen(!controlsOpen)}
            onPublish={() => void publication.publish()}
            onShare={handleShare}
            onImproveContext={canReviewFeedback ? () => void handleImproveContext() : undefined}
            improvingContext={improvingContext}
            feedbackMessage={
              feedbackMessage?.target === feedbackTarget ? feedbackMessage : undefined
            }
            shareButtonRef={shareButtonRef}
            hubOpen={hubOpen}
            onHub={() => {
              setHubOpen(!hubOpen)
              void hub.refresh("interaction")
            }}
          />

          <iframe
            key={frameKey}
            ref={frameRef}
            className="prototype-frame"
            title={copy.prototypeFrameTitle(config.name)}
            src={source}
            style={{
              colorScheme: appearance,
              backgroundColor: "var(--hub-canvas-default)",
            }}
          />

          <PrototypeCanvasHubPanel
            config={config}
            active={reviewSurface === "comments"}
            onActivate={() => setReviewSurface("comments")}
            selectionDisabled={improvementInteraction}
            onInteractionChange={setCommentInteraction}
            frameRef={frameRef}
            onRouteChange={reportRoute}
            status={hub.status}
            onStatusChange={hub.refresh}
            onSelectHub={hub.select}
            onConnect={connection.showAndConnect}
            onDisconnected={connection.show}
            connectionButtonRef={connectionButtonRef}
            connecting={connection.connecting}
            publication={publication.publication}
            publicationBusy={publication.busy}
            dirty={state?.stats.workingTree === "changed"}
            onPublish={() => void publication.publish()}
            onRetryPublication={() => void publication.retry()}
            publishPreference={publishPreference}
            open={hubOpen}
            onClose={closeHub}
          />

          {config.improvementThreadsSample ? (
            <Suspense fallback={<p role="status">{copy.improvementNotesLoading}</p>}>
              <PrototypeCanvasThreadSample />
            </Suspense>
          ) : config.pickAndPolish ? (
            <Suspense
              fallback={
                <p className="visually-hidden" role="status">
                  {copy.improvementNotesLoading}
                </p>
              }
            >
              <ImprovementNotesPrototype
                canvas={{
                  token: config.token,
                  frameRef,
                  toolbarTarget: improvementControls,
                  prototypeUrl: config.prototypeUrl,
                  previewUrl: config.previewUrl,
                  hubOpen,
                  active: reviewSurface === "improvements",
                  selectionDisabled: commentInteraction,
                  onInteractionChange: setImprovementInteraction,
                  onOpenNotes: () => {
                    setHubOpen(false)
                    setReviewSurface("improvements")
                  },
                  onNavigate: navigate,
                }}
              />
            </Suspense>
          ) : null}

          {controlsOpen && controls.connection && controlsState ? (
            <ControlsPanel
              state={controlsState}
              connection={controls.connection}
              layout={controlsLayout}
              onLayoutChange={setControlsLayout}
              diagnosisTarget={address}
              onDiagnose={() =>
                request("/api/controls/diagnose", config.token, {
                  method: "POST",
                  body: JSON.stringify({
                    status: controlsState.status,
                    runtimeAvailable: controlsState.runtimeAvailable,
                    reconnectRequired: controlsState.reconnectRequired === true,
                    hasError:
                      Boolean(controlsState.error) ||
                      controlsStatus(controlsState, controlsState.loading, address).controls.some(
                        (control) => control.visible && Boolean(control.error),
                      ),
                    hasStorageError: Boolean(controlsState.storageError),
                    previewUrl: address,
                  }),
                })
              }
            />
          ) : null}
        </CanvasReviewFeedback>
      </main>

      <div role="status" aria-live="polite" className="visually-hidden">
        {error || publication.notice}
      </div>

      <AppDialogs
        hub={hub}
        connection={connection}
        publication={publication}
        sharing={sharing}
        shareIntent={shareIntent}
        controlSettings={shareControlSettings}
        readiness={readiness}
        state={state}
        hubOpen={hubOpen}
        buildDetailsOpen={buildDetailsOpen}
        onCloseBuildDetails={() => setBuildDetailsOpen(false)}
        shareButtonRef={shareButtonRef}
        hubButtonRef={hubButtonRef}
        connectionButtonRef={connectionButtonRef}
        publishButtonRef={publishButtonRef}
        titleButtonRef={titleButtonRef}
      />
    </ThemeProvider>
  )
}
