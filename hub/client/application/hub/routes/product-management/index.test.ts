import { describe, expect, it, vi } from "vitest"

import { clientAction } from "."

describe("product management clientAction()", () => {
  it("saves UUID prototypes and registers numeric candidates", async () => {
    const prototypeId = "0f8fad5b-d9cb-469f-a165-70867728950e"
    const send = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json({ notice: "Saved." })))
    vi.stubGlobal("fetch", send)

    for (const [kind, id, endpoint, method] of [
      ["prototypes", prototypeId, "prototype-management", "PATCH"],
      ["candidates", "9001", "prototype-candidates", "POST"],
    ] as const) {
      const request = new Request(
        new URL("/repositories/2001/prototypes/manage", window.location.origin),
        {
          method: "POST",
          body: new URLSearchParams({
            _action: `/repositories/2001/${kind}/${id}/registration`,
            _method: "patch",
            "prototype[name]": "Welcome",
            "prototype[description]": "",
            "prototype[start_page]": "",
          }),
        },
      )

      const result = await clientAction({ request, params: { repositoryId: "2001" } })
      expect(result.data.saved).toBe(true)
      expect(send).toHaveBeenLastCalledWith(
        new URL(`/api/repositories/2001/${endpoint}/${id}`, window.location.origin),
        expect.objectContaining({ method }),
      )
    }

    expect(send).toHaveBeenCalledTimes(2)
  })

  it("rejects invalid prototype and candidate IDs before sending a request", async () => {
    const send = vi.fn().mockResolvedValue(Response.json({ notice: "Saved." }))
    vi.stubGlobal("fetch", send)

    for (const action of [
      "/repositories/2001/prototypes/bad/registration",
      "/repositories/2001/candidates/0f8fad5b-d9cb-469f-a165-70867728950e/registration",
    ]) {
      const request = new Request(
        new URL("/repositories/2001/prototypes/manage", window.location.origin),
        {
          method: "POST",
          body: new URLSearchParams({
            _action: action,
            _method: "patch",
            "prototype[name]": "Welcome",
            "prototype[description]": "",
            "prototype[start_page]": "",
          }),
        },
      )

      const result = await clientAction({ request, params: { repositoryId: "2001" } })
      expect(result.init?.status).toBe(400)
    }

    expect(send).not.toHaveBeenCalled()
  })
})
