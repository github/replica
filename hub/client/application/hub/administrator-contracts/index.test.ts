import { describe, expect, it } from "vitest"

import {
  administratorAuthorizationResponseSchema,
  administratorContinuationResponseSchema,
  administratorsResponseSchema,
} from "."

const assignment = {
  assignmentId: "44444444-4444-4444-8444-444444444444",
  membershipId: "22222222-2222-4222-8222-222222222222",
}

describe("administrator contracts", () => {
  it.each([
    ["designation assignments", { result: [assignment] }],
    ["a revocation assignment", { result: assignment }],
  ])("accepts %s from a successful continuation", (_name, response) => {
    expect(administratorContinuationResponseSchema.parse(response)).toEqual(response)
  })

  it("accepts unavailable provider profile fields on roster and authorization identities", () => {
    const identity = {
      membershipId: "22222222-2222-4222-8222-222222222222",
      provider: null,
      login: null,
      name: null,
    }
    const roster = {
      administrators: [
        {
          ...identity,
          userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          createdAt: "2026-11-09T20:00:00.000Z",
        },
      ],
      nextCursor: null,
    }
    const authorization = {
      authorization: {
        operation: "REVOKE_ADMINISTRATOR",
        targets: [identity],
        verifiedAt: "2026-11-09T20:01:00.000Z",
        expiresAt: "2026-11-09T20:06:00.000Z",
      },
    }

    expect(administratorsResponseSchema.parse(roster)).toEqual(roster)
    expect(administratorAuthorizationResponseSchema.parse(authorization)).toEqual(authorization)
  })
})
