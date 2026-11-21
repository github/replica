import { useEffect, useState } from "react"

import type { ReviewRoute } from "@utils/review-anchor/types"
import { controlsUrlEvent } from "@utils/prototype-controls-url/constants"
import { getPreviewBasePath } from "@utils/prototype-controls/preview-base-path.mjs"

export function usePrototypeViewerUrl({
  selectedBuild,
  route,
  initiallyMinimized,
  buildSelection = "preserve",
  initialRoute,
  enabled = true,
}: {
  selectedBuild?: { number: number; previewUrl: string }
  route: ReviewRoute | null
  initiallyMinimized: boolean
  buildSelection?: "preserve" | "ignore"
  initialRoute?: string
  enabled?: boolean
}) {
  const [, refreshUrl] = useState(0)
  useEffect(() => {
    function refresh() {
      refreshUrl((revision) => revision + 1)
    }
    window.addEventListener(controlsUrlEvent, refresh)
    window.addEventListener("popstate", refresh)
    return () => {
      window.removeEventListener(controlsUrlEvent, refresh)
      window.removeEventListener("popstate", refresh)
    }
  }, [])
  const [view, setView] = useState({
    previewUrl: selectedBuild?.previewUrl,
    minimized: initiallyMinimized,
  })
  const minimized =
    Boolean(selectedBuild) &&
    (view.previewUrl === selectedBuild?.previewUrl ? view.minimized : initiallyMinimized)
  const url = new URL(window.location.href)

  if (buildSelection === "ignore") {
    url.searchParams.delete("build")
    url.searchParams.delete("before")
  }

  if (selectedBuild) {
    const preview = new URL(selectedBuild.previewUrl)
    const previousPath =
      buildSelection === "ignore" ||
      !url.searchParams.has("build") ||
      url.searchParams.get("build") === String(selectedBuild.number)
        ? url.searchParams.get("return_path")
        : null
    const destination = route
      ? `${route.pathname}${route.search}${route.hash}`
      : (initialRoute ??
        previousPath ??
        `${preview.pathname.slice(getPreviewBasePath(preview.pathname).length - 1)}${preview.search}${preview.hash}`)
    url.searchParams.set("return_path", destination)
    if (minimized) url.searchParams.set("view", "minimized")
    else url.searchParams.delete("view")
  }

  const viewerUrl = url.toString()
  useEffect(() => {
    if (
      enabled &&
      (selectedBuild || buildSelection === "ignore") &&
      window.location.href !== viewerUrl
    ) {
      window.history.replaceState(window.history.state, "", viewerUrl)
    }
  }, [selectedBuild, buildSelection, viewerUrl, enabled])

  return {
    viewerUrl,
    minimized,
    setMinimized: (value: boolean) =>
      setView({ previewUrl: selectedBuild?.previewUrl, minimized: value }),
  }
}
