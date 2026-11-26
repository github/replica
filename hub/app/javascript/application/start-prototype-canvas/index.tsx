import { createRoot } from "react-dom/client"

import { App } from "../prototype-canvas"
import { BrowserPrototypePreview } from "../browser-prototype-preview"
import type { BrowserPreviewConfig } from "../browser-prototype-preview/types"
import type { CanvasConfig } from "@utils/prototype-canvas/types"

declare global {
  interface Window {
    __REPLICA_CANVAS__: CanvasConfig | BrowserPreviewConfig
  }
}

const root = document.querySelector("#root")
if (!root) throw new Error("Replica prototype renderer root is missing.")

const config = window.__REPLICA_CANVAS__
createRoot(root).render(
  "surface" in config ? <BrowserPrototypePreview config={config} /> : <App config={config} />,
)
