import { describe, expect, it, vi } from "vitest"

import { http, stubHubFetch } from "@/test/stub-hub-fetch"

import { previewRecords } from "../../routes/fixtures/preview-records"
import { getPrototype } from "."

describe("getPrototype()", () => {
  it("loads a minimized preview with its pinned Build and sends only preview parameters", async () => {
    const origin = "https://hub.example.test"
    const { historical, path, repository, prototype } = previewRecords()
    let receivedUrl: URL | undefined
    stubHubFetch(
      http.get(`${origin}/api${path}`, ({ request }) => {
        receivedUrl = new URL(request.url)
        return Response.json({ repository, prototype, selectedBuild: historical })
      }),
    )
    const search = new URLSearchParams({
      build: "1",
      view: "minimized",
      return_path: "/welcome?step=2#heading",
      "rc.workspace.showDescription": "false",
    })
    const request = new Request(`${origin}${path}?${search}`)

    const preview = await getPrototype(request, repository.id, prototype.id)

    expect(preview.selectedBuild?.number).toBe(1)
    expect(receivedUrl?.search).toBe("?build=1&view=minimized")
  })

  it.each(["gallery", "list"])("still loads a prototype with view=%s", async (view) => {
    const origin = "https://hub.example.test"
    const { historical, path, repository, prototype } = previewRecords()
    let receivedUrl: URL | undefined
    stubHubFetch(
      http.get(`${origin}/api${path}`, ({ request }) => {
        receivedUrl = new URL(request.url)
        return Response.json({ repository, prototype, selectedBuild: historical })
      }),
    )

    const preview = await getPrototype(
      new Request(`${origin}${path}?build=1&view=${view}`),
      repository.id,
      prototype.id,
    )

    expect(preview.selectedBuild?.number).toBe(1)
    expect(receivedUrl?.searchParams.has("view")).toBe(false)
  })

  it.each(["0", "not-a-build"])(
    "rejects build=%s with the existing route error before sending a request",
    async (build) => {
      const send = vi.fn()
      vi.stubGlobal("fetch", send)
      const request = new Request(
        `https://hub.example.test/repositories/2001/prototypes/1?view=minimized&build=${build}`,
      )

      const result = Promise.resolve().then(() => getPrototype(request, "2001", "1"))

      await expect(result).rejects.toBeInstanceOf(Response)
      await expect(result).rejects.toMatchObject({ status: 404 })
      expect(send).not.toHaveBeenCalled()
    },
  )

  it("forwards cancellation while loading a minimized preview", async () => {
    const origin = "https://hub.example.test"
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    stubHubFetch(
      http.get(`${origin}/api/repositories/2001/prototypes/1`, ({ request }) => {
        receivedSignal = request.signal
        controller.abort()
        return Response.error()
      }),
    )
    const request = new Request(`${origin}/repositories/2001/prototypes/1?build=1&view=minimized`, {
      signal: controller.signal,
    })

    await expect(getPrototype(request, "2001", "1")).rejects.toMatchObject({ name: "AbortError" })
    expect(receivedSignal?.aborted).toBe(true)
  })
})
