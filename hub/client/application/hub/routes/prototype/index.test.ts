import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { clientAction } from "."

describe("prototype clientAction()", () => {
  it("does not confirm a save when the API returns an invalid success response", async () => {
    vi.stubEnv("MODE", "development")
    const url = new URL("/api/repositories/2001/prototypes/1", window.location.origin)
    const respond = vi.fn(() => HttpResponse.json({ unexpected: "Not a prototype response." }))
    const server = setupServer(http.patch(url.href, respond))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const request = new Request(
      new URL("/repositories/2001/prototypes/1", window.location.origin),
      {
        method: "POST",
        body: new URLSearchParams({
          name: "Welcome revised",
          description: "A revised welcome flow.",
        }),
      },
    )

    const result = await clientAction({
      request,
      params: { repositoryId: "2001", prototypeId: "1" },
    })

    expect(respond).toHaveBeenCalledOnce()
    expect(result.data.saved).toBe(false)
    expect(result.data.saved ? null : result.data.error).toMatch(/\S/)
    expect(result.init?.status).toBe(502)
  })
})
