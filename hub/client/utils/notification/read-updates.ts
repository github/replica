import type { NotificationReadUpdate } from "./types"

const eventName = "replica:notification-read"

export interface InboxReadUpdate {
  viewerId: string
  id: number
  saved: NotificationReadUpdate
  startedAt: number
}

export function notifyInboxRead(update: InboxReadUpdate) {
  window.dispatchEvent(new CustomEvent(eventName, { detail: update }))
}

export function onInboxReadChanged(listener: (update: InboxReadUpdate) => void) {
  function receive(event: Event) {
    listener((event as CustomEvent<InboxReadUpdate>).detail)
  }
  window.addEventListener(eventName, receive)
  return () => window.removeEventListener(eventName, receive)
}
