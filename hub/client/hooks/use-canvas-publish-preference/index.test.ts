import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { publicationState } from "@utils/resolve-prototype-publication/fixtures"
import { publishPreparation } from "@utils/resolve-prototype-publication/fixtures"
import { usePublishPreference } from "."

describe("usePublishPreference()", () => {
  it("loads only when enabled and disables duplicate saves until the write completes", async () => {
    vi.useFakeTimers()
    const preparation = publishPreparation(publicationState)
    let finish!: (response: Response) => void
    const fetch = vi.fn((path: string) =>
      path === "/api/publish/preference"
        ? new Promise<Response>((resolve) => {
            finish = resolve
          })
        : Promise.resolve(Response.json(preparation)),
    )
    vi.stubGlobal("fetch", fetch)
    const props = { token: "local", enabled: false, ...preparation.target }
    const { result, rerender } = renderHook(usePublishPreference, { initialProps: props })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fetch).not.toHaveBeenCalled()
    rerender({ ...props, enabled: true })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.remember).toBe(false)
    let saving!: Promise<void>
    act(() => {
      saving = result.current.save(true)
    })
    expect(result.current.saving).toBe(true)
    await act(async () => result.current.save(true))
    expect(fetch.mock.calls.filter(([path]) => path === "/api/publish/preference")).toHaveLength(1)
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/publish/preference",
      expect.objectContaining({
        body: JSON.stringify({ target: preparation.target, remember: true }),
      }),
    )
    await act(async () => {
      finish(Response.json({ remember: true }))
      await saving
    })
    expect(result.current.remember).toBe(true)
    expect(result.current.saving).toBe(false)
  })

  it("ignores a late read for the previous branch", async () => {
    vi.useFakeTimers()
    const preparation = publishPreparation(publicationState)
    let finish!: (response: Response) => void
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve
          }),
      )
      .mockResolvedValue(
        Response.json({
          ...preparation,
          target: { ...preparation.target, branch: "prototype/other" },
          remember: true,
        }),
      )
    vi.stubGlobal("fetch", fetch)
    const props = { token: "local", enabled: true, ...preparation.target }
    const { result, rerender } = renderHook(usePublishPreference, { initialProps: props })
    await act(() => vi.advanceTimersByTimeAsync(0))
    rerender({ ...props, branch: "prototype/other" })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.remember).toBe(true)
    await act(async () => {
      finish(Response.json(preparation))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.remember).toBe(true)
  })

  it("waits for a pending save before reloading reopened Settings", async () => {
    vi.useFakeTimers()
    const preparation = publishPreparation(publicationState)
    let remember = false
    let finish!: (response: Response) => void
    const fetch = vi.fn((path: string) =>
      path === "/api/publish/preference"
        ? new Promise<Response>((resolve) => {
            finish = resolve
          })
        : Promise.resolve(Response.json({ ...preparation, remember })),
    )
    vi.stubGlobal("fetch", fetch)
    const props = { token: "local", enabled: true, ...preparation.target }
    const { result, rerender } = renderHook(usePublishPreference, { initialProps: props })
    await act(() => vi.advanceTimersByTimeAsync(0))
    let saving!: Promise<void>
    act(() => {
      saving = result.current.save(true)
    })
    rerender({ ...props, enabled: false })
    rerender(props)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fetch.mock.calls.filter(([path]) => path === "/api/publish/prepare")).toHaveLength(1)
    await act(async () => {
      remember = true
      finish(Response.json({ remember }))
      await saving
    })
    expect(result.current.remember).toBe(true)
    expect(result.current.loading).toBe(false)
    expect(fetch.mock.calls.filter(([path]) => path === "/api/publish/prepare")).toHaveLength(2)
  })

  it("does not apply a pending save to another checkout after reloading", async () => {
    vi.useFakeTimers()
    const preparation = publishPreparation(publicationState)
    let branch = preparation.target.branch
    let finish!: (response: Response) => void
    const fetch = vi.fn((path: string) =>
      path === "/api/publish/preference"
        ? new Promise<Response>((resolve) => {
            finish = resolve
          })
        : Promise.resolve(
            Response.json({
              ...preparation,
              target: { ...preparation.target, branch },
              remember: false,
            }),
          ),
    )
    vi.stubGlobal("fetch", fetch)
    const props = { token: "local", enabled: true, ...preparation.target }
    const { result, rerender } = renderHook(usePublishPreference, { initialProps: props })
    await act(() => vi.advanceTimersByTimeAsync(0))
    let saving!: Promise<void>
    act(() => {
      saving = result.current.save(true)
    })
    branch = "prototype/other"
    rerender({ ...props, branch })
    await act(() => vi.advanceTimersByTimeAsync(0))
    await act(async () => {
      finish(Response.json({ remember: true }))
      await saving
    })
    expect(result.current.remember).toBe(false)
    expect(result.current.loading).toBe(false)
  })

  it("hides cached permission when Settings no longer matches the active Hub target", async () => {
    vi.useFakeTimers()
    const preparation = publishPreparation(publicationState, true)
    const fetch = vi.fn().mockResolvedValue(Response.json(preparation))
    vi.stubGlobal("fetch", fetch)
    const props = { token: "local", enabled: true, ...preparation.target }
    const { result, rerender } = renderHook(usePublishPreference, { initialProps: props })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.remember).toBe(true)
    rerender({ ...props, enabled: false })
    expect(result.current.remember).toBeNull()
    expect(result.current.loading).toBe(true)
    await act(async () => result.current.save(false))
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("rejects settings from another checkout without enabling the switch", async () => {
    vi.useFakeTimers()
    const preparation = publishPreparation(publicationState)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(preparation)))
    const { result } = renderHook(() =>
      usePublishPreference({
        token: "local",
        enabled: true,
        repository: preparation.target.repository,
        branch: "prototype/other",
      }),
    )
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.remember).toBeNull()
    expect(result.current.error).toMatch(/checkout changed/i)
  })
})
