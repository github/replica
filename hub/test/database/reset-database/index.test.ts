import { Socket } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { resetDatabase } from "."

describe("resetDatabase()", () => {
  it.each([
    "hub_development",
    "replica_test_0123456789abcdef",
    "replica_test_0123456789abcdef_0",
    "replica_test_0123456789abcdef_01",
    "replica_test_0123456789abcdef_-1",
    "replica_test_0123456789abcdef_1_other",
    "replica_test_0123456789abcdeg_1",
    "replica_test_0123456789ABCDEF_1",
    "replica_test_0123456789abcde_1",
    "replica_test_0123456789abcdef0_1",
  ])("refuses to reset %s before opening a database connection", async (databaseName) => {
    const connect = vi.spyOn(Socket.prototype, "connect").mockImplementation(() => {
      throw new Error("The unsafe database must not receive a network connection.")
    })

    await expect(resetDatabase(`postgresql://127.0.0.1:1/${databaseName}`)).rejects.toThrow()
    expect(connect).not.toHaveBeenCalled()
  })
})
