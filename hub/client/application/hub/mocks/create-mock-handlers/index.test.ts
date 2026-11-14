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

  it("lets a member edit another author's details without granting management or sharing", async () => {
    vi.stubEnv("MODE", "development")
    const origin = "https://hub.example.test"
    const store = createMockStore({ origin })
    const server = setupServer(...createMockHandlers(store))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const request = new Request(`${origin}/repositories/2001/prototypes/2`)
    const original = await getPrototype(request, "2001", "2")

    const edited = await updatePrototype(request, "2001", "2", {
      name: "A teammate's edit",
      description: null,
      startPage: "/welcome?step=2#intro",
    })

    expect(edited.prototype).toMatchObject({
      name: "A teammate's edit",
      description: null,
      startPage: "/welcome?step=2#intro",
      authorLogin: original.prototype.authorLogin,
    })
    expect((await getPrototype(request, "2001", "2")).prototype).toEqual(edited.prototype)
    expect(() =>
      store.product.updateMetadata("2001", "2", {
        name: "A separate management edit",
        description: null,
        startPage: "/",
      }),
    ).toThrow(expect.objectContaining({ status: 403 }))
    expect(store.product.getShareLinks("2001", "2").canManage).toBe(false)
  })

  it("rejects a signed-out edit without changing saved details", async () => {
    vi.stubEnv("MODE", "development")
    const origin = "https://hub.example.test"
    const store = createMockStore({ origin })
    const original = store.getPrototype("2001", "1").prototype
    store.session.select("signed-out")
    const server = setupServer(...createMockHandlers(store))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const request = new Request(`${origin}/repositories/2001/prototypes/1`)

    await expect(
      updatePrototype(request, "2001", "1", {
        name: "An anonymous edit",
        description: null,
        startPage: "/",
      }),
    ).rejects.toMatchObject({ status: 401 })

    store.session.select("owner")
    expect(store.getPrototype("2001", "1").prototype).toEqual(original)
  })

  it("saves an implicit local route while preserving encoded spaces and percent signs", async () => {
    const origin = "https://hub.example.test"
    const store = createMockStore({ origin })
    const server = setupServer(...createMockHandlers(store))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const details = {
      name: "Welcome",
      description: null,
      startPage: "welcome%20back/100%25?label=50%25%20done#section%201",
    }

    const response = await fetch(`${origin}/api/repositories/2001/prototypes/1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(details),
    })

    expect(response.status).toBe(200)
    const expected = { ...details, startPage: `/${details.startPage}` }
    expect(await response.json()).toMatchObject({ prototype: expected })
    expect(store.getPrototype("2001", "1").prototype).toMatchObject(expected)
  })

  it("rejects a mock start page containing nested encoded traversal without saving it", async () => {
    const origin = "https://hub.example.test"
    const store = createMockStore({ origin })
    const original = store.getPrototype("2001", "1").prototype
    const server = setupServer(...createMockHandlers(store))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())

    const response = await fetch(`${origin}/api/repositories/2001/prototypes/1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Do not save this edit",
        description: null,
        startPage: "/%252e%252e/private",
      }),
    })

    expect(response.status).toBe(422)
    expect(store.getPrototype("2001", "1").prototype).toEqual(original)
  })

  it("rejects a mock start page inside a reserved internal directory without saving it", async () => {
    const origin = "https://hub.example.test"
    const store = createMockStore({ origin })
    const original = store.getPrototype("2001", "1").prototype
    const server = setupServer(...createMockHandlers(store))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())

    const response = await fetch(`${origin}/api/repositories/2001/prototypes/1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Do not save this edit",
        description: null,
        startPage: "/nested/.replica-internal/manifest.json",
      }),
    })

    expect(response.status).toBe(422)
    expect(store.getPrototype("2001", "1").prototype).toEqual(original)
  })

  it("rejects the reserved replica namespace before a query without saving it", async () => {
    const origin = "https://hub.example.test"
    const store = createMockStore({ origin })
    const original = store.getPrototype("2001", "1").prototype
    const server = setupServer(...createMockHandlers(store))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())

    const response = await fetch(`${origin}/api/repositories/2001/prototypes/1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Do not save this edit",
        description: null,
        startPage: "/__replica?asset=controls",
      }),
    })

    expect(response.status).toBe(422)
    expect(store.getPrototype("2001", "1").prototype).toEqual(original)
  })
})
