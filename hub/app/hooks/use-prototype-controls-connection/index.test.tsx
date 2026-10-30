import { act, fireEvent, render, renderHook } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { useControlsConnection } from "."
import { createControls } from "@utils/prototype-controls/controls.mjs"
import { scopeProjection } from "@utils/prototype-controls-protocol/scope-projection"
import { controlsStatus } from "@utils/prototype-controls-status"
import type { ControlsEnvelope } from "@utils/prototype-controls-protocol"

describe("useControlsConnection()", () => {
  it("keeps failed startup restore errors in live binding state and clears them on recovery", async () => {
    vi.useFakeTimers()
    const frameRef = createRef<HTMLIFrameElement>()
    render(<iframe ref={frameRef} title="Recovery preview" />)
    const frame = frameRef.current!
    const post = vi.spyOn(frame.contentWindow!, "postMessage")
    const props = {
      frameRef,
      prototypeUrl: "http://localhost:4321/",
      address: "http://localhost:4321/",
      replaceAddress: vi.fn(),
    }
    const { result, unmount } = renderHook(useControlsConnection, { initialProps: props })
    await act(() => vi.advanceTimersByTimeAsync(0))
    const hello = post.mock.calls
      .map(([data]) => data as ControlsEnvelope)
      .filter((data) => data.type === "hello")
      .at(-1)!
    const controller = createControls({
      version: 1,
      scope: "restoreRecoveryTest",
      controls: [{ id: "search", label: "Show search", type: "boolean", default: true }],
    })
    const error = 'The app API "headerPreview" is unavailable.'
    controller.bindingStatus("search", error)
    function reply(requestId: string, sequence: number, failure?: string) {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:4321",
          source: frame.contentWindow,
          data: {
            protocol: "replica:controls",
            version: 1,
            epoch: hello.epoch,
            requestId,
            type: requestId === "event" ? "snapshot" : "reply",
            sequence,
            error: failure,
            state: {
              runtimeAvailable: true,
              status: "ready",
              scopes: [scopeProjection(controller)],
            },
          },
        }),
      )
    }
    await act(() => {
      reply(hello.requestId, 1)
      return Promise.resolve()
    })
    const restore = post.mock.calls
      .map(([data]) => data as ControlsEnvelope)
      .find((data) => data.command?.operation === "restore")!
    expect(result.current.state?.loading).toBe(true)
    await act(() => {
      reply(restore.requestId, 2, `Show search: ${error}`)
      return Promise.resolve()
    })
    expect(result.current.state?.loading).toBe(false)
    expect(result.current.state?.error).toBe("")
    expect(controlsStatus(result.current.state!, false, props.address).controls[0]?.error).toBe(
      error,
    )
    controller.bindingStatus("search", "")
    await act(() => {
      reply("event", 3)
      return Promise.resolve()
    })
    expect(result.current.state?.error).toBe("")
    expect(controlsStatus(result.current.state!, false, props.address).controls[0]).toMatchObject({
      available: true,
      error: "",
    })
    unmount()
  })

  it("releases a replaced frame and never reads private Controls storage", async () => {
    vi.useFakeTimers()
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const first = createRef<HTMLIFrameElement>()
    const next = createRef<HTMLIFrameElement>()
    render(
      <>
        <iframe ref={first} title="Old preview" />
        <iframe ref={next} title="New preview" />
      </>,
    )
    const post = vi.spyOn(first.current!.contentWindow!, "postMessage")
    const nextPost = vi.spyOn(next.current!.contentWindow!, "postMessage")
    const props = {
      prototypeUrl: "http://localhost:4321/",
      previewUrl: "http://127.0.0.1:12345/",
      address: "http://localhost:4321/?rc.page.title=%22Saved%22",
      replaceAddress: vi.fn(),
      frameRef: first,
    }
    const { result, rerender, unmount } = renderHook(useControlsConnection, { initialProps: props })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ controlQuery: "rc.page.title=%22Saved%22" }),
      "http://127.0.0.1:12345",
    )
    const oldConnection = result.current.connection
    rerender({ ...props, frameRef: next })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.connection).not.toBe(oldConnection)
    const oldCalls = post.mock.calls.length
    fireEvent.load(first.current!)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(post.mock.calls.length).toBe(oldCalls)
    unmount()
    const calls = nextPost.mock.calls.length
    fireEvent.load(next.current!)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(nextPost.mock.calls.length).toBe(calls)
    expect(fetch).not.toHaveBeenCalled()
  })
})
