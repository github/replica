import { describe, expect, it, vi } from "vitest"

import { http, stubHubFetch } from "@/test/stub-hub-fetch"

import { previewRecords } from "../fixtures/preview-records"
import { clientAction } from "."

describe("product management clientAction()", () => {
  it("saves a UUID prototype listing through the live listing endpoint", async () => {
    const prototypeId = "0f8fad5b-d9cb-469f-a165-70867728950e"
    const { repository, prototype } = previewRecords({ prototypeId })
    const saved = vi.fn()
    stubHubFetch(
      http.patch(
        `/api/repositories/2001/prototype-management/${prototypeId}`,
        async ({ request }) => {
          saved(await request.json())
          return Response.json({ repository, prototype, selectedBuild: null })
        },
      ),
    )
    const request = listingForm(`/repositories/2001/prototypes/${prototypeId}/registration`)

    const result = await clientAction({ request, params: { repositoryId: "2001" } })

    expect(result.data.saved).toBe(true)
    expect(saved).toHaveBeenCalledExactlyOnceWith({
      name: "Welcome",
      description: null,
      startPage: "/",
    })
  })

  it("rejects an invalid prototype ID and the retired candidate action before sending a request", async () => {
    const send = vi.fn().mockResolvedValue(Response.json({ notice: "Saved." }))
    vi.stubGlobal("fetch", send)

    for (const action of [
      "/repositories/2001/prototypes/bad/registration",
      "/repositories/2001/candidates/9001/registration",
    ]) {
      const request = listingForm(action)

      const result = await clientAction({ request, params: { repositoryId: "2001" } })
      expect(result.init?.status).toBe(400)
    }

    expect(send).not.toHaveBeenCalled()
  })

  function listingForm(action: string) {
    return new Request(new URL("/repositories/2001/prototypes/manage", window.location.origin), {
      method: "POST",
      body: new URLSearchParams({
        _action: action,
        _method: "patch",
        "prototype[name]": "Welcome",
        "prototype[description]": "",
        "prototype[start_page]": "",
      }),
    })
  }
})
