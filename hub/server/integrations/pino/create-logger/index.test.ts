import { describe, expect, it } from "vitest"

import { createLogger } from "."

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parseRecord(line: string) {
  const value: unknown = JSON.parse(line)
  if (!isRecord(value)) throw new Error("Expected a JSON log object")
  return value
}

describe("createLogger()", () => {
  it("writes real JSON records and applies the configured level", () => {
    const lines: string[] = []
    const logger = createLogger({
      level: "warn",
      destination: { write: (line) => lines.push(line) },
    })

    logger.info("Not emitted")
    logger.warn({ count: 2 }, "Needs attention")

    expect(lines).toHaveLength(1)
    const record = parseRecord(lines.join(""))
    expect(record).toMatchObject({
      level: 40,
      msg: "Needs attention",
      count: 2,
    })
    expect(record).toHaveProperty("time", expect.any(Number))
    expect(record).toHaveProperty("name", expect.any(String))
  })

  it("sanitizes structured fields from direct and child logger calls", () => {
    const lines: string[] = []
    const logger = createLogger({ destination: { write: (line) => lines.push(line) } })
    const input = { nested: [{ password: "direct-secret", visible: true }] }

    logger.info(input, "Direct")
    logger
      .child({ component: "worker" })
      .info(
        { access_token: "child-token-secret", data: { "client-secret": "child-secret" } },
        "Child",
      )

    expect(lines.map((line) => parseRecord(line))).toMatchObject([
      {
        nested: [{ password: "[REDACTED]", visible: true }],
        msg: "Direct",
      },
      {
        access_token: "[REDACTED]",
        component: "worker",
        data: { "client-secret": "[REDACTED]" },
        msg: "Child",
      },
    ])
    expect(lines.join("")).not.toMatch(/direct-secret|child-token-secret|child-secret/)
    expect(input.nested[0]?.password).toBe("direct-secret")
  })

  it("serializes an Error without leaking its sensitive enumerable fields", () => {
    const lines: string[] = []
    const logger = createLogger({ destination: { write: (line) => lines.push(line) } })
    const error = Object.assign(new Error("Operation failed"), {
      password: "error-secret",
      context: { access_token: "nested-error-secret" },
    })

    logger.error({ err: error }, "Failed")

    expect(lines).toHaveLength(1)
    expect(parseRecord(lines.join(""))).toMatchObject({
      level: 50,
      err: { message: "Operation failed" },
    })
    expect(lines[0]).not.toMatch(/error-secret|nested-error-secret/)
    expect(error.password).toBe("error-secret")
  })

  it("bounds each structured field without dropping unrelated fields or the message", () => {
    const lines: string[] = []
    const logger = createLogger({ destination: { write: (line) => lines.push(line) } })
    const oversized = Array.from({ length: 6 }, () => "\u754c".repeat(1800))

    logger.info({ oversized, task: "rebuild" }, "Task started")

    expect(lines).toHaveLength(1)
    const record = parseRecord(lines.join(""))
    expect(record).toMatchObject({ task: "rebuild", msg: "Task started" })
    expect(record).toHaveProperty("oversized")
    expect(Buffer.byteLength(JSON.stringify(record.oversized), "utf8")).toBeLessThanOrEqual(8192)
  })
})
