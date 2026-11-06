import { SlidersIcon } from "@primer/octicons-react"
import { useEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"

import { HubIconButton } from "@components/hub-icon-button"

import { ControlsConnection, type PanelState } from "@utils/prototype-controls-connection"
import { ControlsPanel } from "@components/prototype-controls-panel"
import type { ControlsPanelLayout } from "@components/prototype-controls-panel/types"
import { copy } from "@utils/prototype-canvas/en"
import { urlControlsStorage } from "@utils/prototype-controls-url/storage"

import "./styles.css"

export function BuildControls({
  iframeRef,
  identity,
  origin,
  toolbar,
  hidden = false,
  frameVersion,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>
  identity: string
  origin: string
  toolbar: HTMLElement | null
  hidden?: boolean
  frameVersion?: string
}) {
  const [open, setOpen] = useState(false)
  const [layout, setLayout] = useState<ControlsPanelLayout>({
    position: null,
    collapsed: false,
    collapsedGroups: {},
  })
  const [active, setActive] = useState<{
    connection: ControlsConnection
    state: PanelState
  } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const frame = iframeRef.current
    if (!frame) return
    const connection = new ControlsConnection(frame, origin, urlControlsStorage(identity), "build")
    const release = connection.subscribe(() =>
      setActive({ connection, state: connection.getSnapshot() }),
    )
    connection.start()
    window.addEventListener("popstate", connection.start)
    return () => {
      window.removeEventListener("popstate", connection.start)
      release()
      connection.stop()
    }
  }, [iframeRef, identity, origin, frameVersion])
  const toggle = (
    <HubIconButton
      icon={SlidersIcon}
      aria-label={copy.controls}
      description={copy.controls}
      aria-expanded={open}
      ref={button}
      onClick={() => {
        if (open) button.current?.focus()
        setOpen(!open)
      }}
    />
  )
  return (
    <>
      {toolbar ? (
        createPortal(toggle, toolbar)
      ) : (
        <div
          className="build-controls-floating-toolbar"
          role="toolbar"
          aria-label={copy.controlsRegion}
          hidden={hidden}
        >
          {toggle}
        </div>
      )}
      {open && active && !hidden ? (
        <ControlsPanel
          state={active.state}
          connection={active.connection}
          layout={layout}
          onLayoutChange={setLayout}
        />
      ) : null}
    </>
  )
}
