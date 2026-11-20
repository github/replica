import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { ApiRequestError } from "../api-request-error"
import { authorizeCopilotHandoff } from "."

const repositoryId = "11111111-1111-4111-8111-111111111111"

function respondWith(status: number) {
  vi.stubEnv("MODE", "development")
  const server = setupServer(
    http.get(`${window.location.origin}/api/repositories/${repositoryId}/create/permission`, () =>
      HttpResponse.json({ error: "Unavailable." }, { status }),
    ),
  )
  server.listen({ onUnhandledRequest: "error" })
  onTestFinished(() => server.close())
}

describe("authorizeCopilotHandoff()", () => {
  it("denies the handoff when the repository is no longer visible", async () => {
    respondWith(404)

    await expect(authorizeCopilotHandoff(repositoryId)).resolves.toBe(false)
  })

  it("reports an unavailable access check instead of a denial", async () => {
    respondWith(503)

    await expect(authorizeCopilotHandoff(repositoryId)).rejects.toMatchObject({
      constructor: ApiRequestError,
      status: 503,
    })
  })
})
