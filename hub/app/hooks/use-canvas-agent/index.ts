import { useEffect, useLayoutEffect, useRef, type RefObject } from "react"

import { request } from "@utils/prototype-canvas-request"
import { controlsStatus } from "@utils/prototype-controls-status"
import type { ControlsConnection, PanelState } from "@utils/prototype-controls-connection"
import type {
  PendingPreviewClick,
  PreviewNavigation,
  PreviewRoute,
} from "../use-canvas-preview-navigation/types"
import { agentCopy } from "./en"

type Props = {
  token: string
  prototypeUrl: string
  previewUrl?: string
  frameRef: RefObject<HTMLIFrameElement | null>
  addressRef: RefObject<HTMLInputElement | null>
  appearance: "light" | "dark"
  navigation: PreviewNavigation
  liveRoute: PreviewRoute | null
  cancelClick: PendingPreviewClick
  reload: () => void
  controlsConnection?: Pick<ControlsConnection, "getSnapshot" | "subscribe"> | null
}

/** Keeps dequeued actions alive across frame replacements without replaying clicks. */
export function useCanvasAgent(props: Props) {
  const { token, prototypeUrl, previewUrl, cancelClick } = props
  const liveState = useRef(props)
  const rendererId = useRef<string | null>(null)
  useLayoutEffect(() => {
    liveState.current = props
  })

  useEffect(() => {
    rendererId.current ??= crypto.randomUUID()
    const headers = { "X-Replica-Renderer-Id": rendererId.current }
    let busy = false
    let stopped = false
    const requests = new AbortController()
    const origin = new URL(previewUrl ?? prototypeUrl).origin

    async function click(input: { selector: string; expectedLabel: string; route: PreviewRoute }) {
      const frame = liveState.current.frameRef.current
      const activeRoute = liveState.current.liveRoute
      if (!frame?.contentWindow || !activeRoute) throw new Error(agentCopy.bridgeUnavailable)
      if (
        input.route.pathname !== activeRoute.pathname ||
        input.route.search !== activeRoute.search ||
        input.route.hash !== activeRoute.hash
      )
        throw new Error(agentCopy.routeChanged)

      const nonce = crypto.randomUUID()
      return await new Promise<{ clicked: true; route: PreviewRoute }>((resolve, reject) => {
        function cleanup() {
          window.clearTimeout(timeout)
          window.removeEventListener("message", receive)
          if (cancelClick.current === cancel) cancelClick.current = null
        }
        function cancel() {
          cleanup()
          reject(new Error(agentCopy.reloaded))
        }
        const timeout = window.setTimeout(() => {
          cleanup()
          reject(new Error(agentCopy.unconfirmed))
        }, 2_000)
        function receive(event: MessageEvent) {
          const data: unknown = event.data
          if (
            event.source !== frame?.contentWindow ||
            event.origin !== origin ||
            !data ||
            typeof data !== "object" ||
            !("type" in data) ||
            data.type !== "replica:canvas:click-result" ||
            !("nonce" in data) ||
            data.nonce !== nonce
          )
            return

          cleanup()
          if ("clicked" in data && data.clicked === true)
            resolve({ clicked: true, route: input.route })
          else reject(new Error(agentCopy.clickFailed))
        }
        cancelClick.current = cancel
        window.addEventListener("message", receive)
        frame.contentWindow!.postMessage({ type: "replica:canvas:click", nonce, ...input }, origin)
      })
    }

    async function readControlsStatus(timeoutMs: number) {
      const frame = liveState.current.frameRef.current
      const nonce = crypto.randomUUID()
      const deadline = Date.now() + timeoutMs
      const result = await new Promise<unknown>((resolve, reject) => {
        function cleanup() {
          window.clearTimeout(timer)
          window.removeEventListener("message", receive)
          frame?.removeEventListener("load", send)
          requests.signal.removeEventListener("abort", cancel)
        }
        function cancel() {
          cleanup()
          reject(new Error(agentCopy.statusInterrupted))
        }
        const timer = window.setTimeout(() => {
          cleanup()
          if (!liveState.current.liveRoute) {
            const url = new URL(
              liveState.current.navigation.entries[liveState.current.navigation.index]!,
            )
            url.protocol = new URL(origin).protocol
            url.host = new URL(origin).host
            resolve({ status: "pending", url: url.href, error: "", controls: [] })
          } else reject(new Error(agentCopy.bridgeUnavailable))
        }, timeoutMs + 1500)
        let requestedAfterReady = false
        function receive(event: MessageEvent) {
          const data: unknown = event.data
          if (
            event.source !== frame?.contentWindow ||
            frame !== liveState.current.frameRef.current ||
            event.origin !== origin ||
            !data ||
            typeof data !== "object" ||
            !("type" in data)
          )
            return
          if (data.type === "replica:canvas:ready" && !requestedAfterReady) {
            requestedAfterReady = true
            send()
          }
          if (
            data.type !== "replica:controls:status-result" ||
            !("nonce" in data) ||
            data.nonce !== nonce ||
            !("value" in data)
          )
            return
          cleanup()
          resolve(data.value)
        }
        function send() {
          if (frame !== liveState.current.frameRef.current) return
          frame?.contentWindow?.postMessage(
            {
              type: "replica:controls:status",
              nonce,
              timeoutMs: Math.max(0, deadline - Date.now()),
            },
            origin,
          )
        }
        window.addEventListener("message", receive)
        frame?.addEventListener("load", send)
        requests.signal.addEventListener("abort", cancel)
        send()
      })
      if (
        !result ||
        typeof result !== "object" ||
        !("url" in result) ||
        typeof result.url !== "string" ||
        !("status" in result) ||
        typeof result.status !== "string" ||
        !("error" in result) ||
        typeof result.error !== "string" ||
        !("controls" in result) ||
        !Array.isArray(result.controls)
      )
        throw new Error(agentCopy.bridgeUnavailable)
      const url = new URL(result.url)
      if (url.origin !== origin) throw new Error(agentCopy.routeChanged)
      const original = new URL(prototypeUrl)
      url.protocol = original.protocol
      url.host = original.host
      const panel = await waitForControlsPanel(deadline)
      if (!panel && liveState.current.controlsConnection === undefined)
        return { ...result, url: url.href }
      const panelStatus = panel
        ? controlsStatus(panel, panel.loading, url.href)
        : { status: "pending", url: url.href, error: "", controls: [] }
      return {
        ...panelStatus,
        runtime: {
          status: result.status,
          error: result.error,
          controls: result.controls,
        },
      }
    }

    function waitForControlsPanel(deadline: number): Promise<PanelState | null> {
      const connection = liveState.current.controlsConnection
      if (!connection) return Promise.resolve(null)
      const getSnapshot = connection.getSnapshot
      const subscribe = connection.subscribe
      const current = getSnapshot()
      if (!current.loading || deadline <= Date.now()) return Promise.resolve(current)
      return new Promise((resolve) => {
        const subscription: { unsubscribe?: () => void } = {}
        function finish(state: PanelState | null) {
          window.clearTimeout(timer)
          subscription.unsubscribe?.()
          requests.signal.removeEventListener("abort", cancel)
          resolve(state)
        }
        function check() {
          const state = getSnapshot()
          if (!state.loading) finish(state)
        }
        function cancel() {
          finish(null)
        }
        const timer = window.setTimeout(() => finish(getSnapshot()), deadline - Date.now())
        subscription.unsubscribe = subscribe(check)
        requests.signal.addEventListener("abort", cancel, { once: true })
        check()
      })
    }

    async function poll() {
      if (busy || stopped) return

      busy = true
      try {
        const { command, prototypeUrl: connectedUrl } = await request<{
          prototypeUrl?: string
          command: {
            id: string
            type: string
            input: {
              selector: string
              expectedLabel: string
              route: PreviewRoute
              timeoutMs?: number
            }
          } | null
        }>("/api/agent/next", token, {
          headers: { ...headers, "X-Replica-Prototype-Url": prototypeUrl },
        })
        if (!stopped && connectedUrl && connectedUrl !== prototypeUrl) {
          window.location.reload()
          return
        }
        if (!command) return

        let result: { id: string; ok: boolean; value?: unknown; error?: string }
        try {
          await request("/api/agent/progress", token, {
            method: "POST",
            headers,
            body: JSON.stringify({ id: command.id, stage: "handler started" }),
          })
          if (stopped) throw new Error(agentCopy.actionInterrupted)
          let value: unknown
          if (command.type === "inspect") {
            const { appearance, navigation, liveRoute, addressRef } = liveState.current
            const draft = addressRef.current?.value
            if (draft === undefined) throw new Error(agentCopy.addressUnavailable)

            value = {
              address: navigation.entries[navigation.index]!,
              addressDraft: draft,
              appearance,
              canGoBack: navigation.index > 0,
              canGoForward: navigation.index < navigation.entries.length - 1,
              historyIndex: navigation.index,
              historyLength: navigation.entries.length,
              route: liveRoute,
            }
          } else if (command.type === "click") {
            value = await click(command.input)
          } else if (command.type === "reload") {
            const { navigation, reload } = liveState.current
            reload()
            value = { reloaded: true, address: navigation.entries[navigation.index]! }
          } else if (command.type === "controls-status") {
            value = await readControlsStatus(command.input.timeoutMs ?? 0)
            await request("/api/agent/progress", token, {
              method: "POST",
              headers,
              body: JSON.stringify({ id: command.id, stage: "status collected" }),
            })
          } else {
            throw new Error(agentCopy.unknownAction)
          }
          result = { id: command.id, ok: true, value }
        } catch (cause) {
          result = {
            id: command.id,
            ok: false,
            error: cause instanceof Error ? cause.message : String(cause),
          }
        }
        try {
          await request("/api/agent/result", token, {
            method: "POST",
            headers,
            body: JSON.stringify(result),
          })
        } catch (cause) {
          if (!(cause instanceof Error) || !("statusCode" in cause) || cause.statusCode !== 422)
            throw cause
          // Reject the action explicitly; never replay a command after its outcome was collected.
          await request("/api/agent/result", token, {
            method: "POST",
            headers,
            body: JSON.stringify({ id: command.id, ok: false, error: agentCopy.replyRejected }),
          })
        }
      } catch (cause) {
        console.error("Live canvas action transport failed:", cause)
      } finally {
        busy = false
      }
    }
    const timer = window.setInterval(() => void poll(), 300)
    return () => {
      stopped = true
      requests.abort()
      window.clearInterval(timer)
      cancelClick.current?.()
    }
  }, [prototypeUrl, previewUrl, token, cancelClick])
}
