import viewports from "./viewports.json"

export const screenshotViewportStyles = {
  desktop: { aspectRatio: `${viewports.desktop.width} / ${viewports.desktop.height}` },
  narrow: { aspectRatio: `${viewports.narrow.width} / ${viewports.narrow.height}` },
}
