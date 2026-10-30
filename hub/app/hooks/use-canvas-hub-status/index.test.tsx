import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { importedPrototype, publicationHub } from "@utils/resolve-prototype-publication/fixtures"
import { useHubStatus } from "."

function mount(fetch: (path: string) => Promise<Response>) {
  vi.useFakeTimers()
  vi.stubGlobal("fetch", fetch)
  const props = {
    token: "local",
    onStatus: vi.fn(),
    onError: vi.fn(),
  }
  return { ...renderHook(useHubStatus, { initialProps: props }), props }
}

describe("useHubStatus()", () => {
  it("applies a slow Hub poll instead of superseding it on every tick", async () => {
    let finish: ((response: Response) => void) | undefined
    const fetch = vi.fn((path: string) => {
      if (path === "/api/hub/status")
        return new Promise<Response>((resolve) => {
          finish = resolve
        })
      if (path === "/api/hub/open") return Promise.resolve(Response.json(publicationHub))
      throw new Error(`Unexpected Hub request: ${path}`)
    })
    const { result } = mount(fetch)
    await act(() => vi.advanceTimersByTimeAsync(0))
    await act(() => vi.advanceTimersByTimeAsync(45_000))
    expect(fetch.mock.calls.filter(([path]) => path === "/api/hub/status")).toHaveLength(1)
    const status = { ...publicationHub, state: "connected", prototype: importedPrototype }
    await act(async () => {
      if (!finish) throw new Error("Expected a pending Hub poll.")
      finish(Response.json(status))
      await Promise.resolve()
    })
    expect(result.current.status).toEqual(status)
  })

  it("ignores a pending response after unmount", async () => {
    let finish: ((response: Response) => void) | undefined
    const { unmount, props } = mount(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    await act(() => vi.advanceTimersByTimeAsync(0))
    unmount()
    await act(async () => {
      if (!finish) throw new Error("Expected a pending Hub request.")
      finish(Response.json(publicationHub))
      await Promise.resolve()
    })
    expect(props.onStatus).not.toHaveBeenCalled()
    expect(props.onError).not.toHaveBeenCalled()
  })

  it("ignores an old token's response after the new connection loads", async () => {
    let finish: ((response: Response) => void) | undefined
    const current = { ...publicationHub, hubOrigin: "https://new.example.com" }
    const fetch = vi
      .fn<(path: string) => Promise<Response>>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve
          }),
      )
      .mockResolvedValue(Response.json(current))
    const { result, rerender, props } = mount(fetch)
    await act(() => vi.advanceTimersByTimeAsync(0))
    rerender({ ...props, token: "new" })
    await act(() => vi.advanceTimersByTimeAsync(0))
    await act(async () => {
      if (!finish) throw new Error("Expected the previous Hub request.")
      finish(Response.json(publicationHub))
      await Promise.resolve()
    })
    expect(result.current.status).toEqual(current)
    expect(props.onStatus).toHaveBeenCalledExactlyOnceWith(current)
  })

  it("retains checkout identity when a later Hub read fails", async () => {
    const fetch = vi
      .fn<(path: string) => Promise<Response>>()
      .mockResolvedValueOnce(Response.json(publicationHub))
      .mockRejectedValueOnce(new Error("Offline"))
    const { result, props } = mount(fetch)
    await act(() => vi.advanceTimersByTimeAsync(0))
    await act(async () => result.current.refresh())
    expect(result.current.status).toMatchObject({
      state: "unavailable",
      repository: publicationHub.repository,
      branch: publicationHub.branch,
      hubOrigin: publicationHub.hubOrigin,
    })
    expect(props.onError).toHaveBeenCalledWith("Offline")
  })
})
