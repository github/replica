import { createRef, useCallback, useEffect, useRef, useState, type RefObject } from "react"

import { copy } from "@utils/prototype-canvas/en"
import type { HubStatus } from "@utils/prototype-canvas/types"
import type { PendingPreviewClick, PreviewNavigation, PreviewRoute } from "./types"

type Props = {
  prototypeUrl: string
  previewUrl?: string
  shellRef: RefObject<HTMLElement | null>
  cancelClick: PendingPreviewClick
}

/** Keeps iframe identity and browser history stable across unrelated canvas updates. */
export function usePreviewNavigation({ prototypeUrl, previewUrl, shellRef, cancelClick }: Props) {
  const [{ key: frameKey, ref: frameRef }, setPreviewFrame] = useState(() => ({
    key: 0,
    ref: createRef<HTMLIFrameElement>(),
  }))
  const [preview, setPreview] = useState({ input: prototypeUrl, url: prototypeUrl })
  const [navigation, setNavigation] = useState<PreviewNavigation>({
    input: prototypeUrl,
    entries: [prototypeUrl],
    index: 0,
  })
  const [appearance, setAppearance] = useState<"light" | "dark">(() =>
    window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light",
  )
  const [liveRoute, setLiveRoute] = useState<PreviewRoute | null>(null)
  const initialized = useRef<string | null>(null)
  const currentNavigation =
    navigation.input === prototypeUrl
      ? navigation
      : { input: prototypeUrl, entries: [prototypeUrl], index: 0 }
  const address = currentNavigation.entries[currentNavigation.index]!
  const cancelPendingClick = useCallback(() => cancelClick.current?.(), [cancelClick])
  const replaceAddress = useCallback(
    (address: string) => {
      if (new URL(address).origin !== new URL(prototypeUrl).origin)
        throw new Error(copy.startPageOrigin)
      setNavigation((current) => {
        const entries = [...current.entries]
        entries[current.index] = address
        return { ...current, entries }
      })
    },
    [prototypeUrl],
  )

  const initialize = useCallback(
    (status: HubStatus) => {
      if (initialized.current === prototypeUrl) return
      initialized.current = prototypeUrl
      const url = new URL(prototypeUrl)
      const ownsStartPage =
        status.state === "connected" &&
        (status.prototype?.startPageSet ?? status.prototype?.startPage !== undefined)
      const startPage = ownsStartPage ? status.prototype?.startPage : status.localStartPage
      if (url.pathname !== "/" || url.search || url.hash || !startPage) return

      const destination = new URL(startPage, url)
      if (destination.origin !== url.origin) throw new Error(copy.startPageOrigin)

      setPreview({ input: prototypeUrl, url: destination.href })
      setNavigation({ input: prototypeUrl, entries: [destination.href], index: 0 })
    },
    [prototypeUrl],
  )

  function reload() {
    cancelPendingClick()
    setLiveRoute(null)
    setPreview({ input: prototypeUrl, url: address })
    setPreviewFrame((current) => ({
      key: current.key + 1,
      ref: createRef<HTMLIFrameElement>(),
    }))
  }

  function navigate(url: string) {
    if (url === address) {
      reload()
      return
    }

    setNavigation((current) => {
      const history = current.input === prototypeUrl ? current : currentNavigation
      return {
        ...history,
        entries: [...history.entries.slice(0, history.index + 1), url],
        index: history.index + 1,
      }
    })
    setPreview({ input: prototypeUrl, url })
  }

  function travel(index: number) {
    const url = currentNavigation.entries[index]
    if (!url) return

    setNavigation({ ...currentNavigation, index })
    setPreview({ input: prototypeUrl, url })
  }

  const reportRoute = useCallback(
    (route: PreviewRoute, replace = false) => {
      setLiveRoute(route)
      const url = new URL(prototypeUrl)
      url.pathname = route.pathname
      url.search = route.search
      url.hash = route.hash
      setNavigation((current) => {
        const history =
          current.input === prototypeUrl
            ? current
            : { input: prototypeUrl, entries: [prototypeUrl], index: 0 }
        const previous = new URL(history.entries[history.index]!)
        const overrides = [...previous.searchParams].filter(([key]) => key.startsWith("rc."))
        for (const address of [url, previous]) {
          for (const key of [...address.searchParams.keys()]) {
            if (key === "rc" || key.startsWith("rc.")) address.searchParams.delete(key)
          }
        }
        if (
          previous.pathname === url.pathname &&
          previous.searchParams.toString() === url.searchParams.toString() &&
          previous.hash === url.hash
        )
          return history
        for (const [key, value] of overrides) url.searchParams.append(key, value)
        const destination = url.href
        if (replace) {
          const entries = [...history.entries]
          entries[history.index] = destination
          return { ...history, entries }
        }

        return {
          ...history,
          entries: [...history.entries.slice(0, history.index + 1), destination],
          index: history.index + 1,
        }
      })
    },
    [prototypeUrl],
  )

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    function onLoad() {
      cancelPendingClick()
      setLiveRoute(null)
    }
    frame.addEventListener("load", onLoad)
    return () => {
      cancelPendingClick()
      frame.removeEventListener("load", onLoad)
    }
  }, [cancelPendingClick, frameRef])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const origin = new URL(previewUrl ?? prototypeUrl).origin
    const nonce = crypto.randomUUID()
    function sendTheme() {
      const theme = shellRef.current?.closest(".canvas-base")
      if (!theme) return

      frame?.contentWindow?.postMessage(
        {
          type: "replica:canvas:theme",
          nonce,
          accent: window.getComputedStyle(theme).getPropertyValue("--hub-accent").trim(),
        },
        origin,
      )
    }
    function receive(event: MessageEvent<{ type?: unknown } | null>) {
      if (
        event.source === frame?.contentWindow &&
        event.origin === origin &&
        event.data?.type === "replica:canvas:ready"
      )
        sendTheme()
    }
    frame.addEventListener("load", sendTheme)
    window.addEventListener("message", receive)
    sendTheme()
    return () => {
      frame.removeEventListener("load", sendTheme)
      window.removeEventListener("message", receive)
    }
  }, [appearance, prototypeUrl, previewUrl, frameRef, shellRef])

  const source = new URL(preview.input === prototypeUrl ? preview.url : prototypeUrl)
  if (previewUrl) {
    const proxy = new URL(previewUrl)
    source.protocol = proxy.protocol
    source.host = proxy.host
  }

  return {
    frameRef,
    frameKey,
    source: source.href,
    navigation: currentNavigation,
    address,
    replaceAddress,
    appearance,
    setAppearance,
    liveRoute,
    initialize,
    reportRoute,
    reload,
    navigate,
    travel,
  }
}
