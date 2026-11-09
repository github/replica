import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { getAuthenticationProofState } from "."

describe("getAuthenticationProofState()", () => {
  it("reads the selected provider revision and global revocation revision as one snapshot", async () => {
    const providerId = randomUUID()
    const revisionId = randomUUID()
    await prisma.$transaction(async (transaction) => {
      await transaction.authenticationProvider.create({
        data: {
          enabled: false,
          id: providerId,
          key: "github",
        },
      })
      await transaction.authenticationProviderRevision.create({
        data: {
          configurationDigest: "a".repeat(64),
          id: revisionId,
          providerId,
          revision: 1,
        },
      })
      await transaction.authenticationProvider.update({
        where: { id: providerId },
        data: { enabled: true, selectedRevisionId: revisionId },
      })
    })

    await expect(getAuthenticationProofState(prisma, "github")).resolves.toEqual({
      selectedProviderRevision: {
        configurationDigest: "a".repeat(64),
        id: revisionId,
        revision: 1,
      },
      sessionRevocationRevision: 0,
    })

    await prisma.$transaction([
      prisma.authenticationProvider.update({
        where: { id: providerId },
        data: { enabled: false, selectedRevisionId: null },
      }),
      prisma.sessionRevocationState.update({
        where: { key: "global" },
        data: { revision: { increment: 1 } },
      }),
    ])

    await expect(getAuthenticationProofState(prisma, "github")).resolves.toEqual({
      selectedProviderRevision: null,
      sessionRevocationRevision: 1,
    })
  })
})
