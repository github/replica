import { describe, expect, it } from "vitest"

import { sessionRevocationErrorMessage } from "."

describe("sessionRevocationErrorMessage()", () => {
  it("turns protocol reasons into recovery guidance and preserves server messages", () => {
    expect(sessionRevocationErrorMessage("expired")).toBe(
      "This authorization expired. Start the session revocation again.",
    )
    expect(sessionRevocationErrorMessage("session_mismatch")).toBe(
      "This authorization belongs to another browser session. Start the session revocation again.",
    )
    expect(sessionRevocationErrorMessage("verification_required")).toBe(
      "Provider verification is still required. Start the session revocation again.",
    )
    expect(sessionRevocationErrorMessage("The provider is unavailable.")).toBe(
      "The provider is unavailable.",
    )
  })
})
