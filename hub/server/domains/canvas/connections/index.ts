import type { PrismaClient } from "../../../generated/prisma/client.ts"
import {
  canvasAuthorityReference,
  readCanvasAuthority,
} from "../../../repositories/canvas/authority/index.ts"
import {
  findCanvasGrant,
  listCanvasGrants,
  revokeCanvasGrant,
  rotateCanvasAccess,
  verifyCanvasAccess,
} from "../../../repositories/canvas/grants/index.ts"
import { canvasRepositoryId, lockCanvasGrant } from "../../../repositories/canvas/records/index.ts"
import { recordCanvasAudit } from "../../../repositories/canvas/record-audit/index.ts"
import { readCanvasPrototype } from "../../../repositories/canvas/read-prototype/index.ts"
import { readCanvasEvaluationContext } from "../../../repositories/canvas/read-evaluation-context/index.ts"
import type { CanvasAuthorization, CanvasBrowser } from "../authorization/index.ts"
import {
  accessLifetime,
  accessPattern,
  canvasCredentials,
  canvasDigest,
  canvasSecret,
  inactiveLifetime,
  refreshPattern,
} from "../credentials/index.ts"

export function createCanvasConnections(
  database: PrismaClient,
  authority: CanvasAuthorization,
  applicationOrigin: string,
) {
  return {
    async authorizeEvaluationCredential(secret: string) {
      if (!accessPattern.test(secret)) return { status: "unauthorized" } as const
      const tokenDigest = canvasDigest(secret)
      const grant = await findCanvasGrant(database, tokenDigest)
      if (!grant) return { status: "unauthorized" } as const
      const viewer = await readCanvasAuthority(database, grant)
      if (!viewer) return { status: "unauthorized" } as const
      const permission = await authority.permission(viewer, grant.repository)
      if (!["write", "maintain", "admin"].includes(permission)) {
        return { status: "forbidden" } as const
      }
      const active = await authority.withRepository(
        viewer,
        grant.repository,
        async (transaction) => {
          await lockCanvasGrant(transaction, grant.id, false)
          return verifyCanvasAccess(transaction, grant.id, tokenDigest, new Date())
        },
      )
      return active ? ({ status: "ok" } as const) : ({ status: "unauthorized" } as const)
    },
    async authorizeEvaluation(secret: string, input: { branch: string; commitSha: string }) {
      if (!accessPattern.test(secret)) return { status: "unauthorized" } as const
      const tokenDigest = canvasDigest(secret)
      const grant = await findCanvasGrant(database, tokenDigest)
      if (!grant) return { status: "unauthorized" } as const
      const viewer = await readCanvasAuthority(database, grant)
      if (!viewer) return { status: "unauthorized" } as const
      const permission = await authority.permission(viewer, grant.repository)
      if (!["write", "maintain", "admin"].includes(permission)) {
        return { status: "forbidden" } as const
      }
      const result = await authority.withRepository(
        viewer,
        grant.repository,
        async (transaction) => {
          await lockCanvasGrant(transaction, grant.id, false)
          if (!(await verifyCanvasAccess(transaction, grant.id, tokenDigest, new Date()))) {
            return null
          }
          if (input.branch === grant.repository.defaultBranch) {
            return { status: "excluded" } as const
          }
          const context = await readCanvasEvaluationContext(
            transaction,
            grant.repositoryId,
            input.branch,
            input.commitSha,
          )
          if (!context) return { status: "hidden" } as const
          return {
            status: "ok",
            data: {
              actorMembershipId: viewer.membershipId,
              branch: input.branch,
              buildId: context.builds[0]?.id ?? null,
              commitSha: input.commitSha,
              prototypeId: context.id,
              repositoryId: grant.repositoryId,
              sessionKey: canvasDigest(`${grant.id}\0${viewer.membershipId}`),
            },
          } as const
        },
      )
      return result ?? ({ status: "unauthorized" } as const)
    },
    async read(
      secret: string,
      input: {
        repositoryId?: string
        branch?: string
        interactive: boolean
        activityOnly?: boolean
      },
    ) {
      if (!accessPattern.test(secret)) return { status: "unauthorized" } as const
      const tokenDigest = canvasDigest(secret)
      const grant = await findCanvasGrant(database, tokenDigest)
      if (!grant) return { status: "unauthorized" } as const
      const repositoryId = canvasRepositoryId(grant.repository)
      if (input.repositoryId !== undefined && String(repositoryId) !== input.repositoryId) {
        return { status: "hidden" } as const
      }
      const viewer = await readCanvasAuthority(database, grant)
      if (!viewer) return { status: "unauthorized" } as const
      const permission = await authority.permission(viewer, grant.repository)
      if (permission === "none") return { status: "forbidden" } as const
      const result = await authority.withRepository(
        viewer,
        grant.repository,
        async (transaction) => {
          const extend = input.interactive && grant.refreshDigest !== null
          await lockCanvasGrant(transaction, grant.id, extend)
          const now = new Date()
          if (
            !(await verifyCanvasAccess(
              transaction,
              grant.id,
              tokenDigest,
              now,
              extend ? new Date(now.getTime() + inactiveLifetime) : undefined,
            ))
          )
            return null
          if (extend) {
            await recordCanvasAudit(transaction, {
              action: "canvas_connection.activity",
              outcome: "SUCCESS",
              source: "canvas",
              repositoryId: grant.repositoryId,
              connectionId: grant.id,
              actorMembershipId: viewer.membershipId,
            })
          }
          if (input.activityOnly) return { status: "activity" } as const
          const connection = {
            repository: grant.repository.nameWithOwner,
            repositoryId,
            viewerId: viewer.viewerId,
            viewerLogin: viewer.login,
          }
          if (input.branch === undefined) {
            return {
              status: "ok",
              data: {
                ...connection,
                canPublish: ["write", "maintain", "admin"].includes(permission),
              },
            } as const
          }
          if (input.branch === grant.repository.defaultBranch) {
            return { status: "excluded" } as const
          }
          const prototype = await readCanvasPrototype(transaction, grant.repositoryId, input.branch)
          if (!prototype) return { status: "hidden" } as const
          const latest = prototype.registeredAt ? prototype.builds[0] : null
          const build =
            latest?.finishedAt && latest.commitSha
              ? {
                  number: latest.number,
                  commitSha: latest.commitSha,
                  url: new URL(
                    `/repositories/${grant.repositoryId}/prototypes/${prototype.id}?build=${latest.number}`,
                    applicationOrigin,
                  ).href,
                  publishedAt: latest.finishedAt.toISOString(),
                  author: {
                    login: latest.authorLogin,
                    name: latest.authorName,
                    avatarUrl: latest.authorAvatarUrl,
                  },
                }
              : null
          return {
            status: "ok",
            data: {
              ...connection,
              id: prototype.canvasId,
              branch: input.branch,
              name: prototype.name ?? input.branch,
              description: prototype.description,
              startPage: prototype.startPage,
              startPageSet: prototype.startPage !== null,
              registered: prototype.registeredAt !== null,
              canEdit: false,
              canManageShareLinks: false,
              publicSharingEnabled: false,
              shareLinkExpirationOptions: [],
              canRegister: false,
              registrationReason: prototype.registeredAt ? null : "registration_unavailable",
              published: Boolean(build),
              buildState: prototype.currentBuild?.state ?? null,
              currentBuild: prototype.currentBuild,
              versionCount: prototype._count.builds,
              build,
            },
          } as const
        },
      )
      return result ?? ({ status: "unauthorized" } as const)
    },

    async renew(secret: string) {
      const refreshDigest = canvasDigest(secret)
      const grant = refreshPattern.test(secret)
        ? await findCanvasGrant(database, refreshDigest, true)
        : null
      async function deny(status: "unauthorized" | "forbidden", actorMembershipId?: string) {
        await recordCanvasAudit(database, {
          action: "canvas_connection.renew",
          outcome: "DENIED",
          source: "canvas",
          repositoryId: grant?.repositoryId,
          connectionId: grant?.id,
          actorMembershipId,
        })
        return { status }
      }
      const viewer = grant && (await readCanvasAuthority(database, grant))
      if (!grant || !viewer) return deny("unauthorized")
      if ((await authority.permission(viewer, grant.repository)) === "none") {
        return deny("forbidden", viewer.membershipId)
      }
      const result = await authority.withRepository(
        viewer,
        grant.repository,
        async (transaction) => {
          await lockCanvasGrant(transaction, grant.id, true)
          const accessToken = canvasSecret("rp_")
          const renewed = await rotateCanvasAccess(
            transaction,
            grant.id,
            refreshDigest,
            canvasDigest(accessToken),
            accessLifetime,
          )
          if (!renewed) return null
          await recordCanvasAudit(transaction, {
            action: "canvas_connection.renew",
            outcome: "SUCCESS",
            source: "canvas",
            repositoryId: grant.repositoryId,
            connectionId: grant.id,
            actorMembershipId: viewer.membershipId,
          })
          return {
            status: "ok",
            data: canvasCredentials(
              renewed,
              accessToken,
              grant.repository.nameWithOwner,
              viewer.login,
            ),
          } as const
        },
      )
      return result ?? deny("unauthorized")
    },

    async revokeDevice(secret: string, refresh: boolean) {
      return database.$transaction(async (transaction) => {
        const revoked = (refresh ? refreshPattern : accessPattern).test(secret)
          ? await revokeCanvasGrant(transaction, { digest: canvasDigest(secret), refresh })
          : null
        await recordCanvasAudit(transaction, {
          action: "canvas_connection.revoke",
          outcome: revoked ? "SUCCESS" : "DENIED",
          source: "canvas",
          repositoryId: revoked?.repositoryId,
          connectionId: revoked?.id,
          actorMembershipId: revoked?.membershipId,
        })
        return Boolean(revoked)
      })
    },

    async list(browser: CanvasBrowser) {
      return database.$transaction(async (transaction) => {
        const viewer = await authority.current(transaction, browser.viewer, browser)
        const owner = viewer && canvasAuthorityReference(viewer)
        return owner ? listCanvasGrants(transaction, owner) : null
      })
    },

    async revokeBrowser(id: number, browser: CanvasBrowser) {
      return database.$transaction(async (transaction) => {
        const viewer = await authority.current(transaction, browser.viewer, browser)
        const owner = viewer && canvasAuthorityReference(viewer)
        if (!owner) return null
        const revoked = await revokeCanvasGrant(transaction, { id, owner })
        await recordCanvasAudit(transaction, {
          action: "canvas_connection.revoke",
          outcome: revoked ? "SUCCESS" : "DENIED",
          source: "browser",
          repositoryId: revoked?.repositoryId,
          connectionId: revoked ? id : undefined,
          actorMembershipId: owner.membershipId,
        })
        return Boolean(revoked)
      })
    },
  }
}
