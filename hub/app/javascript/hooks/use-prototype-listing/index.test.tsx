import { NavigationContext } from "@thoughtbot/superglue"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { prototypeListing } from "@/storybook/fixtures/prototype-listing"

import { usePrototypeListing } from "."

function navigation(visit = vi.fn(() => Promise.resolve(undefined))) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NavigationContext.Provider
        value={{ pageKey: "/", search: {}, navigateTo: vi.fn(), remote: vi.fn(), visit }}
      >
        {children}
      </NavigationContext.Provider>
    )
  }
}

describe("usePrototypeListing()", () => {
  it("debounces search but immediately submits author changes and cancels pending edits on reset", async () => {
    vi.useFakeTimers()
    try {
      const visit = vi.fn(() => Promise.resolve(undefined))
      const { result } = renderHook(
        () => usePrototypeListing({ ...prototypeListing, author: "me" }),
        { wrapper: navigation(visit) },
      )
      act(() => {
        result.current.onQueryChange("nav")
        result.current.onQueryChange(" navigation ")
      })
      expect(visit).not.toHaveBeenCalled()
      await act(async () => vi.advanceTimersByTimeAsync(300))
      expect(visit).toHaveBeenCalledExactlyOnceWith("/repositories/2001?q=navigation&author=me", {
        dataset: { sgReplace: "true" },
      })
      expect(result.current.query).toBe("navigation")
      act(() => {
        result.current.onQueryChange("immediate")
        result.current.onQuerySubmit()
      })
      await act(async () => vi.advanceTimersByTimeAsync(500))
      expect(visit).toHaveBeenCalledTimes(2)
      expect(visit).toHaveBeenLastCalledWith("/repositories/2001?q=immediate&author=me", {
        dataset: {},
      })
      act(() => result.current.onQueryChange("checkout"))
      await act(async () => {
        result.current.onAuthorChange("2")
        await Promise.resolve()
      })
      expect(visit).toHaveBeenLastCalledWith("/repositories/2001?q=checkout&author=2", {
        dataset: {},
      })
      act(() => result.current.onQueryChange("next draft"))
      await act(async () => {
        result.current.onQueryChange("")
        await Promise.resolve()
      })
      await act(async () => vi.advanceTimersByTimeAsync(500))
      expect(visit).toHaveBeenCalledTimes(4)
      expect(visit).toHaveBeenLastCalledWith("/repositories/2001?author=2", {
        dataset: { sgReplace: "true" },
      })
      expect(result.current.query).toBe("")
    } finally {
      vi.useRealTimers()
    }
  })

  it("ignores superseded visit failures and retries the current failed request", async () => {
    let rejectOld!: (error: Error) => void
    const old = new Promise<undefined>((_resolve, reject) => {
      rejectOld = reject
    })
    const failure = new Error("Repository unavailable")
    const visit = vi
      .fn(() => Promise.resolve(undefined))
      .mockReturnValueOnce(old)
      .mockRejectedValueOnce(failure)
    const { result } = renderHook(() => usePrototypeListing(prototypeListing), {
      wrapper: navigation(visit),
    })
    act(() => result.current.onNavigate("/repositories/2001?page=2"))
    await act(async () => {
      result.current.onAuthorChange("me")
      await Promise.resolve()
    })
    expect(result.current.error).toBe(true)
    await act(async () => {
      result.current.onRetry()
      await Promise.resolve()
    })
    expect(result.current.error).toBe(false)
    expect(visit).toHaveBeenLastCalledWith("/repositories/2001?author=me", { dataset: {} })
    await act(async () => {
      rejectOld(failure)
      await Promise.resolve()
    })
    expect(result.current.error).toBe(false)
    expect(result.current.pending).toBe(false)
  })

  it("restores URL query state on browser history and cancels pending edits on unmount", async () => {
    vi.useFakeTimers()
    const originalUrl = window.location.href
    try {
      const visit = vi.fn(() => Promise.resolve(undefined))
      const { result, unmount } = renderHook(() => usePrototypeListing(prototypeListing), {
        wrapper: navigation(visit),
      })
      act(() => result.current.onQueryChange("unsent"))
      act(() => {
        window.history.replaceState({}, "", "/repositories/2001?q=restored&author=me")
        window.dispatchEvent(new PopStateEvent("popstate"))
      })
      expect(result.current.query).toBe("restored")
      await act(async () => vi.advanceTimersByTimeAsync(500))
      expect(visit).not.toHaveBeenCalled()
      act(() => result.current.onQueryChange("another unsent edit"))
      unmount()
      await act(async () => vi.advanceTimersByTimeAsync(500))
      expect(visit).not.toHaveBeenCalled()
    } finally {
      window.history.replaceState({}, "", originalUrl)
      vi.useRealTimers()
    }
  })

  it("loads validated author pages with same-origin credentials and the caller's cancellation signal", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            authors: [{ id: "2", login: "mona", name: "Mona", avatarUrl: null }],
            nextCursor: "next",
          }),
        ),
      ),
    )
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() => usePrototypeListing(prototypeListing), {
      wrapper: navigation(),
    })
    const controller = new AbortController()
    await expect(
      result.current.loadAuthors(" mona ", "boundary", controller.signal),
    ).resolves.toMatchObject({ authors: [{ id: "2", login: "mona" }], nextCursor: "next" })
    expect(fetch).toHaveBeenCalledWith(
      new URL(
        "/repositories/2001/prototype_authors?q=mona&cursor=boundary",
        window.location.origin,
      ),
      {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        signal: controller.signal,
      },
    )
    fetch.mockResolvedValueOnce(new Response("", { status: 403 }))
    await expect(result.current.loadAuthors("", null, controller.signal)).rejects.toThrow()
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ authors: "invalid" })))
    await expect(result.current.loadAuthors("", null, controller.signal)).rejects.toThrow()
  })

  it("discards old drafts, requests, and retry targets when switching repositories", async () => {
    vi.useFakeTimers()
    try {
      let rejectOld!: (error: Error) => void
      const visit = vi.fn(
        () =>
          new Promise<undefined>((_resolve, reject) => {
            rejectOld = reject
          }),
      )
      const { result, rerender } = renderHook((listing) => usePrototypeListing(listing), {
        initialProps: prototypeListing,
        wrapper: navigation(visit),
      })
      act(() => result.current.onNavigate("/repositories/2001?page=2"))
      act(() => result.current.onQueryChange("unsent old repository search"))
      expect(result.current.pending).toBe(true)
      rerender({
        ...prototypeListing,
        path: "/repositories/2002",
        authorsPath: "/repositories/2002/prototype_authors",
        query: "new repository",
        author: "me",
      })
      expect(result.current.query).toBe("new repository")
      expect(result.current.pending).toBe(false)
      await act(async () => {
        rejectOld(new Error("Old repository request failed"))
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(result.current.error).toBe(false)
      act(() => result.current.onRetry())
      expect(visit).toHaveBeenCalledTimes(1)
      act(() => result.current.onQuerySubmit())
      expect(visit).toHaveBeenLastCalledWith("/repositories/2002?q=new+repository&author=me", {
        dataset: {},
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
