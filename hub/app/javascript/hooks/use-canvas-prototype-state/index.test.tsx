import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { usePrototypeState } from "."

const state = { name: "Demo", stats: {}, publishStatus: { state: "not_published" } }
let fetchMock: ReturnType<typeof vi.fn<(url: string, options?: RequestInit) => Promise<unknown>>>

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(state) }))
  vi.stubGlobal("fetch", fetchMock)
})

describe("usePrototypeState()", () => {
  it("discards an older response that arrives after a newer checkout", async () => {
    let completeOld: ((value: unknown) => void) | undefined
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeOld = resolve
        }),
    )
    const { result } = renderHook(() => usePrototypeState("local-token"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const latest = { ...state, name: "New checkout" }
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(latest) })
    await act(async () => {
      await result.current.refresh(true)
    })
    await act(async () => {
      completeOld!({ ok: true, json: () => Promise.resolve(state) })
      await Promise.resolve()
    })
    expect(result.current.state).toEqual(latest)
  })

  it("replaces stale evidence with unknown when refreshing fails", async () => {
    const { result } = renderHook(() => usePrototypeState("local-token"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fetchMock.mockRejectedValueOnce(new Error("Network unavailable"))
    await act(async () => {
      await result.current.refresh(true)
    })
    expect(result.current.state?.stats.remoteBranch?.state).toBe("unknown")
    expect(result.current.error).toBe("Network unavailable")
  })

  it("forces the initial refresh with the canvas token", async () => {
    const { result } = renderHook(() => usePrototypeState("local-token"))
    expect(fetchMock).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(fetchMock).toHaveBeenCalledWith("/api/refresh", {
      method: "POST",
      body: "{}",
      headers: {
        "Content-Type": "application/json",
        "X-Replica-Canvas-Token": "local-token",
      },
    })
    expect(result.current.state).toEqual(state)
  })

  it("uses cached state on each 15-second timer tick", async () => {
    renderHook(() => usePrototypeState("local-token"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/refresh",
      "/api/state",
      "/api/state",
    ])
    expect(fetchMock.mock.calls.at(1)?.[1]).not.toHaveProperty("method")
  })

  it("refreshes pending workflow status and returns to cached reads after completion", async () => {
    let nextState = {
      ...state,
      publishStatus: { state: "requested" },
      publishRequest: { state: "requested", requestedAt: "2026-09-28T12:00:00Z" },
    }
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(nextState) }),
    )
    const { result } = renderHook(() => usePrototypeState("local-token"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/refresh", "/api/refresh"])

    nextState = {
      ...nextState,
      publishStatus: { state: "in_progress" },
      publishRequest: { ...nextState.publishRequest, state: "in_progress" },
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(result.current.state?.publishStatus?.state).toBe("in_progress")

    nextState = {
      ...nextState,
      publishStatus: { state: "published" },
      publishRequest: { ...nextState.publishRequest, state: "published" },
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/refresh",
      "/api/refresh",
      "/api/refresh",
      "/api/refresh",
      "/api/state",
    ])
    expect(result.current.state?.publishStatus?.state).toBe("published")
  })

  it("keeps checking a new commit when saved request state completed for an earlier run", async () => {
    let nextState = {
      ...state,
      publishStatus: { state: "published" },
      publishRequest: { state: "requested", requestedAt: "2026-09-28T12:00:00Z" },
    }
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(nextState) }),
    )
    renderHook(() => usePrototypeState("local-token"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    nextState = {
      ...nextState,
      publishStatus: { state: "not_published" },
      publishRequest: { ...nextState.publishRequest, state: "published" },
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/refresh",
      "/api/refresh",
      "/api/refresh",
    ])

    nextState = {
      ...nextState,
      publishStatus: { state: "failed" },
      publishRequest: { ...nextState.publishRequest, state: "failed" },
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/refresh",
      "/api/refresh",
      "/api/refresh",
      "/api/refresh",
      "/api/state",
    ])
  })

  it("lets a slow pending refresh finish before starting another poll", async () => {
    const pending = {
      ...state,
      publishStatus: { state: "requested" },
      publishRequest: { state: "requested", requestedAt: "2026-09-28T12:00:00Z" },
    }
    let finishRefresh!: (response: unknown) => void
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(pending) })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRefresh = resolve
          }),
      )
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ...pending, publishStatus: { state: "published" } }),
      })
    const { result } = renderHook(() => usePrototypeState("local-token"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(45_000)
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/refresh", "/api/refresh"])
    await act(async () => {
      finishRefresh({
        ok: true,
        json: () => Promise.resolve({ ...pending, publishStatus: { state: "in_progress" } }),
      })
      await Promise.resolve()
    })
    expect(result.current.state?.publishStatus?.state).toBe("in_progress")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(result.current.state?.publishStatus?.state).toBe("published")
    expect(fetchMock.mock.calls).toHaveLength(3)
  })

  it("does not replace a newer refresh with an older response", async () => {
    let finishInitial!: (response: unknown) => void
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishInitial = resolve
          }),
      )
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ...state, publishStatus: { state: "published" } }),
      })
    const { result } = renderHook(() => usePrototypeState("local-token"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      window.dispatchEvent(new Event("focus"))
    })
    expect(result.current.state?.publishStatus?.state).toBe("published")

    await act(async () => {
      finishInitial({
        ok: true,
        json: () => Promise.resolve({ ...state, publishStatus: { state: "requested" } }),
      })
      await Promise.resolve()
    })
    expect(result.current.state?.publishStatus?.state).toBe("published")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/state")
  })

  it("forces a refresh when the window gains focus", async () => {
    renderHook(() => usePrototypeState("local-token"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      window.dispatchEvent(new Event("focus"))
    })

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/refresh", "/api/refresh"])
  })

  it("clears the initial timer, interval, and focus listener on unmount", async () => {
    const beforeInitialRefresh = renderHook(() => usePrototypeState("local-token"))
    beforeInitialRefresh.unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
      window.dispatchEvent(new Event("focus"))
    })
    expect(fetchMock).not.toHaveBeenCalled()

    const afterInitialRefresh = renderHook(() => usePrototypeState("local-token"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    afterInitialRefresh.unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
      window.dispatchEvent(new Event("focus"))
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
