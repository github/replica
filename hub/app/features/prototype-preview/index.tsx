import { LinkExternalIcon, ScreenFullIcon } from "@primer/octicons-react"

import { CopyableTextInput } from "@components/copyable-text-input"
import { HubIconButton } from "@components/hub-icon-button"
import { getPreviewFrameUrl } from "@utils/get-preview-frame-url"
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
  minimized = false,
  minimize,
  controlsIdentity,
  controlsToolbar,
  minimizedControlsToolbar,
}: PrototypePreviewProps) {
  return (
    <div className={`review-shell__preview${minimized ? " review-shell__preview--minimized" : ""}`}>
      <div className="review-shell__address-bar">
        <CopyableTextInput
          compact
          value={address}
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
          tabIndex={modalOpen ? -1 : undefined}
          style={{ colorScheme: previewTheme }}
          onLoad={onLoad}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") {
              event.currentTarget.focus({ preventScroll: true })
            }
          }}
        />

        {children}
        {controlsIdentity ? (
          <BuildControls
            key={controlsIdentity}
            identity={controlsIdentity}
            origin={new URL(previewUrl, window.location.href).origin}
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
