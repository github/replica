import { useEffect, useEffectEvent } from "react"

import { REVIEW_ROUTE_SCHEMA } from "@utils/review-anchor/schemas"

import type { Props } from "./types"

export function useLocalPreviewRoute({ frameRef, previewUrl, onRouteChange }: Props) {
  const reportRoute = useEffectEvent(onRouteChange)
  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !previewUrl) return
    const origin = new URL(previewUrl).origin
    let nonce = crypto.randomUUID()
    function requestReady() {
      frame?.contentWindow?.postMessage({ type: "replica:canvas:request-ready", nonce }, origin)
    }
    function loaded() {
      nonce = crypto.randomUUID()
      requestReady()
    }
    function receive(event: MessageEvent<unknown>) {
      const data = event.data
      if (
        event.source !== frame?.contentWindow ||
        event.origin !== origin ||
        !data ||
        typeof data !== "object" ||
        !("nonce" in data) ||
        data.nonce !== nonce ||
        !("type" in data) ||
        data.type !== "replica:canvas:ready" ||
        !("protocolVersion" in data) ||
        data.protocolVersion !== 1 ||
        !("route" in data)
      )
        return
      const route = REVIEW_ROUTE_SCHEMA.safeParse(data.route)
      if (route.success)
        reportRoute(route.data, "replaceRoute" in data && data.replaceRoute === true)
    }
    window.addEventListener("message", receive)
    frame.addEventListener("load", loaded)
    requestReady()
    const interval = window.setInterval(requestReady, 1_000)
    return () => {
      window.removeEventListener("message", receive)
      frame.removeEventListener("load", loaded)
      window.clearInterval(interval)
    }
  }, [frameRef, previewUrl])
}
