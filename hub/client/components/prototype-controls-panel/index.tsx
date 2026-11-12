import {
  ChevronDownIcon,
  ChevronUpIcon,
  GrabberIcon,
  LinkExternalIcon,
  SyncIcon,
} from "@primer/octicons-react"
import { Accordion, Button, InlineLink, Text } from "@primer/react-brand"
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"

import { HubIconButton } from "../hub-icon-button"
import { HubVisuallyHidden } from "../hub-visually-hidden"

import { ControlsFields } from "../prototype-controls-fields"
import type { ControlsConnection, PanelState } from "@utils/prototype-controls-connection"
import { copy } from "@utils/prototype-canvas/en"
import { nonDefaultValues } from "@utils/prototype-controls-url/non-default-values"
import { controlStatus } from "@utils/prototype-control-status"
import type { ControlsPanelLayout } from "./types"
import { usePanelPosition } from "./use-panel-position"
import { panelWidth } from "./panel-width"

import "./styles.css"
import "../prototype-controls-fields/ghost-button.css"

export function ControlsPanel({
  state,
  connection,
  layout,
  onLayoutChange,
  onDiagnose,
  diagnosisTarget = "",
}: {
  state: PanelState
  connection: Pick<ControlsConnection, "command" | "retry" | "resetAll">
  layout: ControlsPanelLayout
  onLayoutChange: Dispatch<SetStateAction<ControlsPanelLayout>>
  onDiagnose?: () => Promise<unknown>
  diagnosisTarget?: string
}) {
  const failures = state.loading
    ? []
    : state.scopes.flatMap((scope) =>
        scope.declaration.controls.flatMap((control) => {
          const status = controlStatus(scope, control)
          return status.visible && status.error ? [{ ...status, label: control.label }] : []
        }),
      )
  const diagnosisAvailable = Boolean(
    onDiagnose &&
    !state.loading &&
    ((!state.runtimeAvailable && state.error) ||
      state.storageError ||
      failures.length ||
      state.reconnectRequired ||
      state.status === "missing-runtime" ||
      state.status === "unsupported-runtime" ||
      state.status === "invalid-config"),
  )
  const episode = diagnosisAvailable
    ? JSON.stringify([
        diagnosisTarget,
        state.status,
        state.runtimeAvailable,
        state.reconnectRequired,
        state.error,
        state.storageError,
        failures.map(({ scope, id, error }) => [scope, id, error]),
      ])
    : ""
  // A recurring failure after recovery is a new episode, even when its evidence matches.
  const [diagnosis, setDiagnosis] = useState(() => ({
    episode,
    identity: {},
    busy: false,
    requested: false,
    error: "",
  }))
  if (diagnosis.episode !== episode)
    setDiagnosis({ episode, identity: {}, busy: false, requested: false, error: "" })
  async function diagnose() {
    if (!onDiagnose || !diagnosisAvailable || diagnosis.busy || diagnosis.requested) return
    const identity = diagnosis.identity
    setDiagnosis((current) =>
      current.identity === identity ? { ...current, busy: true, error: "" } : current,
    )
    try {
      await onDiagnose()
      setDiagnosis((current) =>
        current.identity === identity ? { ...current, requested: true } : current,
      )
    } catch (cause) {
      setDiagnosis((current) =>
        current.identity === identity
          ? {
              ...current,
              error: cause instanceof Error ? cause.message : copy.controlsDiagnosisFailed,
            }
          : current,
      )
    } finally {
      setDiagnosis((current) =>
        current.identity === identity ? { ...current, busy: false } : current,
      )
    }
  }
  const bodyId = useId()
  const moveHintId = useId()
  const lastFocus = useRef<HTMLElement | null>(null)
  const {
    boundsRef,
    panelRef,
    handleRef,
    dragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    onKeyDown,
  } = usePanelPosition(layout.position, (next) =>
    onLayoutChange((previous) => ({ ...previous, position: next })),
  )
  useEffect(() => {
    handleRef.current?.focus()
  }, [handleRef])
  useLayoutEffect(() => {
    if (lastFocus.current && !lastFocus.current.isConnected) {
      if (document.activeElement === document.body) handleRef.current?.focus()
      lastFocus.current = null
    }
  }, [state, handleRef])
  const message = state.loading
    ? copy.controlsConnecting
    : state.status === "no-controls"
      ? copy.controlsEmpty
      : state.status === "missing-runtime"
        ? onDiagnose
          ? copy.controlsLocalMissingRuntime
          : copy.controlsMissingRuntime
        : state.status === "unsupported-runtime"
          ? copy.controlsUnsupportedRuntime
          : state.status === "invalid-config"
            ? copy.controlsInvalid
            : ""
  const retry =
    !state.loading &&
    (state.storageError || state.reconnectRequired || (!state.runtimeAvailable && state.error))
  const empty =
    !state.loading &&
    state.status === "no-controls" &&
    !state.error &&
    !state.storageError &&
    !state.reconnectRequired &&
    !state.scopeErrors?.length &&
    !state.scopes.length
  return (
    <div ref={boundsRef} className="canvas-controls-layer">
      <aside
        ref={panelRef}
        className="canvas-controls-panel"
        aria-label={copy.controls}
        onFocusCapture={(event) => {
          if (event.target instanceof HTMLElement) lastFocus.current = event.target
        }}
        data-collapsed={layout.collapsed}
        data-dragging={dragging || undefined}
        style={{
          left: layout.position?.x,
          top: layout.position?.y,
          width: `min(${panelWidth(state.scopes)}px, calc(100% - var(--hub-space-16) * 2))`,
        }}
      >
        <header className="canvas-controls-header">
          <HubIconButton
            icon={GrabberIcon}
            ref={handleRef}
            size="small"
            variant="invisible"
            className="canvas-controls-grab controls-ghost-button"
            aria-label={copy.controlsMove}
            aria-describedby={moveHintId}
            title=""
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onLostPointerCapture={onLostPointerCapture}
            onKeyDown={onKeyDown}
          />
          <HubVisuallyHidden id={moveHintId}>{copy.controlsMoveHint}</HubVisuallyHidden>
          <Button
            type="button"
            size="small"
            variant="subtle"
            block
            className="canvas-controls-title controls-ghost-button"
            aria-label={layout.collapsed ? copy.controlsExpand : copy.controlsCollapse}
            aria-expanded={!layout.collapsed}
            aria-controls={bodyId}
            trailingVisual={
              layout.collapsed ? <ChevronDownIcon size={16} /> : <ChevronUpIcon size={16} />
            }
            onClick={() =>
              onLayoutChange((previous) => ({ ...previous, collapsed: !previous.collapsed }))
            }
          >
            {copy.controls}
          </Button>
          <HubIconButton
            icon={SyncIcon}
            size="small"
            variant="invisible"
            className="controls-ghost-button"
            aria-label={copy.controlsResetAll}
            disabled={
              !state.runtimeAvailable ||
              state.reconnectRequired ||
              state.loading ||
              state.resetting ||
              (!state.storageError &&
                !state.hasResettableValues &&
                !state.scopes.some((scope) => Object.keys(nonDefaultValues(scope)).length > 0)) ||
              state.scopes.some((scope) =>
                Object.values(scope.snapshot.actions).some((action) => action.busy),
              ) ||
              (state.status !== "ready" && state.status !== "no-controls" && !state.storageError)
            }
            onClick={() => {
              void connection.resetAll()
            }}
          />
        </header>
        <div id={bodyId} className="canvas-controls-body" hidden={layout.collapsed}>
          <div className="canvas-controls-content">
            {message || state.notice ? (
              <div role="status" aria-live="polite">
                <Text as="p" size="100" variant="muted">
                  {[message, state.notice].filter(Boolean).join(" ")}
                </Text>
              </div>
            ) : null}
            {!state.loading && state.error ? (
              <Text as="p" size="100" role="alert">
                {state.error}
              </Text>
            ) : null}
            {!state.loading &&
              state.scopeErrors?.map((issue) => (
                <Text as="p" size="100" role="alert" key={issue.scope}>
                  {copy.controlsScopeError(issue.scope, issue.error)}
                </Text>
              ))}
            {!state.loading && state.storageError ? (
              <Text as="p" size="100" role="alert">
                {state.storageError}
              </Text>
            ) : null}
            {diagnosis.error ? (
              <Text as="p" size="100" role="alert">
                {diagnosis.error}
              </Text>
            ) : null}
            <ControlsFields
              scopes={state.loading ? [] : state.scopes}
              disabled={state.resetting || state.reconnectRequired}
              collapsedGroups={layout.collapsedGroups}
              onGroupCollapse={(scope, group, collapsed) =>
                onLayoutChange((previous) => ({
                  ...previous,
                  collapsedGroups: {
                    ...previous.collapsedGroups,
                    [`${scope}/${group}`]: collapsed,
                  },
                }))
              }
              onCommand={(operation, scope, id, value) =>
                connection.command(operation, scope, id, value)
              }
            />
            {failures.length ? (
              <Accordion className="canvas-controls-diagnostics" disableAnimation>
                <Accordion.Heading>{copy.controlsDiagnostics}</Accordion.Heading>
                <Accordion.Content>
                  {failures.map(({ scope, id, label, error }) => (
                    <Text as="p" size="100" key={`${scope}/${id}`}>
                      {label}: {error}
                    </Text>
                  ))}
                </Accordion.Content>
              </Accordion>
            ) : null}
          </div>
          {diagnosisAvailable || retry || empty ? (
            <footer className="canvas-controls-footer">
              {empty ? (
                <InlineLink
                  className="canvas-controls-learn-more"
                  href="https://github.com/github/replica/blob/main/starter/README.md#prototype-controls"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {copy.controlsLearnMore}
                  <LinkExternalIcon size={16} aria-hidden="true" />
                </InlineLink>
              ) : null}
              {diagnosisAvailable ? (
                <Button
                  size="small"
                  variant="secondary"
                  type="button"
                  disabled={diagnosis.busy || diagnosis.requested || state.resetting}
                  onClick={() => void diagnose()}
                >
                  {diagnosis.requested
                    ? copy.controlsDiagnosisRequested
                    : failures.length
                      ? copy.controlsFix
                      : copy.controlsDiagnose}
                </Button>
              ) : null}
              {retry ? (
                <Button
                  size="small"
                  variant="secondary"
                  type="button"
                  disabled={state.resetting}
                  onClick={() => connection.retry()}
                >
                  {state.storageError ? copy.controlsRetryStorage : copy.controlsRetry}
                </Button>
              ) : null}
            </footer>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
