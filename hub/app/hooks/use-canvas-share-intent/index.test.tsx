import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { publicationHub, publicationState } from "@utils/resolve-prototype-publication/fixtures"
import { useShareIntent } from "."

describe("useShareIntent()", () => {
  it("fills missing checkout metadata without claiming the target changed", async () => {
    vi.useFakeTimers()
    const props: Parameters<typeof useShareIntent>[0] = {
      token: "local",
      state: null,
      hubStatus: null,
    }
    const { result, rerender } = renderHook(useShareIntent, { initialProps: props })
    act(() => result.current.begin())
    rerender({ ...props, state: publicationState, hubStatus: publicationHub })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.targetChanged).toBe(false)
    expect(result.current.intent).toMatchObject({
      repository: publicationState.stats.repository,
      branch: publicationState.stats.branch,
      hubOrigin: publicationHub.hubOrigin,
    })
  })

  it("requires reopening even when a changed target returns to its original identity", async () => {
    vi.useFakeTimers()
    const props = { token: "local", state: publicationState, hubStatus: publicationHub }
    const { result, rerender } = renderHook(useShareIntent, { initialProps: props })
    act(() => {
      result.current.begin()
      result.current.setConnecting(true)
    })
    rerender({ ...props, hubStatus: { ...publicationHub, hubOrigin: "https://new.example.com" } })
    await act(() => vi.advanceTimersByTimeAsync(0))
    rerender(props)
    expect(result.current.targetChanged).toBe(true)
    expect(result.current.intent?.connecting).toBe(false)
    act(() => result.current.close())
    act(() => result.current.begin())
    expect(result.current.targetChanged).toBe(false)
  })
})
