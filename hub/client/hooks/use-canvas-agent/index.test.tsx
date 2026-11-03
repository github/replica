import { act, render, renderHook } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import type { PanelState } from "@utils/prototype-controls-connection"
import type { PreviewRoute } from "../use-canvas-preview-navigation/types"
import { useCanvasAgent } from "."

const nonce = "00000000-0000-4000-8000-000000000004"
const route = { pathname: "/settings", search: "?view=grid", hash: "#save" }
type Command = { id: string; type: string; input?: unknown }

function mount(
  commands: Command[],
  liveRoute: PreviewRoute | null = null,
  previewUrl?: string,
  controlsConnection?: Parameters<typeof useCanvasAgent>[0]["controlsConnection"],
) {
  vi.useFakeTimers()
  vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
  const results: unknown[] = []
  const fetch = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/agent/next")
      return Promise.resolve(Response.json({ command: commands.shift() ?? null }))
    if (path === "/api/agent/progress") return Promise.resolve(Response.json({ received: true }))
    if (path === "/api/agent/result") {
      if (typeof options?.body !== "string") throw new Error("Expected an action result.")
      results.push(JSON.parse(options.body) as unknown)
      return Promise.resolve(Response.json({}))
    }
    throw new Error(`Unexpected agent request: ${path}`)
  })
  vi.stubGlobal("fetch", fetch)
  const props: Parameters<typeof useCanvasAgent>[0] = {
    token: "local",
    prototypeUrl: "http://localhost:4321/",
    previewUrl,
    frameRef: createRef<HTMLIFrameElement>(),
    addressRef: createRef<HTMLInputElement>(),
    appearance: "dark",
    navigation: { input: "http://localhost:4321/", entries: ["http://localhost:4321/"], index: 0 },
    liveRoute,
    cancelClick: createRef<(() => void) | null>(),
    reload: vi.fn(),
    controlsConnection,
  }
  render(
    <>
      <input ref={props.addressRef} defaultValue="/unsaved" />
      <iframe ref={props.frameRef} title="Test prototype" />
    </>,
  )
  const view = renderHook(useCanvasAgent, { initialProps: props })
  const frameWindow = props.frameRef.current?.contentWindow
  if (!frameWindow) throw new Error("Expected a preview frame.")
  const post = vi.spyOn(frameWindow, "postMessage")
  return { props, view, fetch, results, frameWindow, post }
}

describe("useCanvasAgent()", () => {
  it("reloads the preview through the canvas navigation", async () => {
    const { props, results } = mount([{ id: "reload", type: "reload" }])
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(props.reload).toHaveBeenCalledOnce()
    expect(results).toEqual([
      { id: "reload", ok: true, value: { reloaded: true, address: "http://localhost:4321/" } },
    ])
  })

  it("reads runtime diagnostics from the exact frame and maps its proxy URL to the prototype", async () => {
    const { results, frameWindow, post } = mount(
      [{ id: "status", type: "controls-status", input: { timeoutMs: 1000 } }],
      route,
      "http://127.0.0.1:12345/",
    )
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(post).toHaveBeenCalledWith(
      { type: "replica:controls:status", nonce, timeoutMs: 1000 },
      "http://127.0.0.1:12345",
    )
    const value = {
      status: "ready",
      url: "http://127.0.0.1:12345/settings?view=grid#save",
      error: "",
      controls: [
        {
          scope: "page",
          id: "save",
          available: false,
          busy: false,
          visible: true,
          error: "The binding target is missing.",
        },
      ],
    }
    for (const reply of [
      { source: window, origin: "http://127.0.0.1:12345", nonce },
      { source: frameWindow, origin: "http://other.local", nonce },
      { source: frameWindow, origin: "http://127.0.0.1:12345", nonce: "stale" },
    ]) {
      await act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            ...reply,
            data: { type: "replica:controls:status-result", nonce: reply.nonce, value },
          }),
        )
        return Promise.resolve()
      })
    }
    expect(results).toEqual([])
    await act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frameWindow,
          origin: "http://127.0.0.1:12345",
          data: { type: "replica:controls:status-result", nonce, value },
        }),
      )
      return Promise.resolve()
    })
    expect(results).toEqual([
      {
        id: "status",
        ok: true,
        value: { ...value, url: "http://localhost:4321/settings?view=grid#save" },
      },
    ])
    expect(post).toHaveBeenCalledOnce()
  })

  it("does not claim panel readiness before its connection exists", async () => {
    const { results, frameWindow } = mount(
      [{ id: "status", type: "controls-status", input: { timeoutMs: 0 } }],
      null,
      undefined,
      null,
    )
    await act(() => vi.advanceTimersByTimeAsync(300))
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frameWindow,
          origin: "http://localhost:4321",
          data: {
            type: "replica:controls:status-result",
            nonce,
            value: { status: "ready", url: "http://localhost:4321/", error: "", controls: [] },
          },
        }),
      )
      await Promise.resolve()
    })
    expect(results).toEqual([
      {
        id: "status",
        ok: true,
        value: {
          status: "pending",
          url: "http://localhost:4321/",
          error: "",
          controls: [],
          runtime: { status: "ready", error: "", controls: [] },
        },
      },
    ])
  })

  it("reports the exact Controls panel state alongside the live runtime for comparison", async () => {
    const panelState: PanelState = {
      runtimeAvailable: true,
      status: "ready",
      scopes: [
        {
          declaration: {
            version: 1,
            scope: "header",
            controls: [
              {
                id: "show-search",
                label: "Show search",
                type: "button",
                binding: { type: "api", object: "headerPreview", action: "toggleSearch" },
              },
            ],
          },
          fingerprint: "header-fingerprint",
          snapshot: {
            values: {},
            visible: { "show-search": true },
            groups: {},
            actions: { "show-search": { available: false, busy: false } },
            bindings: {
              "show-search": {
                error: 'The app API "headerPreview" is unavailable.',
                busy: false,
                available: false,
              },
            },
            revision: 1,
          },
        },
      ],
      loading: false,
      notice: "",
      error: "",
      storageError: "",
      resetting: false,
    }
    const connection = {
      getSnapshot: () => panelState,
      subscribe: () => () => {},
    }
    const { results, frameWindow } = mount(
      [{ id: "status", type: "controls-status", input: { timeoutMs: 1000 } }],
      null,
      "http://localhost:4321/",
      connection,
    )
    await act(() => vi.advanceTimersByTimeAsync(300))
    await act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frameWindow,
          origin: "http://localhost:4321",
          data: {
            type: "replica:controls:status-result",
            nonce,
            value: {
              status: "ready",
              url: "http://localhost:4321/?rc=1",
              error: "",
              controls: [
                {
                  scope: "header",
                  id: "show-search",
                  available: true,
                  busy: false,
                  visible: true,
                  error: "",
                },
              ],
            },
          },
        }),
      )
      return Promise.resolve()
    })
    expect(results).toEqual([
      {
        id: "status",
        ok: true,
        value: {
          status: "ready",
          url: "http://localhost:4321/?rc=1",
          error: "",
          controls: [
            {
              scope: "header",
              id: "show-search",
              available: false,
              busy: false,
              visible: true,
              error: 'The app API "headerPreview" is unavailable.',
            },
          ],
          runtime: {
            status: "ready",
            error: "",
            controls: [
              {
                scope: "header",
                id: "show-search",
                available: true,
                busy: false,
                visible: true,
                error: "",
              },
            ],
          },
        },
      },
    ])
  })

  it("returns pending while a reloaded document has not initialized", async () => {
    const { results } = mount([{ id: "status", type: "controls-status", input: {} }])
    await act(() => vi.advanceTimersByTimeAsync(1800))
    expect(results).toEqual([
      {
        id: "status",
        ok: true,
        value: { status: "pending", url: "http://localhost:4321/", error: "", controls: [] },
      },
    ])
  })

  it("resends a readiness read after the new bridge announces itself and rejects stale frames", async () => {
    const { props, results, frameWindow, post } = mount([
      { id: "status", type: "controls-status", input: { timeoutMs: 1000 } },
    ])
    await act(() => vi.advanceTimersByTimeAsync(300))
    await act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frameWindow,
          origin: "http://localhost:4321",
          data: { type: "replica:canvas:ready" },
        }),
      )
      return Promise.resolve()
    })
    expect(post).toHaveBeenCalledTimes(2)
    const nextFrame = document.createElement("iframe")
    document.body.append(nextFrame)
    props.frameRef.current = nextFrame
    await act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frameWindow,
          origin: "http://localhost:4321",
          data: {
            type: "replica:controls:status-result",
            nonce,
            value: { status: "ready", url: "http://localhost:4321/stale", controls: [], error: "" },
          },
        }),
      )
      return Promise.resolve()
    })
    expect(results).toEqual([])
    await act(() => vi.advanceTimersByTimeAsync(2500))
    expect(results).toEqual([
      {
        id: "status",
        ok: true,
        value: { status: "pending", url: "http://localhost:4321/", controls: [], error: "" },
      },
    ])
    nextFrame.remove()
  })

  it("reports the live address draft and appearance and rejects clicks without a bridge", async () => {
    const { results } = mount([
      { id: "inspect", type: "inspect" },
      { id: "click", type: "click", input: { selector: "#save", expectedLabel: "Save", route } },
    ])
    await act(() => vi.advanceTimersByTimeAsync(600))
    expect(results).toEqual([
      {
        id: "inspect",
        ok: true,
        value: {
          address: "http://localhost:4321/",
          addressDraft: "/unsaved",
          appearance: "dark",
          canGoBack: false,
          canGoForward: false,
          historyIndex: 0,
          historyLength: 1,
          route: null,
        },
      },
      { id: "click", ok: false, error: "The prototype bridge is not ready on this page." },
    ])
  })

  it("clicks only after the current bridge route is confirmed", async () => {
    const { results, post, frameWindow } = mount(
      [
        {
          id: "stale",
          type: "click",
          input: { selector: "#save", expectedLabel: "Save", route: { ...route, pathname: "/" } },
        },
        {
          id: "current",
          type: "click",
          input: { selector: "#save", expectedLabel: "Save", route },
        },
      ],
      route,
      "http://127.0.0.1:12345/",
    )
    await act(() => vi.advanceTimersByTimeAsync(600))
    expect(results).toEqual([
      {
        id: "stale",
        ok: false,
        error: "The prototype route changed. Inspect the live canvas again.",
      },
    ])
    expect(post).toHaveBeenCalledWith(
      { type: "replica:canvas:click", nonce, selector: "#save", expectedLabel: "Save", route },
      "http://127.0.0.1:12345",
    )
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://127.0.0.1:12345",
          source: frameWindow,
          data: { type: "replica:canvas:click-result", nonce, clicked: true },
        }),
      )
      await Promise.resolve()
    })
    expect(results[1]).toEqual({ id: "current", ok: true, value: { clicked: true, route } })
  })

  it("keeps prototype error messages out of agent results", async () => {
    const { results, frameWindow } = mount(
      [{ id: "click", type: "click", input: { selector: "#save", expectedLabel: "Save", route } }],
      route,
    )
    await act(() => vi.advanceTimersByTimeAsync(300))
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:4321",
          source: frameWindow,
          data: {
            type: "replica:canvas:click-result",
            nonce,
            clicked: false,
            error: "Untrusted prototype error",
          },
        }),
      )
      await Promise.resolve()
    })
    expect(results).toEqual([{ id: "click", ok: false, error: "The target could not be clicked." }])
  })

  it("times out when confirmations have the wrong origin, frame, or nonce", async () => {
    const { results, frameWindow } = mount(
      [{ id: "click", type: "click", input: { selector: "#save", expectedLabel: "Save", route } }],
      route,
    )
    await act(() => vi.advanceTimersByTimeAsync(300))
    for (const confirmation of [
      { origin: "https://other.example.com", source: frameWindow, nonce },
      { origin: "http://localhost:4321", source: window, nonce },
      { origin: "http://localhost:4321", source: frameWindow, nonce: "stale" },
    ]) {
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            ...confirmation,
            data: { type: "replica:canvas:click-result", nonce: confirmation.nonce, clicked: true },
          }),
        )
      })
    }
    expect(results).toEqual([])
    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(results).toEqual([
      {
        id: "click",
        ok: false,
        error: "The prototype did not confirm the click. Check its bridge and retry.",
      },
    ])
  })

  it("reports cancellation once and stops polling after unmount", async () => {
    const { props, view, results, fetch } = mount(
      [{ id: "click", type: "click", input: { selector: "#save", expectedLabel: "Save", route } }],
      route,
    )
    await act(() => vi.advanceTimersByTimeAsync(300))
    await act(async () => {
      props.cancelClick.current?.()
      await Promise.resolve()
    })
    expect(results).toEqual([
      {
        id: "click",
        ok: false,
        error:
          "The prototype reloaded before confirming the click. Inspect the live canvas and retry.",
      },
    ])
    expect(props.cancelClick.current).toBeNull()
    view.unmount()
    const calls = fetch.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(5_000))
    expect(fetch).toHaveBeenCalledTimes(calls)
    expect(results).toHaveLength(1)
  })

  it("returns cancellation instead of dropping a consumed status command on effect cleanup", async () => {
    const { view, results, fetch } = mount(
      [{ id: "status", type: "controls-status", input: { timeoutMs: 5000 } }],
      route,
    )
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(results).toEqual([])
    await act(async () => {
      view.unmount()
      await Promise.resolve()
    })
    expect(results).toEqual([
      {
        id: "status",
        ok: false,
        error:
          "The canvas changed while collecting Controls status. Inspect the live canvas and retry.",
      },
    ])
    const stages = fetch.mock.calls
      .filter(([path]) => path === "/api/agent/progress")
      .map(([, options]) => {
        if (typeof options?.body !== "string") throw new Error("Expected progress JSON.")
        return JSON.parse(options.body) as unknown
      })
    expect(stages).toEqual([{ id: "status", stage: "handler started" }])
  })

  it("keeps a status request alive across connection snapshots and preview frame reloads", async () => {
    const { props, view, results, frameWindow } = mount(
      [{ id: "status", type: "controls-status", input: { timeoutMs: 5000 } }],
      route,
    )
    await act(() => vi.advanceTimersByTimeAsync(300))
    const state: PanelState = {
      runtimeAvailable: true,
      status: "ready",
      scopes: [],
      loading: false,
      resetting: false,
      error: "",
      storageError: "",
      notice: "",
    }
    const nextFrame = document.createElement("iframe")
    document.body.append(nextFrame)
    view.rerender({
      ...props,
      frameRef: { current: nextFrame },
      controlsConnection: { getSnapshot: () => state, subscribe: () => () => {} },
      liveRoute: null,
    })
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frameWindow,
          origin: "http://localhost:4321",
          data: {
            type: "replica:controls:status-result",
            nonce,
            value: { status: "ready", url: "http://localhost:4321/stale", error: "", controls: [] },
          },
        }),
      )
      await Promise.resolve()
    })
    expect(results).toEqual([])
    await act(() => vi.advanceTimersByTimeAsync(6500))
    expect(results).toMatchObject([
      {
        id: "status",
        ok: true,
        value: { status: "ready", url: "http://localhost:4321/" },
      },
    ])
    nextFrame.remove()
  })

  it("returns a cancellation reply when reconnection restarts the agent effect", async () => {
    const { props, view, results } = mount(
      [{ id: "status", type: "controls-status", input: { timeoutMs: 5000 } }],
      route,
    )
    await act(() => vi.advanceTimersByTimeAsync(300))
    await act(async () => {
      view.rerender({ ...props, prototypeUrl: "http://localhost:4322/" })
      await Promise.resolve()
    })
    expect(results).toEqual([
      {
        id: "status",
        ok: false,
        error:
          "The canvas changed while collecting Controls status. Inspect the live canvas and retry.",
      },
    ])
  })

  it("reports rejected reply validation instead of abandoning the pending action", async () => {
    const { fetch, results } = mount([{ id: "inspect", type: "inspect" }])
    const respond = fetch.getMockImplementation()!
    let rejected = false
    fetch.mockImplementation((path, options) => {
      if (path === "/api/agent/result" && !rejected) {
        rejected = true
        return Promise.resolve(
          Response.json({ error: "Invalid agent result payload." }, { status: 422 }),
        )
      }
      return respond(path, options)
    })
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(results).toEqual([
      {
        id: "inspect",
        ok: false,
        error: "The live canvas rejected the action reply. Check its transport diagnostics.",
      },
    ])
    expect(fetch.mock.calls.filter(([path]) => path === "/api/agent/next")).toHaveLength(1)
  })

  it("returns cancellation when the server delivers a dequeued request after unmount", async () => {
    const { fetch, view, results } = mount([])
    const respond = fetch.getMockImplementation()!
    let deliver: ((response: Response) => void) | undefined
    fetch.mockImplementation((path, options) =>
      path === "/api/agent/next"
        ? new Promise<Response>((resolve) => {
            deliver = resolve
          })
        : respond(path, options),
    )
    await act(() => vi.advanceTimersByTimeAsync(300))
    view.unmount()
    await act(async () => {
      if (!deliver) throw new Error("Expected a pending agent poll.")
      deliver(Response.json({ command: { id: "status", type: "controls-status", input: {} } }))
      await Promise.resolve()
    })
    expect(results).toEqual([
      {
        id: "status",
        ok: false,
        error: "The canvas changed before the action could run. Inspect the live canvas and retry.",
      },
    ])
  })
})
