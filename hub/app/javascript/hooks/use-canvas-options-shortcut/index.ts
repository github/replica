import { useEffect, useEffectEvent } from "react"

import { isAnnotationShortcut } from "@utils/is-annotation-shortcut"

import type { Props } from "./types"

export function useCanvasOptionsShortcut({
  frameRef,
  prototypeUrl,
  previewUrl,
  enabled,
  onToggle,
}: Props) {
  const toggle = useEffectEvent(() => {
    if (!enabled || document.querySelector('[role="dialog"], dialog[open], [role="menu"]'))
      return false
    onToggle()
    return true
  })

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (isAnnotationShortcut(event, "o") && toggle()) event.preventDefault()
    }
    window.addEventListener("keydown", keydown)
    return () => window.removeEventListener("keydown", keydown)
  }, [])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !prototypeUrl) return
    const origin = new URL(previewUrl ?? prototypeUrl).origin
    let nonce = crypto.randomUUID()
    let ready = false
    function requestReady() {
      frame?.contentWindow?.postMessage(
        { type: "replica:canvas:request-ready", nonce, optionsShortcut: enabled },
        origin,
      )
    }
    function loaded() {
      nonce = crypto.randomUUID()
      ready = false
      requestReady()
    }
    function receive(event: MessageEvent<unknown>) {
      const data = event.data
      if (
        event.source !== frame?.contentWindow ||
        event.origin !== origin ||
        typeof data !== "object" ||
        data === null ||
        !("nonce" in data) ||
        data.nonce !== nonce ||
        !("type" in data)
      )
        return
      if (data.type === "replica:canvas:ready") {
        ready = "protocolVersion" in data && data.protocolVersion === 1
      } else if (
        data.type === "replica:canvas:options-shortcut" &&
        ready &&
        document.activeElement === frame &&
        navigator.userActivation?.isActive === true
      ) {
        toggle()
      }
    }
    window.addEventListener("message", receive)
    frame.addEventListener("load", loaded)
    requestReady()
    const interval = window.setInterval(requestReady, 2_000)
    return () => {
      window.removeEventListener("message", receive)
      frame.removeEventListener("load", loaded)
      window.clearInterval(interval)
      frame.contentWindow?.postMessage(
        { type: "replica:canvas:request-ready", nonce, optionsShortcut: false },
        origin,
      )
    }
  }, [enabled, frameRef, prototypeUrl, previewUrl])
}
