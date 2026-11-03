import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { InboxNotification } from "@utils/notification/types"

import { useNotificationInbox } from "."

const notification: InboxNotification = {
  id: 1,
  version: 0,
  actor: { login: "mona", name: "Mona Lisa", avatarUrl: null },
  kind: "mention",
  excerpt: "Can you check the spacing, @octocat?",
  createdAt: "2026-10-09T09:00:00Z",
  read: false,
  repository: "github/prototype",
  prototype: "Welcome",
  path: "/repositories/2001/prototypes/1?comment=1&notification=1",
  updatePath: "/notifications/1",
  target: { prototypeId: 1, threadId: 1, commentId: 1 },
}
const page = { notifications: [notification], nextBefore: null, unreadCount: 12 }

describe("useNotificationInbox()", () => {
  it("keeps cached unread notifications visible on reopen and adds new arrivals first without duplicates", async () => {
    let finish!: (response: Response) => void
    const refresh = new Promise<Response>((resolve) => {
      finish = resolve
    })
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(page)).mockReturnValueOnce(refresh)
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() =>
      useNotificationInbox({
        path: "/notifications/inbox",
        authenticityToken: "token",
        autoLoad: false,
        initialUnreadOnly: true,
        limit: 10,
      }),
    )
    act(() => result.current.onOpen())
    await waitFor(() => expect(result.current.notifications).toHaveLength(1))
    act(() => result.current.onOpen())
    expect(result.current.notifications).toEqual([notification])
    expect(result.current.loading).toBe(false)
    await act(async () => {
      finish(
        Response.json({
          notifications: [{ ...notification, id: 2 }, notification],
          nextBefore: null,
          unreadCount: 2,
        }),
      )
      await refresh
    })
    expect(result.current.notifications.map((item) => item.id)).toEqual([2, 1])
    expect(result.current.unreadCount).toBe(2)
    expect(fetch).toHaveBeenLastCalledWith(
      new URL("http://localhost:3000/notifications/inbox?limit=10&unread=true"),
      { credentials: "same-origin" },
    )
  })

  it("switches between All and Unread immediately while refreshing cached notifications", async () => {
    const read = { ...notification, id: 2, read: true }
    let finish!: (response: Response) => void
    const refresh = new Promise<Response>((resolve) => {
      finish = resolve
    })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...page, notifications: [read, notification] }))
      .mockReturnValueOnce(refresh)
      .mockReturnValueOnce(new Promise<Response>(() => {}))
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() =>
      useNotificationInbox({ path: "/notifications/inbox", authenticityToken: "token" }),
    )
    await waitFor(() => expect(result.current.notifications).toHaveLength(2))
    act(() => result.current.onFilter(true))
    expect(result.current.notifications).toEqual([notification])
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(result.current.loading).toBe(false)
    await act(async () => {
      finish(Response.json(page))
      await refresh
    })
    act(() => result.current.onFilter(false))
    expect(result.current.notifications.map((item) => item.id)).toEqual([2, 1])
    expect(result.current.loading).toBe(false)
  })

  it("preserves older loaded pages when refreshing the newest notifications", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ...page,
          notifications: [{ ...notification, id: 3 }],
          nextBefore: 3,
        }),
      )
      .mockResolvedValueOnce(Response.json(page))
      .mockResolvedValueOnce(
        Response.json({
          ...page,
          notifications: [
            { ...notification, id: 4 },
            { ...notification, id: 3 },
          ],
          nextBefore: 3,
        }),
      )
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() =>
      useNotificationInbox({ path: "/notifications/inbox", authenticityToken: "token" }),
    )
    await waitFor(() => expect(result.current.hasMore).toBe(true))
    act(() => result.current.onLoadMore())
    await waitFor(() => expect(result.current.notifications).toHaveLength(2))
    act(() => result.current.onOpen())
    await waitFor(() =>
      expect(result.current.notifications.map((item) => item.id)).toEqual([4, 3, 1]),
    )
  })

  it("keeps an empty cached inbox settled during refresh and clears cached content on access denial", async () => {
    let finish!: (response: Response) => void
    const refresh = new Promise<Response>((resolve) => {
      finish = resolve
    })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ notifications: [], nextBefore: null, unreadCount: 0 }))
      .mockReturnValueOnce(refresh)
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() =>
      useNotificationInbox({
        path: "/notifications/inbox",
        authenticityToken: "token",
        autoLoad: false,
      }),
    )
    act(() => result.current.onOpen())
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.onOpen())
    expect(result.current.loading).toBe(false)
    await act(async () => {
      finish(Response.json(page))
      await refresh
    })
    expect(result.current.notifications).toHaveLength(1)
    act(() => result.current.onOpen())
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.notifications).toEqual([])
    expect(result.current.unreadCount).toBe(0)
  })

  it("loads the latest ten only when the preview opens and keeps the complete unread count", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(page))
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() =>
      useNotificationInbox({
        path: "/notifications/inbox",
        authenticityToken: "token",
        initialUnreadCount: 12,
        autoLoad: false,
        limit: 10,
      }),
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(result.current.unreadCount).toBe(12)
    act(() => result.current.onOpen())
    await waitFor(() => expect(result.current.notifications).toHaveLength(1))
    expect(fetch).toHaveBeenCalledWith(
      new URL("http://localhost:3000/notifications/inbox?limit=10"),
      {
        credentials: "same-origin",
      },
    )
    expect(result.current.unreadCount).toBe(12)
  })

  it("exposes failures, clears inaccessible data, and retries explicitly", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json(page))
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() =>
      useNotificationInbox({
        path: "/notifications/inbox",
        authenticityToken: "token",
        initialUnreadCount: 12,
      }),
    )
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.notifications).toHaveLength(0)
    expect(result.current.unreadCount).toBe(0)
    act(() => result.current.onRetry())
    await waitFor(() => expect(result.current.notifications).toHaveLength(1))
    expect(result.current.failed).toBe(false)
  })

  it("rejects a malformed response instead of presenting it as an empty inbox", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ notifications: [], nextBefore: null })),
    )
    const { result } = renderHook(() =>
      useNotificationInbox({ path: "/notifications/inbox", authenticityToken: "token" }),
    )
    await waitFor(() => expect(result.current.failed).toBe(true))
  })

  it("appends authorized pages without replacing the complete unread count", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...page, nextBefore: 1 }))
      .mockResolvedValueOnce(
        Response.json({
          ...page,
          notifications: [{ ...notification, id: 2 }],
          nextBefore: null,
        }),
      )
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() =>
      useNotificationInbox({ path: "/notifications/inbox", authenticityToken: "token" }),
    )
    await waitFor(() => expect(result.current.hasMore).toBe(true))
    act(() => result.current.onLoadMore())
    await waitFor(() => expect(result.current.notifications).toHaveLength(2))
    expect(fetch).toHaveBeenLastCalledWith(
      new URL("http://localhost:3000/notifications/inbox?limit=50&before=1"),
      { credentials: "same-origin" },
    )
    expect(result.current.unreadCount).toBe(12)
    expect(result.current.hasMore).toBe(false)
  })

  it("uses fresh server counts when repository page data changes", () => {
    vi.stubGlobal("fetch", vi.fn())
    const { result, rerender } = renderHook(
      ({ count }) =>
        useNotificationInbox({
          path: "/notifications/inbox",
          authenticityToken: "token",
          initialUnreadCount: count,
          autoLoad: false,
        }),
      { initialProps: { count: 12 } },
    )
    rerender({ count: 4 })
    expect(result.current.unreadCount).toBe(4)
  })

  it("keeps appended pages and their cursor while updating a read state", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...page, nextBefore: 1 }))
      .mockResolvedValueOnce(
        Response.json({
          ...page,
          notifications: [{ ...notification, id: 2 }],
          nextBefore: 2,
        }),
      )
      .mockResolvedValueOnce(Response.json({ version: 1, read: true, unreadCount: 11 }))
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() =>
      useNotificationInbox({ path: "/notifications/inbox", authenticityToken: "token" }),
    )
    await waitFor(() => expect(result.current.notifications).toHaveLength(1))
    act(() => result.current.onLoadMore())
    await waitFor(() => expect(result.current.notifications).toHaveLength(2))
    act(() => result.current.onToggleRead(1))
    await waitFor(() =>
      expect(result.current.notifications.find((item) => item.id === 1)?.read).toBe(true),
    )
    expect(result.current.notifications.find((item) => item.id === 1)?.version).toBe(1)
    expect(result.current.notifications.find((item) => item.id === 2)?.read).toBe(false)
    expect(result.current.hasMore).toBe(true)
    expect(result.current.unreadCount).toBe(11)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it("reloads remaining unread activity after reading the last loaded unread item", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(page))
      .mockResolvedValueOnce(Response.json({ ...page, nextBefore: 1, unreadCount: 2 }))
      .mockResolvedValueOnce(Response.json({ version: 1, read: true, unreadCount: 1 }))
      .mockResolvedValueOnce(
        Response.json({
          ...page,
          notifications: [{ ...notification, id: 2 }],
          unreadCount: 1,
        }),
      )
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() =>
      useNotificationInbox({ path: "/notifications/inbox", authenticityToken: "token" }),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.onFilter(true))
    await waitFor(() => expect(result.current.unreadCount).toBe(2))
    act(() => result.current.onToggleRead(1))
    await waitFor(() => expect(result.current.notifications[0]?.id).toBe(2))
    expect(result.current.unreadCount).toBe(1)
    expect(result.current.failed).toBe(false)
    expect(fetch).toHaveBeenLastCalledWith(
      new URL("http://localhost:3000/notifications/inbox?limit=50&unread=true"),
      { credentials: "same-origin" },
    )
  })

  it("applies another inbox surface's read update without losing loaded pages or echoing it", async () => {
    const onReadChange = vi.fn()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...page, nextBefore: 1 }))
      .mockResolvedValueOnce(
        Response.json({
          ...page,
          notifications: [{ ...notification, id: 2 }],
          nextBefore: 2,
        }),
      )
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() =>
      useNotificationInbox({
        path: "/notifications/inbox",
        authenticityToken: "token",
        onReadChange,
      }),
    )
    await waitFor(() => expect(result.current.notifications).toHaveLength(1))
    act(() => result.current.onLoadMore())
    await waitFor(() => expect(result.current.notifications).toHaveLength(2))
    act(() => result.current.onReadUpdate(1, { version: 1, read: true, unreadCount: 11 }))
    expect(result.current.notifications.find((item) => item.id === 1)).toMatchObject({
      version: 1,
      read: true,
    })
    expect(result.current.notifications).toHaveLength(2)
    expect(result.current.hasMore).toBe(true)
    expect(result.current.unreadCount).toBe(11)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(onReadChange).not.toHaveBeenCalled()
  })

  it("reloads an unread filter when another surface marks an unloaded item unread", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(page))
      .mockResolvedValueOnce(Response.json(page))
      .mockResolvedValueOnce(
        Response.json({
          ...page,
          notifications: [notification, { ...notification, id: 2, version: 1 }],
          unreadCount: 13,
        }),
      )
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() =>
      useNotificationInbox({ path: "/notifications/inbox", authenticityToken: "token" }),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.onFilter(true))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.onReadUpdate(2, { version: 1, read: false, unreadCount: 13 }))
    await waitFor(() => expect(result.current.notifications).toHaveLength(2))
    expect(result.current.unreadCount).toBe(13)
    expect(fetch).toHaveBeenLastCalledWith(
      new URL("http://localhost:3000/notifications/inbox?limit=50&unread=true"),
      { credentials: "same-origin" },
    )
  })

  it.each([403, 409, 503])(
    "exposes failed read updates with status %s and retries a fresh page",
    async (status) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(Response.json(page))
        .mockResolvedValueOnce(new Response(null, { status }))
        .mockResolvedValueOnce(
          Response.json({
            ...page,
            notifications: [{ ...notification, version: 1, read: true }],
            unreadCount: 0,
          }),
        )
      vi.stubGlobal("fetch", fetch)
      const { result } = renderHook(() =>
        useNotificationInbox({ path: "/notifications/inbox", authenticityToken: "token" }),
      )
      await waitFor(() => expect(result.current.notifications).toHaveLength(1))
      act(() => result.current.onToggleRead(1))
      await waitFor(() => expect(result.current.failed).toBe(true))
      expect(result.current.notifications).toHaveLength(0)
      expect(result.current.loading).toBe(false)
      act(() => result.current.onRetry())
      await waitFor(() => expect(result.current.notifications[0]?.version).toBe(1))
      expect(result.current.failed).toBe(false)
      expect(result.current.unreadCount).toBe(0)
    },
  )
})
