import { describe, expect, it, vi } from "vitest"

import { http, stubHubFetch } from "@/test/stub-hub-fetch"

import { previewRecords } from "../fixtures/preview-records"
import { clientAction, clientLoader } from "."

describe("prototype route", () => {
  it("rejects an invalid prototype ID before making a request", async () => {
    const send = vi.fn()
    vi.stubGlobal("fetch", send)
    const request = new Request(
      new URL("/repositories/2001/prototypes/bad", window.location.origin),
    )

    await expect(
      clientLoader({ request, params: { repositoryId: "2001", prototypeId: "bad" } }),
    ).rejects.toMatchObject({ status: 400 })
    expect(send).not.toHaveBeenCalled()
  })

  it("loads the prototype without waiting for applied learnings", async () => {
    const { historical, path, repository, prototype } = previewRecords()
    const readApplied = vi.fn()
    stubHubFetch(
      http.get(`${window.location.origin}/api${path}`, () =>
        Response.json({ repository, prototype, selectedBuild: historical }),
      ),
      http.get(
        `${window.location.origin}/api/repositories/${repository.id}/learnings/applied`,
        readApplied,
      ),
    )
    const request = new Request(new URL(`${path}?build=1`, window.location.origin))

    const result = await clientLoader({
      request,
      params: { repositoryId: repository.id, prototypeId: prototype.id },
    })

    expect(result.selectedBuild?.number).toBe(1)
    expect(readApplied).not.toHaveBeenCalled()
  })

  it("does not confirm a save when the API returns an invalid success response", async () => {
    const url = new URL("/api/repositories/2001/prototypes/1", window.location.origin)
    const respond = vi.fn(() => Response.json({ unexpected: "Not a prototype response." }))
    stubHubFetch(http.patch(url.href, respond))
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
