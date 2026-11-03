import { encodeControlValues } from "../prototype-controls-url/encode-control-values"
import { readControlQuery } from "../prototype-controls-url/read-control-query"
import { withControlQuery } from "../prototype-controls-url/with-control-query"
import type { ControlValues } from "../prototype-controls-url/constants"

export function installControlsUrl(
  onNavigate: (query: string) => void,
  currentValues: () => ControlValues,
  onError: (message: string) => void,
) {
  const push = window.history.pushState.bind(window.history)
  const replace = window.history.replaceState.bind(window.history)
  let initialized = false
  let startupComplete =
    document.readyState === "complete" ||
    (performance.getEntriesByType?.("navigation") ?? []).some(
      (entry) =>
        "domContentLoadedEventStart" in entry &&
        typeof entry.domContentLoadedEventStart === "number" &&
        entry.domContentLoadedEventStart > 0,
    )
  let query = new URLSearchParams(
    [...new URLSearchParams(window.location.search)].filter(([key]) => key.startsWith("rc.")),
  ).toString()
  function effectiveQuery() {
    try {
      const encoded = encodeControlValues({ ...readControlQuery(query).scopes, ...currentValues() })
      onError("")
      return encoded
    } catch (error) {
      onError(error instanceof Error ? error.message : "Controls could not be saved in the URL.")
      return query
    }
  }
  function destination(address: string | URL | null | undefined) {
    if (!initialized || !startupComplete)
      return new URL(String(address ?? window.location.href), window.location.href).toString()

    const url = new URL(withControlQuery(String(address ?? window.location.href), effectiveQuery()))
    url.searchParams.set("rc", "1")
    return url.toString()
  }
  function pushState(data: unknown, unused: string, url?: string | URL | null) {
    push(data, unused, destination(url))
  }
  function replaceState(data: unknown, unused: string, url?: string | URL | null) {
    replace(data, unused, destination(url))
  }
  window.history.pushState = pushState
  window.history.replaceState = replaceState
  function popped(event: Event) {
    if ("replicaControlsBinding" in event && event.replicaControlsBinding === true) return
    query = new URLSearchParams(
      [...new URLSearchParams(window.location.search)].filter(([key]) => key.startsWith("rc.")),
    ).toString()
    onNavigate(query)
  }
  function clicked(event: MouseEvent) {
    if (!initialized || !startupComplete) return
    if (event.defaultPrevented || !(event.target instanceof Element)) return
    const link = event.target.closest("a[href]")
    if (
      !(link instanceof HTMLAnchorElement) ||
      link.hasAttribute("download") ||
      (link.target && link.target !== "_self")
    )
      return
    const url = new URL(link.href)
    if (url.origin === window.location.origin) link.href = destination(url)
  }
  window.addEventListener("popstate", popped)
  window.addEventListener("click", clicked, true)
  function refresh() {
    if (!initialized || !startupComplete) return

    query = effectiveQuery()
    const url = destination(window.location.href)
    if (url !== window.location.href) replace(window.history.state, "", url)
  }
  function started() {
    startupComplete = true
    refresh()
  }
  document.addEventListener("DOMContentLoaded", started, { once: true })
  return {
    set(next: string) {
      const parsed = readControlQuery(next)
      if (parsed.notice) throw new Error(parsed.notice)
      query = encodeControlValues(parsed.scopes)
      initialized = true
      refresh()
    },
    refresh,
    current() {
      return new URLSearchParams(
        [...new URLSearchParams(window.location.search)].filter(([key]) => key.startsWith("rc.")),
      ).toString()
    },
    managed() {
      return new URLSearchParams(window.location.search).get("rc") === "1"
    },
    dispose() {
      if (window.history.pushState === pushState) window.history.pushState = push
      if (window.history.replaceState === replaceState) window.history.replaceState = replace
      window.removeEventListener("popstate", popped)
      window.removeEventListener("click", clicked, true)
      document.removeEventListener("DOMContentLoaded", started)
    },
  }
}
