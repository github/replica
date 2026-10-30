import { describe, expect, it } from "vitest"

import { createKnownRequestError } from "../../../test/prisma/create-known-request-error"
import { classifyPrismaTransactionError } from "."

describe("classifyPrismaTransactionError()", () => {
  it.each(["P2002", "P2034"])("classifies %s as retryable", (code) => {
    expect(classifyPrismaTransactionError(createKnownRequestError(code))).toBe("retryable")
  })

  it("classifies other known errors as terminal", () => {
    expect(classifyPrismaTransactionError(createKnownRequestError("P2003"))).toBe("terminal")
  })

  it("classifies unrelated errors as unknown", () => {
    expect(classifyPrismaTransactionError(new Error("unrelated"))).toBe("unknown")
  })
})
