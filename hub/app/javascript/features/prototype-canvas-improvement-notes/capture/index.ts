import type { Rect } from "../types"

export function capturePreview(svg: SVGSVGElement, rect: Rect): string {
  const snapshot = svg.cloneNode(true)
  if (!(snapshot instanceof SVGSVGElement))
    throw new Error("The demo preview could not be captured.")
  snapshot.setAttribute("viewBox", `${rect.x} ${rect.y} ${rect.width} ${rect.height}`)
  snapshot.setAttribute("width", String(rect.width))
  snapshot.setAttribute("height", String(rect.height))
  snapshot.removeAttribute("class")
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(snapshot))}`
}
