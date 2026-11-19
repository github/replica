import { randomBytes } from "node:crypto"

import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts"
import {
  canvasAuthorityReference,
  readCanvasAuthority,
} from "../../../repositories/canvas/authority/index.ts"
import {
  claimCanvasPairing,
  confirmPendingCanvasPairing,
  createCanvasPairing,
  findCanvasPairingByDevice,
  findCanvasPairingRepository,
  findPendingCanvasPairing,
  pruneExpiredCanvasPairings,
} from "../../../repositories/canvas/pairings/index.ts"
import { recordCanvasAudit } from "../../../repositories/canvas/record-audit/index.ts"
import { issueCanvasGrant } from "../../../repositories/canvas/grants/index.ts"
import type { CanvasAuthorization, CanvasBrowser } from "../authorization/index.ts"
import {
  accessLifetime,
  canvasCredentials,
  canvasDigest,
  canvasSecret,
  devicePattern,
  inactiveLifetime,
  pairingLifetime,
} from "../credentials/index.ts"

export function createCanvasPairings(database: PrismaClient, authority: CanvasAuthorization) {
  return {
    async start(name: string, renewable: boolean) {
      const repository = await findCanvasPairingRepository(database, name)
      if (!repository) return null
      const deviceCode = canvasSecret()
      const refreshToken = renewable ? canvasSecret("rr_") : null
      const expiresAt = new Date(Date.now() + pairingLifetime)
      for (let attempt = 0; attempt < 3; attempt++) {
        const userCode = randomBytes(5).toString("hex").toUpperCase()
        try {
          await database.$transaction(async (transaction) => {
            await pruneExpiredCanvasPairings(transaction)
            const pairing = await createCanvasPairing(transaction, {
              repositoryId: repository.id,
              userCode,
              deviceDigest: canvasDigest(deviceCode),
              refreshDigest: refreshToken ? canvasDigest(refreshToken) : null,
              expiresAt,
            })
            await recordCanvasAudit(transaction, {
              action: "canvas_pairing.create",
              outcome: "SUCCESS",
              source: "canvas",
              repositoryId: pairing.repositoryId,
              pairingId: pairing.id,
            })
          })
          return { deviceCode, refreshToken, userCode, expiresAt, intervalSeconds: 3 }
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
            throw error
          }
        }
      }
      throw new Error("Unable to create a unique Canvas pairing.")
    },

    async approval(userCode: string, browser: CanvasBrowser, approve: boolean) {
      const pairing = await findPendingCanvasPairing(database, userCode)
      if (!pairing) return { status: "expired" } as const
      if ((await authority.permission(browser.viewer, pairing.repository)) === "none") {
        if (approve) {
          await recordCanvasAudit(database, {
            action: "canvas_pairing.approve",
            outcome: "DENIED",
            source: "browser",
            repositoryId: pairing.repositoryId,
            pairingId: pairing.id,
            actorMembershipId: browser.viewer.membershipId,
          })
        }
        return { status: "hidden" } as const
      }
      return authority.withRepository(
        browser.viewer,
        pairing.repository,
        async (transaction) => {
          if (
            !(await confirmPendingCanvasPairing(
              transaction,
              pairing.id,
              approve ? browser.sessionId : null,
            ))
          ) {
            return { status: "expired" } as const
          }
          if (approve) {
            await recordCanvasAudit(transaction, {
              action: "canvas_pairing.approve",
              outcome: "SUCCESS",
              source: "browser",
              repositoryId: pairing.repositoryId,
              pairingId: pairing.id,
              actorMembershipId: browser.viewer.membershipId,
            })
          }
          return {
            status: "ready",
            code: pairing.userCode,
            repository: pairing.repository.nameWithOwner,
            expiresAt: pairing.expiresAt.toISOString(),
          } as const
        },
        browser,
      )
    },

    async consume(deviceCode: string) {
      const pairing = devicePattern.test(deviceCode)
        ? await findCanvasPairingByDevice(database, canvasDigest(deviceCode))
        : null
      async function deny(status: "expired" | "denied", actorMembershipId?: string) {
        await recordCanvasAudit(database, {
          action: "canvas_pairing.consume",
          outcome: "DENIED",
          source: "canvas",
          repositoryId: pairing?.repositoryId,
          pairingId: pairing?.id,
          actorMembershipId,
        })
        return { status }
      }
      if (!pairing || pairing.consumedAt || pairing.expiresAt <= new Date()) {
        return deny("expired")
      }
      if (!pairing.approvedAt) return { status: "pending" }
      const reference = pairing.session && canvasAuthorityReference(pairing.session)
      const viewer = reference && (await readCanvasAuthority(database, reference))
      if (!viewer || !pairing.session) return deny("expired")
      if ((await authority.permission(viewer, pairing.repository)) === "none") {
        return deny("denied", viewer.membershipId)
      }
      const sessionId = pairing.session.id
      const approvedAt = pairing.approvedAt
      const result = await authority.withRepository(
        viewer,
        pairing.repository,
        async (transaction) => {
          const now = new Date()
          if (!(await claimCanvasPairing(transaction, pairing.id, sessionId, now))) return null

          const inactiveAt = pairing.refreshDigest
            ? new Date(approvedAt.getTime() + inactiveLifetime)
            : null
          const accessToken = canvasSecret("rp_")
          const grant = await issueCanvasGrant(transaction, {
            membershipId: viewer.membershipId,
            externalIdentityId: viewer.externalIdentityId,
            providerRevisionId: viewer.providerRevisionId,
            revocationRevision: viewer.revocationRevision,
            repositoryId: pairing.repositoryId,
            tokenDigest: canvasDigest(accessToken),
            refreshDigest: pairing.refreshDigest,
            expiresAt: new Date(now.getTime() + accessLifetime),
            lastActiveAt: inactiveAt ? approvedAt : null,
            inactiveAt,
          })
          await recordCanvasAudit(transaction, {
            action: "canvas_pairing.consume",
            outcome: "SUCCESS",
            source: "canvas",
            repositoryId: pairing.repositoryId,
            pairingId: pairing.id,
            actorMembershipId: viewer.membershipId,
            connectionId: grant.id,
          })
          return {
            status: "approved",
            ...canvasCredentials(
              grant,
              accessToken,
              pairing.repository.nameWithOwner,
              viewer.login,
            ),
          }
        },
      )
      return result ?? deny("expired")
    },
  }
}
