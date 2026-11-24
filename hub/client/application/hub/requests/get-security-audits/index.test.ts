import { describe, expect, it } from "vitest"

import { http, stubHubFetch } from "@/test/stub-hub-fetch"
import { getSecurityAudits } from "."

describe("getSecurityAudits()", () => {
  it("requests exactly 50 records and preserves an opaque cursor as one encoded parameter", async () => {
    const origin = "https://hub.example.test"
    const cursor = "opaque+/cursor==&unchanged"
    let receivedUrl: URL | undefined
    stubHubFetch(
      http.get(`${origin}/api/security-audits`, ({ request }) => {
        receivedUrl = new URL(request.url)
        return Response.json({ records: [], nextCursor: null })
      }),
    )

    await getSecurityAudits(new Request(`${origin}/settings/audit?scope=hub`), cursor)

    expect(receivedUrl?.pathname).toBe("/api/security-audits")
    expect(receivedUrl?.search).toBe(`?limit=50&before=${encodeURIComponent(cursor)}`)
    expect(receivedUrl?.searchParams.get("before")).toBe(cursor)
  })

  it("omits before on the first page", async () => {
    const origin = "https://hub.example.test"
    let receivedUrl: URL | undefined
    stubHubFetch(
      http.get(`${origin}/api/security-audits`, ({ request }) => {
        receivedUrl = new URL(request.url)
        return Response.json({ records: [], nextCursor: null })
      }),
    )

    await getSecurityAudits(new Request(`${origin}/settings/audit?scope=hub`))

    expect(receivedUrl?.search).toBe("?limit=50")
  })
})
