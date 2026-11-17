import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { productShareIdSchema, productShareLinkSchema, productTemplateIdSchema } from "."

describe("product identifier schemas", () => {
  it("accepts opaque route identifiers without imposing the mock generator's format", () => {
    const identifiers = ["default", "prototype-1", "Template_2.v3~draft", "A".repeat(81)]

    for (const identifier of identifiers) {
      expect(productTemplateIdSchema.parse(identifier)).toBe(identifier)
      expect(productShareIdSchema.parse(identifier)).toBe(identifier)
    }
  })

  it("rejects identifiers that could change the URL path or query", () => {
    const identifiers = ["", ".", "..", "one/two", "one\\two", "one?two", "one#two", "%2F"]

    for (const identifier of identifiers) {
      expect(productTemplateIdSchema.safeParse(identifier).success).toBe(false)
      expect(productShareIdSchema.safeParse(identifier).success).toBe(false)
    }
  })

  it("accepts the UUID identity returned by the real sharing API", () => {
    const id = randomUUID()

    expect(
      productShareLinkSchema.parse({
        id,
        shareId: randomUUID(),
        repositoryId: randomUUID(),
        prototypeId: randomUUID(),
        buildNumber: 1,
        label: "Partner review",
        createdBy: "local-developer",
        createdAt: "2026-11-17T18:00:00.000Z",
        expiresAt: "2026-11-18T18:00:00.000Z",
        revokedAt: null,
      }).id,
    ).toBe(id)
  })
})
