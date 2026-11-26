import { ThemeProvider } from "@primer/react-brand/esm"

import { ControlsPanel } from "@components/prototype-controls-panel"
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

        {state && connection ? (
          <ControlsPanel
            state={state}
            connection={connection}
            layout={layout}
            onLayoutChange={onLayoutChange}
          />
        ) : null}
      </main>
    </ThemeProvider>
  )
}
