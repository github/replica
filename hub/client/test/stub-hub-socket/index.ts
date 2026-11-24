import { expect, vi } from "vitest"

export function stubHubSocket(url: URL) {
  class HubSocket extends EventTarget {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    readyState = HubSocket.CONNECTING
    send = vi.fn<(frame: string) => void>()

    constructor(address: string | URL) {
      super()
      expect(String(address)).toBe(url.href)
      queueMicrotask(() => {
        if (this.readyState !== HubSocket.CONNECTING) return
        this.readyState = HubSocket.OPEN
        this.dispatchEvent(new Event("open"))
      })
    }

    close(code = 1000) {
      if (this.readyState >= HubSocket.CLOSING) return
      this.readyState = HubSocket.CLOSING
      queueMicrotask(() => {
        this.readyState = HubSocket.CLOSED
        this.dispatchEvent(new CloseEvent("close", { code }))
      })
    }
  }

  vi.stubGlobal("WebSocket", HubSocket)
}
