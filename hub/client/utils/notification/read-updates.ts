import type { NotificationReadUpdate } from "./types"

const eventName = "replica:notification-read"

interface Update {
  id: number
  saved: NotificationReadUpdate
}

export function notifyInboxRead(update: Update) {
  window.dispatchEvent(new CustomEvent(eventName, { detail: update }))
}

export function onInboxReadChanged(listener: (update: Update) => void) {
  function receive(event: Event) {
    listener((event as CustomEvent<Update>).detail)
  }
  window.addEventListener(eventName, receive)
  return () => window.removeEventListener(eventName, receive)
}
