import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { getSecurityAudits } from "."

describe("getSecurityAudits()", () => {
  it("requests exactly 50 records and preserves an opaque cursor as one encoded parameter", async () => {
    vi.stubEnv("MODE", "development")
    const origin = "https://hub.example.test"
    const cursor = "opaque+/cursor==&unchanged"
    let receivedUrl: URL | undefined
    const server = setupServer(
      http.get(`${origin}/api/security-audits`, ({ request }) => {
        receivedUrl = new URL(request.url)
        return HttpResponse.json({ records: [], nextCursor: null })
      }),
    )
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())

    await getSecurityAudits(new Request(`${origin}/settings/audit?scope=hub`), cursor)

    expect(receivedUrl?.pathname).toBe("/api/security-audits")
    expect(receivedUrl?.search).toBe(`?limit=50&before=${encodeURIComponent(cursor)}`)
    expect(receivedUrl?.searchParams.get("before")).toBe(cursor)
  })

  it("omits before on the first page", async () => {
    vi.stubEnv("MODE", "development")
    const origin = "https://hub.example.test"
    let receivedUrl: URL | undefined
    const server = setupServer(
      http.get(`${origin}/api/security-audits`, ({ request }) => {
        receivedUrl = new URL(request.url)
        return HttpResponse.json({ records: [], nextCursor: null })
      }),
    )
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())

    await getSecurityAudits(new Request(`${origin}/settings/audit?scope=hub`))

    expect(receivedUrl?.search).toBe("?limit=50")
  })
})
