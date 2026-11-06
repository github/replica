import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createMockStore } from "@application/hub/mocks/create-mock-store"

import { getPrototype } from "."

describe("getPrototype()", () => {
  it("loads a minimized preview with its pinned Build and sends only preview parameters", async () => {
    vi.stubEnv("MODE", "development")
    const origin = "https://hub.example.test"
    const store = createMockStore({ origin })
    let receivedUrl: URL | undefined
    const server = setupServer(
      http.get(`${origin}/api/repositories/2001/prototypes/1`, ({ request }) => {
        receivedUrl = new URL(request.url)
        return HttpResponse.json(store.getPrototype(2001, 1, 1, true))
      }),
    )
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const search = new URLSearchParams({
      build: "1",
      view: "minimized",
      return_path: "/welcome?step=2#heading",
      "rc.workspace.showDescription": "false",
    })
    const request = new Request(`${origin}/repositories/2001/prototypes/1?${search}`)

    const preview = await getPrototype(request, 2001, 1)

    expect(preview.selectedBuild?.number).toBe(1)
    expect(receivedUrl?.search).toBe("?build=1&view=minimized")
  })

  it.each(["gallery", "list"])("still loads a prototype with view=%s", async (view) => {
    vi.stubEnv("MODE", "development")
    const origin = "https://hub.example.test"
    const store = createMockStore({ origin })
    let receivedUrl: URL | undefined
    const server = setupServer(
      http.get(`${origin}/api/repositories/2001/prototypes/1`, ({ request }) => {
        receivedUrl = new URL(request.url)
        return HttpResponse.json(store.getPrototype(2001, 1, 1))
      }),
    )
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())

    const preview = await getPrototype(
      new Request(`${origin}/repositories/2001/prototypes/1?build=1&view=${view}`),
      2001,
      1,
    )

    expect(preview.selectedBuild?.number).toBe(1)
    expect(receivedUrl?.searchParams.has("view")).toBe(false)
  })

  it.each(["0", "not-a-build"])(
    "rejects build=%s with the existing route error before sending a request",
    async (build) => {
      const request = new Request(
        `https://hub.example.test/repositories/2001/prototypes/1?view=minimized&build=${build}`,
      )

      const result = Promise.resolve().then(() => getPrototype(request, 2001, 1))

      await expect(result).rejects.toBeInstanceOf(Response)
      await expect(result).rejects.toMatchObject({ status: 400 })
    },
  )

  it("forwards cancellation while loading a minimized preview", async () => {
    vi.stubEnv("MODE", "development")
    const origin = "https://hub.example.test"
    const store = createMockStore({ origin })
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const server = setupServer(
      http.get(`${origin}/api/repositories/2001/prototypes/1`, ({ request }) => {
        receivedSignal = request.signal
        controller.abort()
        return HttpResponse.json(store.getPrototype(2001, 1, 1, true))
      }),
    )
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const request = new Request(`${origin}/repositories/2001/prototypes/1?build=1&view=minimized`, {
      signal: controller.signal,
    })

    await expect(getPrototype(request, 2001, 1)).rejects.toMatchObject({ name: "AbortError" })
    expect(receivedSignal?.aborted).toBe(true)
  })
})
