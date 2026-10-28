import { Socket } from "node:net"
import pino from "pino"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { createJobProcessor } from "../create-job-processor"
import { createJobWorker } from "."

describe("createJobWorker()", () => {
  it("rejects duplicate processor names before opening a database connection", () => {
    const connect = vi.spyOn(Socket.prototype, "connect").mockImplementation(() => {
      throw new Error("Invalid workers must not open a database connection.")
    })
    const first = createJobProcessor(
      { name: "duplicate", schema: z.object({ count: z.number() }) },
      ({ count }) => Promise.resolve(count),
    )
    const second = createJobProcessor(
      { name: "duplicate", schema: z.object({ label: z.string() }) },
      ({ label }) => Promise.resolve(label),
    )

    expect(() =>
      createJobWorker({
        name: "on-demand",
        databaseUrl: "postgresql://127.0.0.1:1/unreachable",
        logger: pino({ level: "silent" }),
        processors: [first, second],
      }),
    ).toThrow()
    expect(connect).not.toHaveBeenCalled()
  })

  it("imports the job entry points without configuration or network access", async () => {
    vi.stubEnv("DATABASE_URL", undefined)
    const connect = vi.spyOn(Socket.prototype, "connect").mockImplementation(() => {
      throw new Error("Importing job modules must not open a connection.")
    })

    await Promise.all([
      import("../create-job-queue"),
      import("../create-job-worker"),
      import("../migrate-job-database"),
      import("../upsert-job-schedule"),
    ])

    expect(connect).not.toHaveBeenCalled()
  })
})
