import { setupServer } from "msw/node"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { prototypeResponseSchema } from "../../contracts"
import { getPrototype } from "../../requests/get-prototype"
import { getRepository } from "../../requests/get-repository"
import { getSession } from "../../requests/get-session"
import { updatePrototype } from "../../requests/update-prototype"
import { createMockStore } from "../create-mock-store"

import { createMockHandlers } from "."

describe("createMockHandlers()", () => {
  it("provides a local no-access notice for the recovery page", async () => {
    const origin = "https://hub.example.test"
    const server = setupServer(...createMockHandlers(createMockStore({ origin })))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())

    const response = await fetch(`${origin}/api/auth/session?explain_no_repository_access=1`)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      authenticated: false,
      login: "octocat",
      reason: "no_repository_access",
    })
  })

  it("serves a minimized pinned preview without consuming the prototype introduction", async () => {
    const origin = "https://hub.example.test"
    const server = setupServer(...createMockHandlers(createMockStore({ origin })))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const url = `${origin}/api/repositories/2001/prototypes/1?build=1`

    const response = await fetch(`${url}&view=minimized`)

    expect(response.status).toBe(200)
    const preview = prototypeResponseSchema.parse(await response.json())
    expect(preview.selectedBuild?.number).toBe(1)
    expect(preview.showPrototypeInfo).toBe(false)

    const regularResponse = await fetch(url)
    const regularPreview = prototypeResponseSchema.parse(await regularResponse.json())
    expect(regularPreview.showPrototypeInfo).toBe(true)
  })

  it("rejects a fractional Build identifier on a minimized preview", async () => {
    const origin = "https://hub.example.test"
    const server = setupServer(...createMockHandlers(createMockStore({ origin })))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())

    const response = await fetch(
      `${origin}/api/repositories/2001/prototypes/1?view=minimized&build=1.5`,
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid request filters." })
  })

  it("keeps minimized out of repository listing views at both request boundaries", async () => {
    const origin = "https://hub.example.test"
    const server = setupServer(...createMockHandlers(createMockStore({ origin })))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const request = new Request(`${origin}/repositories/2001?view=minimized`)

    const result = Promise.resolve().then(() => getRepository(request, "2001"))

    await expect(result).rejects.toBeInstanceOf(Response)
    await expect(result).rejects.toMatchObject({ status: 400 })
    const response = await fetch(`${origin}/api/repositories/2001?view=minimized`)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid request filters." })
  })

  it("keeps development settings out of product requests and the session response", async () => {
    vi.stubEnv("MODE", "development")
    const origin = "https://hub.example.test"
    const server = setupServer(...createMockHandlers(createMockStore({ origin })))
    const requests: Request[] = []
    server.events.on("request:start", ({ request }) => requests.push(request.clone()))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const request = new Request(`${origin}/repositories/2001/prototypes/1?mockScenario=forbidden`)

    const session = await getSession(request)
    await getPrototype(request, "2001", "1")
    await getRepository(request, "2001")
    await updatePrototype(request, "2001", "1", {
      name: "A normal product edit",
      description: null,
    })
    const response = await fetch(`${origin}/api/session`)
    const publicSession: unknown = await response.json()

    expect(session.viewer).not.toBeNull()
    expect(publicSession).toMatchObject({
      viewer: session.viewer,
      capabilities: session.capabilities,
    })
    expect(publicSession).not.toHaveProperty("profile")
    expect(publicSession).not.toHaveProperty("revision")
    for (const outgoing of requests) {
      expect(
        [...outgoing.headers.keys()].some((name) =>
          name.toLowerCase().startsWith("x-replica-mock"),
        ),
      ).toBe(false)
      expect(new URL(outgoing.url).searchParams.has("mockScenario")).toBe(false)
    }
    const mutation = requests.find(({ method }) => method === "PATCH")
    if (!mutation) throw new Error("The product edit must send its request.")
    expect(await mutation.json()).toEqual({
      name: "A normal product edit",
      description: null,
    })
  })

  it("keeps edits in one document and reseeds a new mock store", async () => {
    vi.stubEnv("MODE", "development")
    const origin = "https://hub.example.test"
    const server = setupServer(...createMockHandlers(createMockStore({ origin })))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const request = new Request(`${origin}/repositories/2001/prototypes/1`)
    const original = await getPrototype(request, "2001", "1")

    await updatePrototype(request, "2001", "1", {
      name: "Only this document",
      description: "An edit that must not become the next document's seed.",
    })
    const edited = await getPrototype(request, "2001", "1")
    expect(edited.prototype.name).toBe("Only this document")

    server.resetHandlers(...createMockHandlers(createMockStore({ origin })))
    const reseeded = await getPrototype(request, "2001", "1")

    expect(reseeded.prototype).toMatchObject({
      name: original.prototype.name,
      description: original.prototype.description,
    })
  })

  it("rejects an edit to another author's prototype without changing it", async () => {
    vi.stubEnv("MODE", "development")
    const origin = "https://hub.example.test"
    const server = setupServer(...createMockHandlers(createMockStore({ origin })))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const request = new Request(`${origin}/repositories/2001/prototypes/2`)
    const original = await getPrototype(request, "2001", "2")
    expect(original.prototype.canEdit).toBe(false)

    await expect(
      updatePrototype(request, "2001", "2", {
        name: "An unauthorized edit",
        description: null,
      }),
    ).rejects.toMatchObject({ status: 403 })

    const unchanged = await getPrototype(request, "2001", "2")
    expect(unchanged.prototype).toMatchObject({
      name: original.prototype.name,
      description: original.prototype.description,
    })
  })
})
