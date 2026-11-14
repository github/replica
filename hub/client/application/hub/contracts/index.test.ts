import { describe, expect, it } from "vitest"

import { buildSchema, prototypeEditSchema, recordIdentifierSchema } from "."

describe("buildSchema", () => {
  it("accepts full SHA-1 and SHA-256 object names without requiring lowercase", () => {
    const commits = ["a".repeat(40), "B".repeat(40), "c".repeat(64), "D".repeat(64)]

    for (const commit of commits) {
      expect(buildSchema.shape.commitSha.parse(commit)).toBe(commit)
    }
  })

  it("rejects incomplete or non-hexadecimal object names", () => {
    const commits = ["", "a".repeat(7), "a".repeat(41), "a".repeat(63), "g".repeat(40)]

    for (const commit of commits) {
      expect(buildSchema.shape.commitSha.safeParse(commit).success).toBe(false)
    }
  })
})

describe("recordIdentifierSchema", () => {
  it("rejects identifiers that are not positive numbers or UUIDs", () => {
    const ids = ["", 2001, "0", "../2001", "not-a-uuid"]

    for (const id of ids) {
      expect(recordIdentifierSchema.safeParse(id).success).toBe(false)
    }
  })
})

describe("prototypeEditSchema", () => {
  it("rejects a name longer than 255 Unicode characters", () => {
    const details = { name: "🧪".repeat(256), description: null, startPage: "/" }

    expect(prototypeEditSchema.safeParse(details).success).toBe(false)
  })

  it("rejects a description longer than 500 Unicode characters", () => {
    const details = { name: "Welcome", description: "🧪".repeat(501), startPage: "/" }

    expect(prototypeEditSchema.safeParse(details).success).toBe(false)
  })

  it("rejects a start page over the UTF-8 byte limit even with fewer characters", () => {
    const details = {
      name: "Welcome",
      description: null,
      startPage: `/${"é".repeat(1024)}`,
    }

    expect(prototypeEditSchema.safeParse(details).success).toBe(false)
  })

  it("counts an implicit leading slash toward the start page byte limit", () => {
    const details = {
      name: "Welcome",
      description: null,
      startPage: "é".repeat(1024),
    }

    expect(prototypeEditSchema.safeParse(details).success).toBe(false)
  })

  it("rejects an external start page", () => {
    const details = {
      name: "Welcome",
      description: null,
      startPage: "//external.example.test/welcome",
    }

    expect(prototypeEditSchema.safeParse(details).success).toBe(false)
  })

  it("does not turn an absolute external URL into an implicit local route", () => {
    const details = {
      name: "Welcome",
      description: null,
      startPage: "https://external.example.test/welcome",
    }

    expect(prototypeEditSchema.safeParse(details).success).toBe(false)
  })

  it("rejects a start page containing a control character", () => {
    const details = { name: "Welcome", description: null, startPage: "/welcome\u0000next" }

    expect(prototypeEditSchema.safeParse(details).success).toBe(false)
  })

  it("rejects a start page containing a backslash", () => {
    const details = { name: "Welcome", description: null, startPage: "/welcome\\next" }

    expect(prototypeEditSchema.safeParse(details).success).toBe(false)
  })
})
