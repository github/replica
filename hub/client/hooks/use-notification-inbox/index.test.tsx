import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { notifyInboxRead } from "@utils/notification/read-updates"
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
  target: { prototypeId: "1", threadId: 1, commentId: 1 },
}
const page = { notifications: [notification], nextBefore: null, unreadCount: 12 }

const unreadInboxUrl = new URL(
  "/api/notifications/inbox?limit=50&unread=true",
  window.location.origin,
)

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
    expect(fetch).not.toHaveBeenCalled()
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

  it.each([200, 403])(
    "clears cached rows on fresh open and keeps the supplied count when the preview returns %s",
    async (status) => {
      let finishPreview!: (response: Response) => void
      const pendingPreview = new Promise<Response>((resolve) => (finishPreview = resolve))
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(Response.json(page))
        .mockReturnValueOnce(pendingPreview)
      vi.stubGlobal("fetch", fetch)
      const { result } = renderHook(() =>
        useNotificationInbox({
          path: "/api/notifications/inbox",
          authenticityToken: "",
          autoLoad: false,
          synchronize: true,
        }),
      )
      act(() => result.current.onOpen())
      await waitFor(() => expect(result.current.notifications).toEqual([notification]))

      act(() => result.current.onOpen(true))
      expect(result.current.notifications).toEqual([])
      expect(result.current.loading).toBe(true)
      expect(result.current.unreadCount).toBe(12)
      act(() => result.current.onUnreadCountChange(7))

      const fresh = { ...notification, id: 2 }
      await act(async () => {
        finishPreview(
          status === 200
            ? Response.json({ ...page, notifications: [fresh] })
            : new Response(null, { status }),
        )
        await pendingPreview
      })

      expect(result.current.notifications).toEqual(status === 200 ? [fresh] : [])
      expect(result.current.failed).toBe(status === 403)
      expect(result.current.unreadCount).toBe(7)
    },
  )

  it("keeps the last unread count when the preview fails and retries explicitly", async () => {
    const onUnreadCountChange = vi.fn()
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
        autoLoad: false,
        limit: 10,
        onUnreadCountChange,
      }),
    )
    act(() => result.current.onOpen())
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.unreadCount).toBe(12)
    expect(onUnreadCountChange).not.toHaveBeenCalled()
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
      .mockResolvedValueOnce(Response.json({ version: 1, read: true }))
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

  it.each(["All", "Unread"])(
    "finds a new arrival after reading the last known unread item in %s",
    async (filter) => {
      const unreadOnly = filter === "Unread"
      const item = { ...notification, updatePath: "/api/notifications/1" }
      const newItem = { ...notification, id: 2, updatePath: "/api/notifications/2" }
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ ...page, notifications: [item], unreadCount: 1 }))
        .mockResolvedValueOnce(Response.json({ version: 1, read: true }))
        .mockResolvedValueOnce(
          Response.json({
            ...page,
            notifications: unreadOnly ? [newItem] : [newItem, { ...item, read: true, version: 1 }],
            unreadCount: 1,
          }),
        )
      vi.stubGlobal("fetch", fetch)
      const { result } = renderHook(() =>
        useNotificationInbox({
          path: "/api/notifications/inbox",
          authenticityToken: "token",
          initialUnreadOnly: unreadOnly,
          synchronize: true,
        }),
      )
      await waitFor(() => expect(result.current.notifications[0]?.id).toBe(1))
      expect(result.current.unreadCount).toBe(1)
      act(() => result.current.onToggleRead(1))
      await waitFor(() => expect(result.current.notifications[0]?.id).toBe(2))
      expect(result.current.unreadCount).toBe(1)
      expect(result.current.failed).toBe(false)
      expect(fetch).toHaveBeenLastCalledWith(
        unreadOnly
          ? unreadInboxUrl
          : new URL("/api/notifications/inbox?limit=50", window.location.origin),
        { credentials: "same-origin", cache: "no-store" },
      )
    },
  )

  it("uses the latest count when a saved read is reversed during refresh", async () => {
    const item = { ...notification, updatePath: "/api/notifications/1" }
    let finishEarlierRefresh!: (response: Response) => void
    const earlierRefresh = new Promise<Response>((resolve) => (finishEarlierRefresh = resolve))
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...page, notifications: [item], unreadCount: 1 }))
      .mockResolvedValueOnce(Response.json({ version: 1, read: true }))
      .mockReturnValueOnce(earlierRefresh)
      .mockResolvedValueOnce(Response.json({ version: 2, read: false }))
      .mockResolvedValueOnce(
        Response.json({ ...page, notifications: [{ ...item, version: 2 }], unreadCount: 1 }),
      )
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() =>
      useNotificationInbox({
        path: "/api/notifications/inbox",
        authenticityToken: "token",
        synchronize: true,
      }),
    )
    await waitFor(() => expect(result.current.notifications[0]?.read).toBe(false))
    act(() => result.current.onToggleRead(1))
    await waitFor(() => expect(result.current.notifications[0]?.read).toBe(true))
    expect(fetch).toHaveBeenCalledTimes(3)

    act(() => result.current.onToggleRead(1))
    await waitFor(() => expect(result.current.notifications[0]?.version).toBe(2))
    expect(result.current.unreadCount).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(5)

    await act(async () => {
      finishEarlierRefresh(
        Response.json({
          ...page,
          notifications: [{ ...item, read: true, version: 1 }],
          unreadCount: 0,
        }),
      )
      await earlierRefresh
    })
    expect(result.current.notifications[0]).toMatchObject({ version: 2, read: false })
    expect(result.current.unreadCount).toBe(1)
  })

  it("reports a saved read even when refreshing the unread inbox fails", async () => {
    const onReadChange = vi.fn()
    const item = { ...notification, updatePath: "/api/notifications/1" }
    let finishRefresh!: (response: Response) => void
    const refresh = new Promise<Response>((resolve) => (finishRefresh = resolve))
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...page, notifications: [item], unreadCount: 1 }))
      .mockResolvedValueOnce(Response.json({ version: 1, read: true }))
      .mockReturnValueOnce(refresh)
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() =>
      useNotificationInbox({
        path: "/api/notifications/inbox",
        authenticityToken: "token",
        initialUnreadOnly: true,
        synchronize: true,
        onReadChange,
      }),
    )
    await waitFor(() => expect(result.current.notifications[0]?.id).toBe(1))

    act(() => result.current.onToggleRead(1))

    await waitFor(() =>
      expect(onReadChange).toHaveBeenCalledExactlyOnceWith(1, { version: 1, read: true }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/notifications/1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ notification: { read: true, version: 0 } }),
      }),
    )
    expect(fetch).toHaveBeenLastCalledWith(unreadInboxUrl, expect.anything())

    await act(async () => {
      finishRefresh(new Response(null, { status: 503 }))
      await refresh
    })
    expect(result.current.failed).toBe(true)
    expect(onReadChange).toHaveBeenCalledOnce()
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

  it("refreshes the open Inbox when another surface saves a read after a failed update", async () => {
    const other = { ...notification, id: 2, updatePath: "/api/notifications/2" }
    const saved = { version: 1, read: true }
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...page, notifications: [other, notification], unreadCount: 2 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          ...page,
          notifications: [other, { ...notification, ...saved }],
          unreadCount: 1,
        }),
      )
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() =>
      useNotificationInbox({
        path: "/api/notifications/inbox",
        authenticityToken: "token",
        synchronize: true,
      }),
    )
    await waitFor(() => expect(result.current.notifications).toHaveLength(2))
    act(() => result.current.onToggleRead(2))
    await waitFor(() => expect(result.current.failed).toBe(true))

    act(() => notifyInboxRead({ id: 1, startedAt: performance.now(), saved }))
    await waitFor(() =>
      expect(result.current.notifications).toEqual([other, { ...notification, ...saved }]),
    )
    expect(result.current.unreadCount).toBe(1)
    expect(result.current.failed).toBe(false)
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
    "reports a failed read with status %s without treating it as saved",
    async (status) => {
      const onReadChange = vi.fn()
      const onUnreadCountChange = vi.fn()
      const refreshedItem =
        status === 409 ? { ...notification, version: 1, read: true } : notification
      const refreshedPage = {
        ...page,
        notifications:
          status === 409 ? [refreshedItem] : [{ ...notification, id: 2 }, refreshedItem],
        unreadCount: status === 409 ? 0 : 2,
      }
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ ...page, unreadCount: 1 }))
        .mockResolvedValueOnce(new Response(null, { status }))
        .mockResolvedValueOnce(Response.json(refreshedPage))
      vi.stubGlobal("fetch", fetch)
      const { result } = renderHook(() =>
        useNotificationInbox({
          path: "/notifications/inbox",
          authenticityToken: "token",
          onReadChange,
          onUnreadCountChange,
        }),
      )
      await waitFor(() => expect(result.current.notifications).toHaveLength(1))
      act(() => result.current.onToggleRead(1))
      await waitFor(() => expect(result.current.failed).toBe(true))
      expect(result.current.loading).toBe(false)
      if (status === 403) {
        expect(result.current.notifications).toHaveLength(0)
        expect(result.current.unreadCount).toBe(0)
      } else {
        expect(result.current.unreadCount).toBe(1)
        expect(onUnreadCountChange).not.toHaveBeenCalledWith(0)
      }
      expect(onReadChange).not.toHaveBeenCalled()

      act(() => result.current.onRetry())
      await waitFor(() => expect(result.current.unreadCount).toBe(refreshedPage.unreadCount))
      expect(result.current.failed).toBe(false)
      expect(result.current.notifications.find((item) => item.id === 1)).toMatchObject({
        version: refreshedItem.version,
        read: refreshedItem.read,
      })
    },
  )
})
