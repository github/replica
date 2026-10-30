import { describe, expect, it } from "vitest"

import { createByteLimitedStringSchema } from "."

describe("createByteLimitedStringSchema()", () => {
  it("checks required prefixes and UTF-8 byte length", () => {
    const schema = createByteLimitedStringSchema(4, { prefix: "/", required: true })

    expect(schema.safeParse("/").success).toBe(true)
    expect(schema.safeParse("/é").success).toBe(true)
    expect(schema.safeParse("/éé").success).toBe(false)
    expect(schema.safeParse("path").success).toBe(false)
    expect(schema.safeParse("").success).toBe(false)
  })
})
