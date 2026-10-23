import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useCommentingRecovery } from "."

describe("useCommentingRecovery()", () => {
  const initial = {
    identity: "hub/repo/branch",
    enabled: true,
    ready: false,
    bridgeProblem: "",
    token: "local",
  }

  it("never inspects or installs the plugin while waiting for runtime readiness", async () => {
    vi.useFakeTimers()
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const { result, rerender } = renderHook(useCommentingRecovery, { initialProps: initial })
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(fetch).not.toHaveBeenCalled()
    expect(result.current.visible).toBe(false)
    rerender({ ...initial, bridgeProblem: "No runtime response." })
    expect(result.current.visible).toBe(true)
    rerender({ ...initial, bridgeProblem: "No runtime response.", ready: true })
    expect(result.current.visible).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(fetch).not.toHaveBeenCalled()
  })

  it("permits only an explicit fix request and dismissal without retrying installation", async () => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ requested: true })))
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(useCommentingRecovery, {
      initialProps: { ...initial, bridgeProblem: "Rebuild the preview." },
    })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.visible).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    await act(async () => {
      result.current.onFix()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      "/api/commenting/fix",
      expect.objectContaining({ method: "POST" }),
    )
    expect(result.current.requested).toBe(true)
    expect(result.current.visible).toBe(true)
    act(() => result.current.onDismiss())
    expect(result.current.visible).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("preserves the repository authorization gate and resets dismissal on checkout changes", async () => {
    vi.useFakeTimers()
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const props = { ...initial, bridgeProblem: "No runtime response." }
    const { result, rerender } = renderHook(useCommentingRecovery, {
      initialProps: { ...props, enabled: false },
    })
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(result.current.visible).toBe(false)
    rerender(props)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.visible).toBe(true)
    act(() => result.current.onDismiss())
    rerender({ ...props, identity: "hub/repo/other-branch" })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.visible).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("surfaces failed fix requests and clears errors when an explicit retry succeeds", async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Could not reach Copilot."))
      .mockResolvedValueOnce(new Response(JSON.stringify({ requested: true })))
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(useCommentingRecovery, {
      initialProps: { ...initial, bridgeProblem: "No runtime response." },
    })
    await act(() => vi.advanceTimersByTimeAsync(0))
    await act(async () => {
      result.current.onFix()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.error).toBe("Could not reach Copilot.")
    expect(result.current.requested).toBe(false)
    expect(result.current.busy).toBe(false)
    await act(async () => {
      result.current.onFix()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.error).toBe("")
    expect(result.current.requested).toBe(true)
  })

  it("ignores a pending fix response after the checkout changes", async () => {
    vi.useFakeTimers()
    let complete!: (value: Response) => void
    const promise = new Promise<Response>((resolve) => {
      complete = resolve
    })
    const fetch = vi.fn().mockReturnValue(promise)
    vi.stubGlobal("fetch", fetch)
    const props = { ...initial, bridgeProblem: "No runtime response." }
    const { result, rerender } = renderHook(useCommentingRecovery, { initialProps: props })
    await act(() => vi.advanceTimersByTimeAsync(0))
    act(() => result.current.onFix())
    expect(result.current.busy).toBe(true)
    rerender({ ...props, identity: "hub/repo/other-branch" })
    await act(() => vi.advanceTimersByTimeAsync(0))
    await act(async () => {
      complete(new Response(JSON.stringify({ requested: true })))
      await promise
    })
    expect(result.current.requested).toBe(false)
    expect(result.current.busy).toBe(false)
  })
})
