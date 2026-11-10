import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { ApiRequestError } from "../api-request-error"
import { getCurrentHubSession } from "."

describe("getCurrentHubSession()", () => {
  it("reports an ended session as an HTTP 401 request error", async () => {
    vi.stubEnv("MODE", "development")
    const url = new URL("https://hub.example.test/settings/administrators")
    const server = setupServer(
      http.get("https://hub.example.test/api/auth/session", () =>
        HttpResponse.json({ authenticated: false }, { status: 401 }),
      ),
    )
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())

    const result = getCurrentHubSession(new Request(url))

    await expect(result).rejects.toBeInstanceOf(ApiRequestError)
    await expect(result).rejects.toMatchObject({ status: 401, message: "Sign in to continue." })
  })
})
