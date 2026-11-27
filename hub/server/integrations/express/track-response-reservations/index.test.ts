import { EventEmitter } from "node:events"
import type { Response } from "express"
import { describe, expect, it, vi } from "vitest"

import { trackResponseReservations } from "."

function createResponse({ destroyed = false } = {}) {
  const response = Object.assign(new EventEmitter(), { destroyed, writableFinished: false })
  return response as typeof response & Response
}

function createAllowance(capacity = Number.POSITIVE_INFINITY) {
  let held = 0
  const reserve = vi.fn((byteLength: number) => {
    if (held + byteLength > capacity) return null
    held += byteLength
    return () => {
      held -= byteLength
    }
  })
  return { reserve, held: () => held }
}

describe("trackResponseReservations()", () => {
  it("holds reservations after the response finishes until the handler settles", () => {
    const response = createResponse()
    const allowance = createAllowance()
    const reservations = trackResponseReservations(response, allowance.reserve)
    reservations.reserve(5)

    response.emit("finish")
    expect(allowance.held()).toBe(5)
    reservations.settle()

    expect(allowance.held()).toBe(0)
  })

  it("holds reservations after the handler settles until the client disconnects", () => {
    const response = createResponse()
    const allowance = createAllowance()
    const reservations = trackResponseReservations(response, allowance.reserve)
    reservations.reserve(5)

    reservations.settle()
    expect(allowance.held()).toBe(5)
    response.emit("close")

    expect(allowance.held()).toBe(0)
  })

  it.each([
    { name: "after it closes", destroyed: false, close: true },
    { name: "when it was already destroyed", destroyed: true, close: false },
  ])("refuses reservations for a response $name", ({ destroyed, close }) => {
    const response = createResponse({ destroyed })
    const allowance = createAllowance()
    const reservations = trackResponseReservations(response, allowance.reserve)
    if (close) response.emit("close")

    expect(reservations.reserve(5)).toBeNull()
    expect(allowance.reserve).not.toHaveBeenCalled()
  })

  it("refuses a reservation the shared allowance cannot hold", () => {
    const response = createResponse()
    const allowance = createAllowance(4)
    const reservations = trackResponseReservations(response, allowance.reserve)

    expect(reservations.reserve(5)).toBeNull()
    expect(allowance.held()).toBe(0)
  })

  it("does not release an early-released reservation again when the response ends", () => {
    const response = createResponse()
    const allowance = createAllowance()
    const reservations = trackResponseReservations(response, allowance.reserve)
    const release = reservations.reserve(5)
    reservations.reserve(3)

    release?.()
    expect(allowance.held()).toBe(3)
    reservations.settle()
    response.emit("finish")

    expect(allowance.held()).toBe(0)
  })
})
