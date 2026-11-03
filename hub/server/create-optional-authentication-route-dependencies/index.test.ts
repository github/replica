import { describe, expect, it } from "vitest"

import { createOptionalAuthenticationRouteDependencies } from "."

describe("createOptionalAuthenticationRouteDependencies()", () => {
  it("does not load database-backed authentication when authentication is disabled", async () => {
    await expect(createOptionalAuthenticationRouteDependencies({})).resolves.toBeUndefined()
  })
})
