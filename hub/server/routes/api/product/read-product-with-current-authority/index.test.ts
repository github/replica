import { describe, expect, it, vi } from "vitest"

import type { CurrentSessionDependencies } from "../../auth/types.ts"
import { readProductWithCurrentAuthority } from "./index.ts"

type Viewer = NonNullable<Awaited<ReturnType<CurrentSessionDependencies["restore"]>>>

const administrator: Viewer = {
  membershipId: "membership",
  userId: "user",
  provider: "github",
  sessionProvider: "github",
  login: "mona",
  name: "Mona",
  role: "ADMINISTRATOR",
}
const member: Viewer = { ...administrator, role: "MEMBER" }

describe("readProductWithCurrentAuthority", () => {
  it("uses one read when the authority is unchanged", async () => {
    const current = { ...member, provider: "entra", login: "updated" }
    const restore = vi.fn().mockResolvedValue(current)
    const read = vi.fn<(viewer: Viewer) => Promise<string>>().mockResolvedValue("member data")

    await expect(
      readProductWithCurrentAuthority(member, "session", { restore }, read),
    ).resolves.toEqual({ current, result: "member data" })
    expect(read).toHaveBeenCalledExactlyOnceWith(member)
    expect(restore).toHaveBeenCalledOnce()
  })

  it("returns a fresh read under the current role", async () => {
    const verified = { ...member, login: "updated" }
    const restore = vi.fn().mockResolvedValueOnce(member).mockResolvedValueOnce(verified)
    const read = vi.fn((viewer: Viewer) =>
      Promise.resolve(viewer.role === "ADMINISTRATOR" ? "unscoped data" : "member data"),
    )

    await expect(
      readProductWithCurrentAuthority(administrator, "session", { restore }, read),
    ).resolves.toEqual({ current: verified, result: "member data" })
    expect(read.mock.calls.map(([viewer]) => viewer)).toEqual([administrator, member])
    expect(restore).toHaveBeenCalledTimes(2)
  })

  it.each([
    ["revoked", null],
    ["membership changed", { ...administrator, membershipId: "other-membership" }],
    ["user changed", { ...administrator, userId: "other-user" }],
    ["session provider changed", { ...administrator, sessionProvider: "entra" }],
    ["session provider became unknown", { ...administrator, sessionProvider: null }],
  ])("returns null when the session is %s after the first read", async (_case, current) => {
    const restore = vi.fn().mockResolvedValue(current)
    const read = vi.fn<(viewer: Viewer) => Promise<string>>().mockResolvedValue("unscoped data")

    await expect(
      readProductWithCurrentAuthority(administrator, "session", { restore }, read),
    ).resolves.toBeNull()
    expect(read).toHaveBeenCalledExactlyOnceWith(administrator)
    expect(restore).toHaveBeenCalledOnce()
  })

  it.each([
    ["revoked", null],
    ["membership changed", { ...member, membershipId: "other-membership" }],
    ["user changed", { ...member, userId: "other-user" }],
    ["session provider changed", { ...member, sessionProvider: "entra" }],
    ["role changed again", { ...member, role: "ADMINISTRATOR" as const }],
  ])("returns null when the session is %s after the reread", async (_case, verified) => {
    const restore = vi.fn().mockResolvedValueOnce(member).mockResolvedValueOnce(verified)
    const read = vi.fn<(viewer: Viewer) => Promise<string>>().mockResolvedValue("data")

    await expect(
      readProductWithCurrentAuthority(administrator, "session", { restore }, read),
    ).resolves.toBeNull()
    expect(read.mock.calls.map(([viewer]) => viewer)).toEqual([administrator, member])
    expect(restore).toHaveBeenCalledTimes(2)
  })
})
