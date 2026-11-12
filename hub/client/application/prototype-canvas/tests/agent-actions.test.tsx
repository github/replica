import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { publicationState } from "@utils/resolve-prototype-publication/fixtures"
import { isHubStatusRequest } from "./is-hub-status-request"
import { App } from ".."

describe("App()", () => {
  it.each([
    ["response", "inspect"],
    ["response", "click"],
    ["confirmation", "click"],
  ])("keeps dequeued %s-phase %s actions from being lost on reload", async (phase, type) => {
    vi.useFakeTimers()
    const nonce = "00000000-0000-4000-8000-000000000005"
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    const route = { pathname: "/", search: "", hash: "#/settings" }
    const results: unknown[] = []
    let deliver: ((response: Response) => void) | undefined
    let reads = 0
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
        const path =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        if (path === "/api/agent/next") {
          reads += 1
          if (reads === 1)
            return new Promise<Response>((resolve) => {
              deliver = resolve
            })
          return Promise.resolve(
            new Response(
              JSON.stringify({
                command: reads === 2 ? { id: "after-reload", type: "inspect", input: {} } : null,
              }),
            ),
          )
        }
        if (path === "/api/agent/result") {
          if (typeof options?.body !== "string") throw new Error("Expected action result.")
          results.push(JSON.parse(options.body) as unknown)
          return Promise.resolve(new Response("{}"))
        }
        return Promise.resolve(
          new Response(
            JSON.stringify(isHubStatusRequest(path) ? { state: "unconfigured" } : publicationState),
          ),
        )
      }),
    )
    const view = render(
      <App
        config={{ name: "Demo", prototypeUrl: "http://localhost:4321/#/settings", token: "local" }}
      />,
    )
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow)
      throw new Error("Expected a preview frame.")
    const oldWindow = frame.contentWindow
    const post = vi.spyOn(oldWindow, "postMessage")
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:4321",
          source: oldWindow,
          data: { type: "replica:canvas:ready", nonce, protocolVersion: 1, route },
        }),
      )
    })
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(deliver).toBeDefined()
    const response = new Response(
      JSON.stringify({
        command: {
          id: "interrupted",
          type,
          input: type === "click" ? { selector: "#save", expectedLabel: "Save", route } : {},
        },
      }),
    )
    async function respond() {
      await act(async () => {
        if (!deliver) throw new Error("Expected a dequeued command request.")
        deliver(response)
        await Promise.resolve()
      })
    }
    if (phase === "confirmation") {
      await respond()
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({ type: "replica:canvas:click" }),
        "http://localhost:4321",
      )
    }
    fireEvent.click(screen.getByRole("button", { name: "Reload preview" }))
    expect(screen.getByTitle("Demo prototype")).not.toBe(frame)
    if (phase === "response") await respond()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject(
      type === "inspect"
        ? { id: "interrupted", ok: true, value: { route: null } }
        : {
            id: "interrupted",
            ok: false,
            error:
              phase === "confirmation"
                ? "The prototype reloaded before confirming the click. Inspect the live canvas and retry."
                : "The prototype bridge is not ready on this page.",
          },
    )
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(results).toHaveLength(2)
    expect(results[1]).toMatchObject({ id: "after-reload", ok: true })
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:4321",
          source: oldWindow,
          data: { type: "replica:canvas:click-result", nonce, clicked: true },
        }),
      )
    })
    expect(results).toHaveLength(2)
    view.unmount()
  })
})
