import { useCallback, useEffect, useRef, useState } from "react"

import { NOTIFICATION_PAGE_SCHEMA, NOTIFICATION_READ_SCHEMA } from "@utils/notification/schemas"
import type { InboxNotification, NotificationReadUpdate } from "@utils/notification/types"

export function useNotificationInbox({
  path,
  authenticityToken,
  initialUnreadCount = 0,
  initialUnreadOnly = false,
  autoLoad = true,
  limit = 50,
  onReadChange,
  onUnreadCountChange,
}: {
  path: string | undefined
  authenticityToken: string
  initialUnreadCount?: number
  initialUnreadOnly?: boolean
  autoLoad?: boolean
  limit?: number
  onReadChange?: (id: number, saved: NotificationReadUpdate) => void
  onUnreadCountChange?: (count: number) => void
}) {
  const [unreadOnly, setUnreadOnly] = useState(initialUnreadOnly)
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
  const callbacks = useRef({ onReadChange, onUnreadCountChange })
  useEffect(() => {
    callbacks.current = { onReadChange, onUnreadCountChange }
  }, [onReadChange, onUnreadCountChange])

  useEffect(() => {
    loaded.current = false
  }, [path])

  const load = useCallback(
    async (before: number | null = null) => {
      if (!path) return

      const requestGeneration = ++generation.current
      setLoading(before !== null || !loaded.current)
      setFailed(false)
      try {
        const url = new URL(path, window.location.origin)
        url.searchParams.set("limit", String(limit))
        if (unreadOnly) url.searchParams.set("unread", "true")
        if (before !== null) url.searchParams.set("before", String(before))
        const response = await fetch(url, { credentials: "same-origin" })
        if (!response.ok) throw new Error("Inbox is unavailable")

        const page = NOTIFICATION_PAGE_SCHEMA.parse(await response.json())
        if (requestGeneration !== generation.current) return

        loaded.current = true
        setNotifications((previous) => {
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
        setUnreadCount(0)
        setNextBefore(null)
        setFailed(true)
      } finally {
        if (requestGeneration === generation.current) setLoading(false)
      }
    },
    [path, limit, unreadOnly],
  )

  useEffect(() => {
    const timer = autoLoad && path ? window.setTimeout(() => void load(), 0) : null
    return () => {
      generation.current += 1
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [autoLoad, load, path])

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
