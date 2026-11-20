import { describe, expect, it } from "vitest"

import { administratorsResponseSchema } from "@application/hub/administrator-contracts"

import { administratorsPageData } from "."
import { hubWorkspace } from "../hub-workspace"

describe("administratorsPageData()", () => {
  it("maps provider identities, UUID targets and an opaque cursor to canonical page links", () => {
    const membershipId = "22222222-2222-4222-8222-222222222222"
    const cursor = "opaque+/cursor=="
    const before = "current-page"
    const repositoryId = "11111111-1111-4111-8111-111111111111"
    const workspace = hubWorkspace(
      {
        viewer: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          login: "octocat",
          name: "The Octocat",
          avatarUrl: null,
        },
        repositories: [
          { id: repositoryId, nameWithOwner: "team/prototypes", defaultBranch: "main" },
        ],
      },
      new URLSearchParams(),
      "admins",
    )
    const response = administratorsResponseSchema.parse({
      administrators: [
        {
          membershipId,
          userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          provider: "entra",
          login: "mona@example.test",
          name: "Mona Lisa",
          createdAt: "2026-11-09T20:00:00.000Z",
        },
      ],
      nextCursor: cursor,
    })

    const page = administratorsPageData(workspace, response, before)

    expect(page.nextPath).toBe(
      `/settings/administrators?before=${encodeURIComponent(cursor)}&repositoryId=${repositoryId}`,
    )
    expect(page.users).toEqual([
      expect.objectContaining({
        id: membershipId,
        provider: "entra",
        login: "mona@example.test",
        confirmationPath: `/settings/administrators/${membershipId}/revoke?before=${encodeURIComponent(before)}&repositoryId=${repositoryId}`,
      }),
    ])
    expect(page.addAdministrator).toMatchObject({
      submitPath: "/api/administrators/authorizations/start",
      operation: "DESIGNATE_ADMINISTRATORS",
    })
  })
})
