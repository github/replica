import { describe, expect, it } from "vitest"

import seedData from "../seed.json"
import { createMockStore } from "."

describe("createMockStore()", () => {
  it("previews the latest successful Build rather than newer failed or running Builds", () => {
    const seed = structuredClone(seedData)
    const failed = seed.builds.find(({ prototypeId, number }) => prototypeId === 1 && number === 2)
    const running = seed.builds.find(({ prototypeId }) => prototypeId === 2)
    if (!failed || !running) throw new Error("The fixture needs failed and running Builds.")
    seed.builds.push({ ...failed, number: 4 }, { ...running, prototypeId: 1, number: 5 })
    const store = createMockStore({ origin: window.location.origin, seed })

    expect(store.getPrototype(2001, 1).selectedBuild?.number).toBe(3)
    expect(store.getPrototype(2001, 1, 1).selectedBuild?.number).toBe(1)
    expect(() => store.getPrototype(2001, 1, 4)).toThrow(expect.objectContaining({ status: 404 }))
    expect(() => store.getPrototype(2001, 1, 5)).toThrow(expect.objectContaining({ status: 404 }))
    expect(store.getBuild(2001, 1, 4).build.state).toBe("failed")
    expect(store.getBuild(2001, 1, 5).build.state).toBe("running")
  })

  it("does not offer an unsuccessful Build as a preview when no successful Build exists", () => {
    const store = createMockStore({ origin: window.location.origin })

    expect(store.getPrototype(2001, 2).selectedBuild).toBeNull()
    expect(store.getPrototype(2001, 3).selectedBuild).toBeNull()
    expect(store.getBuild(2001, 2, 1).build.state).toBe("running")
  })
})
