import { useRef } from "react"

import { HubAlert } from "@components/hub-alert"
import { HubEmptyState } from "@components/hub-empty-state"
import { BuildControls } from "@features/build-controls"

import type { SharedBuildsShowPageData } from "./types"

import "./styles.css"

/** Shows one shared Build without exposing private Hub navigation. */
export function SharedBuildsShowPage({ data }: { data: SharedBuildsShowPageData }) {
  const frame = useRef<HTMLIFrameElement>(null)
  return (
    <main className="shared-build" data-notice={Boolean(data.mockNotice)}>
      {data.mockNotice ? <HubAlert title={data.mockNotice} variant="warning" /> : null}
      {data.unavailable ? (
        <div className="shared-build__unavailable">
          <HubEmptyState
            heading={data.unavailable.heading}
            description={data.unavailable.description}
          />
        </div>
      ) : (
        <div className="shared-build__viewport">
          <iframe
            ref={frame}
            src={data.previewUrl}
            title={data.frameTitle}
            sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
            className="shared-build__frame"
          />
          {data.controlsIdentity && data.controlsOrigin ? (
            <BuildControls
              key={data.controlsIdentity}
              identity={data.controlsIdentity}
              origin={data.controlsOrigin}
              iframeRef={frame}
              toolbar={null}
            />
          ) : null}
        </div>
      )}
    </main>
  )
}
