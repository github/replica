import { setupServer } from "msw/node"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { getPrototype } from "../../requests/get-prototype"
import { updatePrototype } from "../../requests/update-prototype"
import { createMockStore } from "../create-store"

import { createMockHandlers } from "."

describe("createMockHandlers()", () => {
  it("keeps edits in one document and reseeds a new mock store", async () => {
    vi.stubEnv("MODE", "development")
    const origin = "https://hub.example.test"
    const server = setupServer(...createMockHandlers(createMockStore({ origin })))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const request = new Request(`${origin}/repositories/2001/prototypes/1`)
    const original = await getPrototype(request, 2001, 1)

    await updatePrototype(request, 2001, 1, {
      name: "Only this document",
      description: "An edit that must not become the next document's seed.",
    })
    const edited = await getPrototype(request, 2001, 1)
    expect(edited.prototype.name).toBe("Only this document")

    server.resetHandlers(...createMockHandlers(createMockStore({ origin })))
    const reseeded = await getPrototype(request, 2001, 1)

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
    const original = await getPrototype(request, 2001, 2)
    expect(original.prototype.canEdit).toBe(false)

    await expect(
      updatePrototype(request, 2001, 2, {
        name: "An unauthorized edit",
        description: null,
      }),
    ).rejects.toMatchObject({ status: 403 })

    const unchanged = await getPrototype(request, 2001, 2)
    expect(unchanged.prototype).toMatchObject({
      name: original.prototype.name,
      description: original.prototype.description,
    })
  })
})
