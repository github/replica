import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { designateHubAdministrators } from "./designate-hub-administrators"
import {
  AdministratorManagementPersistenceError,
  AdministratorManagementTransactionConflictError,
} from "./errors"

const unavailableDependencies = new Proxy(
  {},
  {
    get() {
      throw new Error("Selection validation must not access persistence dependencies.")
    },
  },
) as Parameters<typeof designateHubAdministrators>[1]

describe("designateHubAdministrators()", () => {
  it.each([
    ["an empty selection", []],
    ["a duplicate selection", [randomUUID(), randomUUID()].flatMap((id) => [id, id])],
    ["more than fifty memberships", Array.from({ length: 51 }, () => randomUUID())],
  ])("rejects %s before persistence work", async (_case, targetMembershipIds) => {
    await expect(
      designateHubAdministrators(
        {
          actorMembershipId: randomUUID(),
          targetMembershipIds,
        },
        unavailableDependencies,
      ),
    ).rejects.toMatchObject({ reason: "invalid_selection" })
  })

  it("uses the bounded retry policy for serialization conflicts", async () => {
    const runTransaction = vi
      .fn()
      .mockRejectedValue(new AdministratorManagementTransactionConflictError())

    await expect(
      designateHubAdministrators(
        {
          actorMembershipId: randomUUID(),
          targetMembershipIds: [randomUUID()],
        },
        { createId: randomUUID, runTransaction },
      ),
    ).rejects.toBeInstanceOf(AdministratorManagementPersistenceError)
    expect(runTransaction).toHaveBeenCalledTimes(3)
  })
})
