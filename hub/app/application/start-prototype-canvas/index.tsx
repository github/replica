import { createRoot } from "react-dom/client"

import { App } from "../prototype-canvas"
import type { CanvasConfig } from "@utils/prototype-canvas/types"

declare global {
  interface Window {
    __REPLICA_CANVAS__: CanvasConfig
  }
}

const root = document.querySelector("#root")
if (!root) throw new Error("Replica prototype renderer root is missing.")

createRoot(root).render(<App config={window.__REPLICA_CANVAS__} />)
