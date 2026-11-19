import { useEffect } from "react"
import { z } from "zod"

const frameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribed"), channel: z.string() }),
  z.object({
    type: z.literal("event"),
    channel: z.string(),
    event: z.object({ type: z.literal("changed"), payload: z.null() }),
  }),
  z.object({ type: z.literal("error"), code: z.literal("FORBIDDEN") }),
])

export function useReviewLiveUpdates(channel: string | null, refresh: () => void) {
  useEffect(() => {
    if (!channel || typeof WebSocket === "undefined") return
    const url = new URL("/api/realtime", window.location.href)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    let active = true
    let accessDenied = false
    let socket: WebSocket
    let timer: ReturnType<typeof setTimeout>
    let backoff = 1000

    function connect() {
      if (!active) return
      socket = new WebSocket(url)
      socket.addEventListener("open", () => {
        if (active) socket.send(JSON.stringify({ type: "subscribe", channel }))
      })
      socket.addEventListener("message", ({ data }) => {
        if (!active || typeof data !== "string") return
        let payload: unknown
        try {
          payload = JSON.parse(data)
        } catch {
          return
        }
        const parsed = frameSchema.safeParse(payload)
        if (!parsed.success) return
        const frame = parsed.data
        if (frame.type === "subscribed" && frame.channel === channel) {
          backoff = 1000
          refresh()
        } else if (frame.type === "event" && frame.channel === channel) {
          refresh()
        } else if (frame.type === "error") {
          accessDenied = true
          socket.close()
        }
      })
      socket.addEventListener("close", ({ code }) => {
        if (!active) return
        accessDenied ||= code === 4403
        refresh()
        if (accessDenied) return
        timer = setTimeout(connect, backoff)
        backoff = Math.min(backoff * 2, 15_000)
      })
    }

    function refreshOnFocus() {
      if (!accessDenied) refresh()
    }

    connect()
    window.addEventListener("focus", refreshOnFocus)
    return () => {
      active = false
      clearTimeout(timer)
      window.removeEventListener("focus", refreshOnFocus)
      if (socket.readyState < WebSocket.CLOSING) socket.close()
    }
  }, [channel, refresh])
}
