import { LinkExternalIcon, ScreenFullIcon } from "@primer/octicons-react"
import { useEffect, useState } from "react"

import { CopyableTextInput } from "@components/copyable-text-input"
import { HubIconButton } from "@components/hub-icon-button"
import { getPreviewFrameUrl } from "@utils/get-preview-frame-url"
import { getUrlOrigin } from "@utils/get-url-origin"
import { BuildControls } from "@features/build-controls"

import type { PrototypePreviewProps } from "./types"

import "./styles.css"

export function PrototypePreview({
  address,
  externalAddress = address,
  children,
  copy,
  iframeRef,
  previewUrl,
  frameTitle,
  previewTheme,
  modalOpen = false,
  onLoad,
  ready,
  fallback,
  minimized = false,
  minimize,
  controlsIdentity,
  controlsToolbar,
  minimizedControlsToolbar,
}: PrototypePreviewProps) {
  const [expired, setExpired] = useState<{ url: string | undefined } | null>(null)
  if (expired && (ready !== false || expired.url !== previewUrl)) setExpired(null)

  useEffect(() => {
    if (ready !== false) return

    const timer = window.setTimeout(() => setExpired({ url: previewUrl }), 8000)
    return () => window.clearTimeout(timer)
  }, [ready, previewUrl])
  const unavailable =
    ready === false && expired !== null && expired.url === previewUrl && Boolean(fallback)

  return (
    <div className={`review-shell__preview${minimized ? " review-shell__preview--minimized" : ""}`}>
      <div className="review-shell__address-bar">
        <CopyableTextInput
          compact
          value={address}
          copyValue={externalAddress}
          label={copy.previewUrlLabel}
          copyLabel={copy.copyPreviewUrlLabel}
          copiedLabel={copy.copiedPreviewUrlLabel}
          copyErrorLabel={copy.copyPreviewUrlErrorLabel}
        />

        {minimize ? (
          <HubIconButton
            icon={ScreenFullIcon}
            aria-label={minimize.label}
            description={minimize.label}
            onClick={minimize.onClick}
            variant="invisible"
            size="small"
            className="review-shell__open-preview"
          />
        ) : copy.openInNewTabLabel ? (
          <HubIconButton
            as="a"
            href={externalAddress}
            target="_blank"
            rel="noopener noreferrer"
            icon={LinkExternalIcon}
            aria-label={copy.openInNewTabLabel}
            description={copy.openInNewTabLabel}
            variant="invisible"
            size="small"
            className="review-shell__open-preview"
          />
        ) : null}
      </div>

      <div className="review-shell__viewport">
        <iframe
          key={previewUrl}
          ref={iframeRef}
          src={getPreviewFrameUrl(previewUrl)}
          title={frameTitle}
          sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
          className="review-shell__frame"
          hidden={unavailable}
          tabIndex={modalOpen || unavailable ? -1 : undefined}
          style={{ colorScheme: previewTheme }}
          onLoad={onLoad}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") {
              event.currentTarget.focus({ preventScroll: true })
            }
          }}
        />

        {unavailable ? fallback : null}
        {children}
        {controlsIdentity && !unavailable ? (
          <BuildControls
            key={controlsIdentity}
            identity={controlsIdentity}
            origin={getUrlOrigin(previewUrl) ?? window.location.origin}
            iframeRef={iframeRef}
            frameVersion={previewUrl}
            toolbar={minimized ? (minimizedControlsToolbar ?? null) : (controlsToolbar ?? null)}
            hidden={modalOpen}
          />
        ) : null}
      </div>
    </div>
  )
}
