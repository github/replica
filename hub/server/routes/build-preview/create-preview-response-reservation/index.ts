import type { Response } from "express"

import { reserveBuildPreviewBytes } from "../../../domains/build-preview/reserve-build-preview-bytes/index.ts"

export function createPreviewResponseReservation(response: Response) {
  const reservations = new Set<() => void>()
  let handlingRequest = true
  let responseEnded = response.destroyed || response.writableFinished

  function releaseReservations() {
    // A disconnected response can still have an uncancelled storage read in flight.
    if (handlingRequest || !responseEnded) return
    response.off("finish", onResponseEnd)
    response.off("close", onResponseEnd)
    for (const release of reservations) release()
  }

  function onResponseEnd() {
    responseEnded = true
    releaseReservations()
  }

  response.once("finish", onResponseEnd)
  response.once("close", onResponseEnd)

  function reserveBytes(byteLength: number) {
    if (responseEnded) return null
    const reservation = reserveBuildPreviewBytes(byteLength)
    if (!reservation) return null
    const release = reservation
    function trackedRelease() {
      reservations.delete(trackedRelease)
      release()
    }
    reservations.add(trackedRelease)
    return trackedRelease
  }

  function completeRequest() {
    handlingRequest = false
    releaseReservations()
  }

  return { reserveBytes, completeRequest }
}
