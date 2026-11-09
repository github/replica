import { describe, expect, it } from "vitest"

import {
  administratorsResponseSchema,
  currentHubSessionSchema,
} from "@application/hub/administrator-contracts"

import { administratorsPageData } from "."

describe("administratorsPageData()", () => {
  it("maps provider identities, UUID targets and an opaque cursor to canonical page links", () => {
    const membershipId = "22222222-2222-4222-8222-222222222222"
    const cursor = "opaque+/cursor=="
    const before = "current-page"
    const session = currentHubSessionSchema.parse({
      authenticated: true,
      membershipId: "11111111-1111-4111-8111-111111111111",
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      provider: "github",
      login: "octocat",
      name: "The Octocat",
      role: "ADMINISTRATOR",
    })
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

    const page = administratorsPageData(session, response, before)

    expect(page.nextPath).toBe(`/settings/administrators?before=${encodeURIComponent(cursor)}`)
    expect(page.users).toEqual([
      expect.objectContaining({
        id: membershipId,
        provider: "entra",
        login: "mona@example.test",
        confirmationPath: `/settings/administrators/${membershipId}/revoke?before=${encodeURIComponent(before)}`,
      }),
    ])
    expect(page.addAdministrator).toMatchObject({
      submitPath: "/api/administrators/authorizations/start",
      operation: "DESIGNATE_ADMINISTRATORS",
    })
  })
})
