import type { Response } from "express"

/**
 * Holds byte reservations until the handler settles and the response finishes or
 * disconnects, whichever comes last. Reservations requested after the response ends are refused.
 */
export function trackResponseReservations(
  response: Pick<Response, "destroyed" | "writableFinished" | "once" | "off">,
  reserve: (byteLength: number) => (() => void) | null,
) {
  const reservations = new Set<() => void>()
  let settled = false
  let ended = response.destroyed || response.writableFinished
  function releaseAll() {
    if (!settled || !ended) return
    response.off("finish", onEnd)
    response.off("close", onEnd)
    for (const release of reservations) release()
  }
  function onEnd() {
    ended = true
    releaseAll()
  }
  response.once("finish", onEnd)
  response.once("close", onEnd)
  return {
    /** Returns a release function for early release, or null when refused. */
    reserve(this: void, byteLength: number): (() => void) | null {
      if (ended) return null
      const release = reserve(byteLength)
      if (!release) return null
      const releaseOnce = release
      function tracked() {
        if (!reservations.delete(tracked)) return
        releaseOnce()
      }
      reservations.add(tracked)
      return tracked
    },
    settle(this: void) {
      settled = true
      releaseAll()
    },
  }
}
