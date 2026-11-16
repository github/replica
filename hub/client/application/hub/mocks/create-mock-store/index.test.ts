import { describe, expect, it } from "vitest"

import { prototypeSchema } from "../../contracts"
import seedData from "../seed.json"
import { createMockStore } from "."

describe("createMockStore()", () => {
  it("previews the latest successful Build rather than newer failed or running Builds", () => {
    const seed = structuredClone(seedData)
    const failed = seed.builds.find(
      ({ prototypeId, number }) => prototypeId === "1" && number === 2,
    )
    const running = seed.builds.find(({ prototypeId }) => prototypeId === "2")
    if (!failed || !running) throw new Error("The fixture needs failed and running Builds.")
    seed.builds.push({ ...failed, number: 4 }, { ...running, prototypeId: "1", number: 5 })
    const store = createMockStore({ origin: window.location.origin, seed })

    expect(store.getPrototype("2001", "1").selectedBuild?.number).toBe(3)
    expect(store.getPrototype("2001", "1", 1).selectedBuild?.number).toBe(1)
    expect(() => store.getPrototype("2001", "1", 4)).toThrow(
      expect.objectContaining({ status: 404 }),
    )
    expect(() => store.getPrototype("2001", "1", 5)).toThrow(
      expect.objectContaining({ status: 404 }),
    )
  })

  it("does not offer an unsuccessful Build as a preview when no successful Build exists", () => {
    const store = createMockStore({ origin: window.location.origin })

    expect(store.getPrototype("2001", "2").selectedBuild).toBeNull()
    expect(store.getPrototype("2001", "3").selectedBuild).toBeNull()
  })

  it("registers another prototype when existing identifiers include a UUID", () => {
    const seed = structuredClone(seedData)
    const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e"
    const original = seed.prototypes.find(({ id }) => id === "1")!
    original.id = uuid
    seed.prototypes.find(({ id }) => id === "2")!.id = "4"
    for (const build of seed.builds) {
      if (build.prototypeId === "1") build.prototypeId = uuid
      if (build.prototypeId === "2") build.prototypeId = "4"
    }
    const store = createMockStore({ origin: window.location.origin, seed })

    store.product.registerCandidate("2001", 9001, {
      name: "Exploration",
      description: null,
      startPage: null,
    })

    const registered = store.product.getManagement("2001").registered
    const created = registered.find(({ branchName }) => branchName === "prototype/exploration")
    expect(created?.name).toBe("Exploration")
    expect(prototypeSchema.safeParse(created).success).toBe(true)
    expect(new Set(registered.map(({ id }) => id)).size).toBe(registered.length)
  })
})
