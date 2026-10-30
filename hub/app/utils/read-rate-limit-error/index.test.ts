import { describe, expect, it } from "vitest"

import { readRateLimitError } from "."

describe("readRateLimitError()", () => {
  it("reads localized throttle guidance only from the expected response", async () => {
    const message = "No changes were made. Wait 60 seconds, then try again."
    expect(
      await readRateLimitError(
        Response.json({ code: "rate_limited", errors: [message], retryAfter: 60 }, { status: 429 }),
      ),
    ).toBe(message)
    expect(
      await readRateLimitError(Response.json({ errors: [message] }, { status: 403 })),
    ).toBeNull()
    expect(
      await readRateLimitError(
        Response.json({ code: "rate_limited", errors: [message], retryAfter: -1 }, { status: 429 }),
      ),
    ).toBeNull()
    expect(await readRateLimitError(new Response("invalid", { status: 429 }))).toBeNull()
  })
})
