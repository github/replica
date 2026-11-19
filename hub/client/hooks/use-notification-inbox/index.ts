import { useCallback, useEffect, useRef, useState } from "react"

import { NOTIFICATION_PAGE_SCHEMA, NOTIFICATION_READ_SCHEMA } from "@utils/notification/schemas"
import { notifyInboxRead, onInboxReadChanged } from "@utils/notification/read-updates"
import type { InboxNotification, NotificationReadUpdate } from "@utils/notification/types"

export function useNotificationInbox({
  path,
  authenticityToken,
  initialUnreadCount = 0,
  initialUnreadOnly = false,
  unreadOnly: controlledUnreadOnly,
  autoLoad = true,
  autoCount = false,
  synchronize = false,
  limit = 50,
  onReadChange,
  onUnreadCountChange,
}: {
  path: string | undefined
  authenticityToken: string
  initialUnreadCount?: number
  initialUnreadOnly?: boolean
  unreadOnly?: boolean
  autoLoad?: boolean
  autoCount?: boolean
  synchronize?: boolean
  limit?: number
  onReadChange?: (id: number, saved: NotificationReadUpdate) => void
  onUnreadCountChange?: (count: number) => void
}) {
  const [localUnreadOnly, setUnreadOnly] = useState(initialUnreadOnly)
  const unreadOnly = controlledUnreadOnly ?? localUnreadOnly
  const [notifications, setNotifications] = useState<InboxNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const [previousInitialUnreadCount, setPreviousInitialUnreadCount] = useState(initialUnreadCount)
  if (initialUnreadCount !== previousInitialUnreadCount) {
    setPreviousInitialUnreadCount(initialUnreadCount)
    setUnreadCount(initialUnreadCount)
  }
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [cachePath, setCachePath] = useState(path)
  if (path !== cachePath) {
    setCachePath(path)
    setNotifications([])
    setNextBefore(null)
  }
  const [loading, setLoading] = useState(autoLoad && Boolean(path))
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)
  const loaded = useRef(false)
  const oldest = useRef<{ all: number | null; unread: number | null }>({ all: null, unread: null })
  const ownReadUpdate = useRef<NotificationReadUpdate | null>(null)
  const callbacks = useRef({ onReadChange, onUnreadCountChange })
  useEffect(() => {
    callbacks.current = { onReadChange, onUnreadCountChange }
  }, [onReadChange, onUnreadCountChange])

  useEffect(() => {
    loaded.current = false
    oldest.current = { all: null, unread: null }
  }, [path])

  const load = useCallback(
    async (before: number | null = null) => {
      if (!path) return

      const requestGeneration = ++generation.current
      setLoading(before !== null || !loaded.current)
      setFailed(false)
      try {
        async function readPage(cursor: number | null) {
          const url = new URL(path!, window.location.origin)
          url.searchParams.set("limit", String(limit))
          if (unreadOnly) url.searchParams.set("unread", "true")
          if (cursor !== null) url.searchParams.set("before", String(cursor))
          const response = await fetch(url, {
            credentials: "same-origin",
            ...(synchronize ? { cache: "no-store" } : {}),
          })
          if (!response.ok) throw new Error("Inbox is unavailable")
          return NOTIFICATION_PAGE_SCHEMA.parse(await response.json())
        }
        const reloadPrefix = synchronize && autoLoad
        let page = await readPage(reloadPrefix ? null : before)
        const filter = unreadOnly ? "unread" : "all"
        const refreshThrough = before ?? oldest.current[filter]
        // Reauthorize previously loaded pages. Merging them without checking can retain
        // excerpts from a repository the viewer can no longer read.
        if (reloadPrefix && refreshThrough !== null) {
          while (
            page.nextBefore !== null &&
            (before === null
              ? page.nextBefore > refreshThrough
              : page.nextBefore >= refreshThrough) &&
            requestGeneration === generation.current
          ) {
            const older = await readPage(page.nextBefore)
            page = { ...older, notifications: [...page.notifications, ...older.notifications] }
          }
        }
        if (requestGeneration !== generation.current) return

        loaded.current = true
        oldest.current[filter] = page.notifications.at(-1)?.id ?? null
        setNotifications((previous) => {
          if (synchronize) return page.notifications
          const incomingIds = new Set(page.notifications.map((item) => item.id))
          const retained = previous.filter(
            (item) =>
              !incomingIds.has(item.id) &&
              (before !== null ||
                (unreadOnly && item.read) ||
                (page.nextBefore !== null && item.id < page.nextBefore)),
          )
          return [...page.notifications, ...retained].sort((a, b) => b.id - a.id)
        })
        setNextBefore(page.nextBefore)
        setUnreadCount(page.unreadCount)
        callbacks.current.onUnreadCountChange?.(page.unreadCount)
      } catch {
        if (requestGeneration !== generation.current) return

        setNotifications([])
        loaded.current = false
        oldest.current = { all: null, unread: null }
        setUnreadCount(0)
        setNextBefore(null)
        setFailed(true)
      } finally {
        if (requestGeneration === generation.current) setLoading(false)
      }
    },
    [path, limit, unreadOnly, synchronize, autoLoad],
  )

  useEffect(() => {
    const timer = autoLoad && path ? window.setTimeout(() => void load(), 0) : null
    return () => {
      generation.current += 1
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [autoLoad, load, path])

  useEffect(() => {
    if (!autoCount || !path) return
    const requestGeneration = generation.current
    const controller = new AbortController()
    const url = new URL(path, window.location.origin)
    url.searchParams.set("limit", "1")
    url.searchParams.set("unread", "true")
    void fetch(url, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Inbox is unavailable")
        const page = NOTIFICATION_PAGE_SCHEMA.parse(await response.json())
        if (!controller.signal.aborted && requestGeneration === generation.current) {
          setUnreadCount(page.unreadCount)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && requestGeneration === generation.current)
          setUnreadCount(0)
      })
    return () => controller.abort()
  }, [autoCount, path])

  useEffect(() => {
    if (!path || !synchronize) return
    return onInboxReadChanged(({ id, saved }) => {
      if (ownReadUpdate.current === saved) return
      setUnreadCount(saved.unreadCount)
      setNotifications((previous) =>
        previous.map((item) =>
          item.id === id && item.version < saved.version
            ? { ...item, version: saved.version, read: saved.read }
            : item,
        ),
      )
      if (loaded.current || autoLoad) void load()
      else generation.current += 1
    })
  }, [autoLoad, load, path, synchronize])

  function applyReadUpdate(id: number, saved: NotificationReadUpdate) {
    const visible = notifications.filter((item) => !unreadOnly || !item.read)
    setNotifications((previous) =>
      previous.map((item) =>
        item.id === id && item.version <= saved.version
          ? { ...item, version: saved.version, read: saved.read }
          : item,
      ),
    )
    setUnreadCount(saved.unreadCount)
    return (
      unreadOnly &&
      ((!saved.read && !notifications.some((item) => item.id === id)) ||
        (saved.read && visible.length === 1 && visible[0]?.id === id && saved.unreadCount > 0))
    )
  }

  async function toggleRead(notification: InboxNotification) {
    const requestGeneration = ++generation.current
    setLoading(true)
    setFailed(false)
    try {
      const response = await fetch(notification.updatePath, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": authenticityToken },
        body: JSON.stringify({
          notification: { read: !notification.read, version: notification.version },
        }),
      })
      if (!response.ok) throw new Error("Notification could not be updated")
      if (requestGeneration !== generation.current) return

      const saved = NOTIFICATION_READ_SCHEMA.parse(await response.json())
      if (requestGeneration !== generation.current) return
      if (saved.read !== !notification.read)
        throw new Error("Notification read state did not change")

      const needsReload = applyReadUpdate(notification.id, saved)
      if (synchronize) {
        ownReadUpdate.current = saved
        notifyInboxRead({ id: notification.id, saved })
      }
      callbacks.current.onReadChange?.(notification.id, saved)
      callbacks.current.onUnreadCountChange?.(saved.unreadCount)
      if (needsReload) {
        await load()
      } else {
        setLoading(false)
      }
    } catch {
      if (requestGeneration !== generation.current) return

      setNotifications([])
      loaded.current = false
      setUnreadCount(0)
      setNextBefore(null)
      setFailed(true)
      setLoading(false)
    }
  }

  return {
    notifications: notifications.filter((item) => !unreadOnly || !item.read),
    unreadCount,
    unreadOnly,
    loading,
    failed,
    hasMore: nextBefore !== null,
    onFilter: setUnreadOnly,
    onToggleRead: (id: number) => {
      const notification = notifications.find((item) => item.id === id)
      if (!notification) throw new Error("Notification is not in the loaded inbox")

      void toggleRead(notification)
    },
    onLoadMore: () => void load(nextBefore),
    onRetry: () => void load(),
    onOpen: () => void load(),
    onUnreadCountChange: setUnreadCount,
    onReadUpdate: (id: number, saved: NotificationReadUpdate) => {
      generation.current += 1
      const needsReload = applyReadUpdate(id, saved)
      if (loading || needsReload) {
        void load()
      } else {
        setLoading(false)
      }
    },
  }
}
