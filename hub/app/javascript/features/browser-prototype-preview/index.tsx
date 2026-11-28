import { ThemeProvider } from "@primer/react-brand/esm"

import { ControlsPanel } from "@components/prototype-controls-panel"
import { controlStatus } from "@utils/prototype-control-status"
import { copy } from "@utils/prototype-canvas/en"

import type { BrowserPreviewSurfaceProps } from "./types"
import "./styles.css"

export function BrowserPrototypePreviewSurface({
  name,
  source,
  frameKey,
  frameRef,
  shellRef,
  onFrameLoad,
  appearance,
  state,
  connection,
  layout,
  onLayoutChange,
}: BrowserPreviewSurfaceProps) {
  const showOptions =
    state &&
    !state.loading &&
    (state.scopes.some((scope) =>
      scope.declaration.controls.some((control) => controlStatus(scope, control).visible),
    ) ||
      state.error ||
      state.storageError ||
      state.reconnectRequired ||
      state.scopeErrors?.length ||
      (state.status !== "ready" && state.status !== "no-controls"))
  return (
    <ThemeProvider colorMode={appearance} className="canvas-base">
      <main ref={shellRef} className="canvas-shell browser-prototype-preview">
        <iframe
          key={frameKey}
          ref={frameRef}
          src={source}
          title={copy.prototypeFrameTitle(name)}
          className="prototype-frame"
          onLoad={onFrameLoad}
          style={{ colorScheme: appearance }}
        />

        {showOptions && state && connection ? (
          <ControlsPanel
            state={state}
            connection={connection}
            layout={layout}
            onLayoutChange={onLayoutChange}
            autoFocus={false}
          />
        ) : null}
      </main>
    </ThemeProvider>
  )
}
