import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"

import { verifyWebhookSignature } from "./index.ts"

const body = Buffer.from('{"action":"removed"}')
function sign(secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
}

describe("verifyWebhookSignature", () => {
  it("accepts a signature made with the webhook secret", () => {
    expect(verifyWebhookSignature("secret", body, sign("secret"))).toBe(true)
  })

  it("rejects other secrets, missing headers, and malformed values", () => {
    expect(verifyWebhookSignature("secret", body, sign("other"))).toBe(false)
    expect(verifyWebhookSignature("secret", body, undefined)).toBe(false)
    expect(verifyWebhookSignature("secret", body, "sha256=short")).toBe(false)
    expect(verifyWebhookSignature("", body, sign(""))).toBe(false)
  })
})
