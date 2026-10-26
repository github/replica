import { describe, expect, it } from "vitest"

import { createLogger } from "../create-logger"

import { log } from "."

describe("log()", () => {
  it("writes the selected level, message, and sanitized fields to the supplied logger", () => {
    const lines: string[] = []
    const logger = createLogger({ destination: { write: (line) => lines.push(line) } })
    const fields = { task: "rebuild", nested: { password: "helper-secret" } }

    log("warn", "Rebuild delayed", fields, logger)

    expect(lines).toHaveLength(1)
    const record: unknown = JSON.parse(lines.join(""))
    expect(record).toMatchObject({
      level: 40,
      msg: "Rebuild delayed",
      task: "rebuild",
      nested: { password: "[REDACTED]" },
    })
    expect(fields.nested.password).toBe("helper-secret")
  })
})
