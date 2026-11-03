import { describe, expect, it } from "vitest"

import type { UserRecord } from "../../contracts"

import { createMockSession } from "."

describe("createMockSession()", () => {
  it("applies synthetic profile capabilities independently of the viewer identity", () => {
    const users: UserRecord[] = [
      { id: "octocat", login: "octocat", name: "Octocat", avatarUrl: null },
      { id: "mona", login: "mona", name: "Mona", avatarUrl: null },
    ]
    const session = createMockSession(users, "octocat")

    expect(session.read()).toMatchObject({
      profile: "owner",
      viewer: { login: "octocat" },
      capabilities: {
        createPrototypes: true,
        manageSharing: true,
        administerHub: false,
      },
    })
    expect(() => session.requireCapability("administerHub")).toThrow(
      expect.objectContaining({ status: 403 }),
    )

    expect(session.select("reader")).toMatchObject({
      viewer: { login: "mona" },
      capabilities: {
        createPrototypes: false,
        manageSharing: false,
        administerHub: false,
      },
    })
    expect(session.requireViewer().login).toBe("mona")
    expect(() => session.requireCapability("createPrototypes")).toThrow(
      expect.objectContaining({ status: 403 }),
    )

    expect(session.select("admin")).toMatchObject({
      viewer: { login: "octocat" },
      capabilities: {
        createPrototypes: true,
        manageSharing: true,
        administerHub: true,
      },
    })
    expect(session.requireCapability("administerHub").login).toBe("octocat")

    expect(session.select("signed-out")).toMatchObject({
      viewer: null,
      capabilities: {
        createPrototypes: false,
        manageSharing: false,
        administerHub: false,
      },
    })
    expect(() => session.requireViewer()).toThrow(expect.objectContaining({ status: 401 }))
    expect(() => session.requireCapability("createPrototypes")).toThrow(
      expect.objectContaining({ status: 401 }),
    )
  })

  it("advances the session revision without leaking changes into snapshots or a new document", () => {
    const users: UserRecord[] = [
      { id: "octocat", login: "octocat", name: "Octocat", avatarUrl: null },
      { id: "mona", login: "mona", name: "Mona", avatarUrl: null },
    ]
    const session = createMockSession(users, "octocat")
    const initial = session.read()

    expect(session.select("admin").revision).toBe(initial.revision + 1)
    const selected = session.select("owner")
    expect(selected.revision).toBe(initial.revision + 2)
    if (!selected.viewer) throw new Error("The owner profile must have a viewer.")
    selected.viewer.name = "An edited response"
    selected.capabilities.administerHub = true

    expect(initial).toMatchObject({
      profile: "owner",
      revision: 0,
      viewer: { name: "Octocat" },
    })
    expect(session.read()).toMatchObject({
      revision: 2,
      viewer: { name: "Octocat" },
      capabilities: { administerHub: false },
    })
    expect(createMockSession(users, "octocat").read()).toMatchObject({
      profile: "owner",
      revision: 0,
    })
  })
})
