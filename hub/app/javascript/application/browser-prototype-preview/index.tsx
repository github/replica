import { useCallback, useEffect, useRef, useState } from "react"

import { BrowserPrototypePreviewSurface } from "@features/browser-prototype-preview"
import type { ControlsPanelLayout } from "@components/prototype-controls-panel/types"
import { usePreviewNavigation } from "@hooks/use-canvas-preview-navigation"
import { useControlsConnection } from "@hooks/use-prototype-controls-connection"
import { useLocalPreviewRoute } from "@hooks/use-local-preview-route"
import { MAXIMUM_PREVIEW_URL_LENGTH } from "@hooks/use-local-preview-route/constants"
import { copy } from "@utils/prototype-canvas/en"

import type { BrowserPreviewConfig } from "./types"
import "../prototype-canvas/styles.css"

export function BrowserPrototypePreview({ config }: { config: BrowserPreviewConfig }) {
  const shellRef = useRef<HTMLElement>(null)
  const cancelClick = useRef<(() => void) | null>(null)
  const [layout, setLayout] = useState<ControlsPanelLayout>({
    position: null,
    collapsed: false,
    collapsedGroups: {},
  })
  const [addressError, setAddressError] = useState("")
  const { frameRef, frameKey, source, address, replaceAddress, appearance, reportRoute } =
    usePreviewNavigation({ ...config, shellRef, cancelClick })
  const saveAddress = useCallback((destination: string) => {
    try {
      if (destination.length > MAXIMUM_PREVIEW_URL_LENGTH)
        throw new Error("The prototype address is too long to save.")
      const wrapper = new URL(window.location.href)
      wrapper.searchParams.set("url", destination)
      window.history.replaceState(window.history.state, "", wrapper)
      setAddressError("")
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : copy.controlsLocalStorageFailed
      setAddressError(message)
      throw new Error(message, { cause })
    }
  }, [])
  const replaceBrowserAddress = useCallback(
    (destination: string) => {
      saveAddress(destination)
      replaceAddress(destination)
    },
    [saveAddress, replaceAddress],
  )
  const controls = useControlsConnection({
    ...config,
    frameRef,
    address,
    replaceAddress: replaceBrowserAddress,
  })
  useLocalPreviewRoute({
    frameRef,
    previewUrl: source,
    onRouteChange: reportRoute,
  })
  useEffect(() => {
    let cancelled = false
    void Promise.resolve()
      .then(() => {
        if (!cancelled) saveAddress(address)
      })
      .catch(() => {
        // saveAddress reports persistence failures in Options; keep the preview usable.
      })
    return () => {
      cancelled = true
    }
  }, [address, saveAddress])
  useEffect(() => {
    document.body.classList.remove("renderer-loading")
  }, [])

  return (
    <BrowserPrototypePreviewSurface
      name={config.name}
      source={source}
      frameKey={frameKey}
      frameRef={frameRef}
      shellRef={shellRef}
      appearance={appearance}
      state={
        controls.state && addressError
          ? { ...controls.state, storageError: addressError }
          : controls.state
      }
      connection={controls.connection}
      layout={layout}
      onLayoutChange={setLayout}
    />
  )
}
