import { describe, expect, it, vi } from "vitest"

import { listReadableInstallationRepositories } from "."

function repository(permissions: {
  admin: boolean
  maintain: boolean
  pull: boolean
  push: boolean
  triage: boolean
}) {
  return {
    id: 17,
    full_name: "octo/example",
    default_branch: "main",
    permissions,
  }
}

describe("listReadableInstallationRepositories()", () => {
  it.each([
    ["admin", { admin: true, maintain: true, push: true, triage: true, pull: true }, "ADMIN"],
    [
      "maintain",
      { admin: false, maintain: true, push: true, triage: true, pull: true },
      "MAINTAIN",
    ],
    ["write", { admin: false, maintain: false, push: true, triage: true, pull: true }, "WRITE"],
    ["triage", { admin: false, maintain: false, push: false, triage: true, pull: true }, "TRIAGE"],
    ["read", { admin: false, maintain: false, push: false, triage: false, pull: true }, "READ"],
  ] as const)("records the highest current %s permission", async (_, permissions, accessLevel) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        total_count: 1,
        repositories: [repository(permissions)],
      }),
    )

    await expect(listReadableInstallationRepositories(request, 42, "user-token")).resolves.toEqual([
      {
        accessLevel,
        defaultBranch: "main",
        githubRepositoryId: 17,
        nameWithOwner: "octo/example",
      },
    ])
  })

  it("fails closed when current permission evidence is malformed", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        total_count: 1,
        repositories: [
          {
            id: 17,
            full_name: "octo/example",
            default_branch: "main",
            permissions: { admin: true },
          },
        ],
      }),
    )

    await expect(listReadableInstallationRepositories(request, 42, "user-token")).rejects.toThrow()
  })

  it("fails closed when a listed repository has no readable permission", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        total_count: 1,
        repositories: [
          repository({
            admin: false,
            maintain: false,
            pull: false,
            push: false,
            triage: false,
          }),
        ],
      }),
    )

    await expect(listReadableInstallationRepositories(request, 42, "user-token")).rejects.toThrow()
  })
})
