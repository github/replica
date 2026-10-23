import { getPrototypeState } from "../get-prototype-state/index.mjs"
import type { CanvasContext } from "../create-canvas-context/index.mjs"

export async function refreshPrototypeStatus(context: CanvasContext) {
  return getPrototypeState(context, { refresh: true })
}
