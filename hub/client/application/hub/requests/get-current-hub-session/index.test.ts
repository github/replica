import { describe, expect, it } from "vitest"

import { http, stubHubFetch } from "@/test/stub-hub-fetch"
import { ApiRequestError } from "../api-request-error"
import { getCurrentHubSession } from "."

describe("getCurrentHubSession()", () => {
  it("reports an ended session as an HTTP 401 request error", async () => {
    const url = new URL("https://hub.example.test/settings/administrators")
    stubHubFetch(
      http.get("https://hub.example.test/api/auth/session", () =>
        Response.json({ authenticated: false }, { status: 401 }),
      ),
    )

    const result = getCurrentHubSession(new Request(url))

    await expect(result).rejects.toBeInstanceOf(ApiRequestError)
    await expect(result).rejects.toMatchObject({ status: 401, message: "Sign in to continue." })
  })
})
