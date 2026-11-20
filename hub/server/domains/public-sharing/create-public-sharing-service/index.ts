import { randomUUID } from "node:crypto"

import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts"
import { createShareLink } from "../../../repositories/public-sharing/create-share-link/index.ts"
import { countActiveShareLinks } from "../../../repositories/public-sharing/count-active-share-links/index.ts"
import { findShareLink } from "../../../repositories/public-sharing/find-share-link/index.ts"
import { findShareableBuild } from "../../../repositories/public-sharing/find-shareable-build/index.ts"
import { getSharingSetting } from "../../../repositories/public-sharing/get-sharing-setting/index.ts"
import { initializeSharingSetting } from "../../../repositories/public-sharing/initialize-sharing-setting/index.ts"
import { listShareLinkExpirations } from "../../../repositories/public-sharing/list-share-link-expirations/index.ts"
import { listShareLinks } from "../../../repositories/public-sharing/list-share-links/index.ts"
import { revokeAllShareLinks } from "../../../repositories/public-sharing/revoke-all-share-links/index.ts"
import { revokeShareLink } from "../../../repositories/public-sharing/revoke-share-link/index.ts"
import { updateShareLinkExpirations } from "../../../repositories/public-sharing/update-share-link-expirations/index.ts"
import { updateSharingSetting } from "../../../repositories/public-sharing/update-sharing-setting/index.ts"
import { recordRepositoryAudit } from "../../../repositories/security-audits/record-repository-audit/index.ts"
import {
  hostedPublicSharingSettingKey,
  publicSharingSettingKey,
} from "../../../utils/public-sharing-setting-key/index.ts"
import { authorizeHostedSharing } from "../authorize-hosted-sharing/index.ts"
import { configureHostedSharingPolicy } from "../configure-hosted-sharing-policy/index.ts"
import { PublicSharingError } from "../errors.ts"
import { lockHostedSharingApproval } from "../lock-hosted-sharing-approval/index.ts"
import { parseShareLinkMaximumDays } from "../parse-share-link-maximum-days/index.ts"
import { readHostedPublicSharingEnabled } from "../read-hosted-public-sharing-enabled/index.ts"
import type { PublicSharingService, ShareLinkExpiration } from "../types.ts"

const durationDays: Record<ShareLinkExpiration, 1 | 7 | 30> = {
  one_day: 1,
  seven_days: 7,
  thirty_days: 30,
}

function isAvailableLink(
  link: Awaited<ReturnType<typeof findShareLink>>,
  setting: Awaited<ReturnType<typeof getSharingSetting>>,
  now: Date,
  hosted: boolean,
) {
  const prototype = link?.build.prototype
  return Boolean(
    setting?.publicSharingEnabled &&
    link &&
    !link.revokedAt &&
    link.expiresAt > now &&
    link.build.state === "successful" &&
    link.build.artifacts.length > 0 &&
    prototype &&
    !prototype.replica &&
    !prototype.branchDeletedAt &&
    !prototype.repository.removedAt &&
    (hosted
      ? link.createdByExternalIdentityId &&
        prototype.repository.githubRepositoryId !== null &&
        prototype.repository.localPath === null &&
        link.build.artifacts.some(({ kind }) => kind === "dist")
      : !link.createdByExternalIdentityId && prototype.repository.localPath) &&
    prototype.branchName !== prototype.repository.defaultBranch &&
    prototype.branchName !== "replica/install-workflow",
  )
}

export async function createPublicSharingService(
  database: PrismaClient,
  environment: NodeJS.ProcessEnv,
  { mode = "local" }: { mode?: "local" | "hosted" } = {},
): Promise<PublicSharingService> {
  const applicationOrigin = new URL(environment.HUB_APPLICATION_ORIGIN ?? "")
  const previewBaseOrigin = new URL(environment.HUB_PREVIEW_ORIGIN ?? "")
  const maximumDays = parseShareLinkMaximumDays(environment.HUB_SHARE_LINK_MAX_DAYS)
  const hosted = mode === "hosted"
  const allowedByDeployment =
    !hosted || readHostedPublicSharingEnabled(environment.HUB_HOSTED_PUBLIC_SHARING_ENABLED)
  const key = hosted ? hostedPublicSharingSettingKey : publicSharingSettingKey
  const setting = await initializeSharingSetting(database, key)
  if (hosted) await configureHostedSharingPolicy(database, allowedByDeployment)
  const isolationLevel = hosted
    ? Prisma.TransactionIsolationLevel.ReadCommitted
    : Prisma.TransactionIsolationLevel.Serializable

  const maximumMilliseconds = maximumDays * 24 * 60 * 60_000
  const links = await listShareLinkExpirations(database, hosted)
  const shortened = links
    .map((link) => ({
      id: link.id,
      expiresAt: new Date(link.createdAt.getTime() + maximumMilliseconds),
      currentExpiresAt: link.expiresAt,
    }))
    .filter(({ expiresAt, currentExpiresAt }) => expiresAt < currentExpiresAt)
  if (shortened.length > 0) {
    await updateShareLinkExpirations(database, shortened)
  }

  return {
    applicationOrigin: applicationOrigin.origin,
    previewBaseOrigin: previewBaseOrigin.origin,
    maximumDays,
    ...(hosted
      ? {
          hosted: {
            authorize: (input) => authorizeHostedSharing(database, allowedByDeployment, input),
          },
        }
      : {}),
    async getSettings() {
      const current = (await getSharingSetting(database, key)) ?? setting
      return {
        enabled: allowedByDeployment && current.publicSharingEnabled,
        revision: current.revision,
        activeLinkCount: await countActiveShareLinks(database, new Date(), hosted),
      }
    },
    async changeSettings(operation) {
      if (hosted) {
        throw new PublicSharingError("forbidden", "The deployment controls public sharing.")
      }
      return database.$transaction(
        async (transaction) => {
          const current = await getSharingSetting(transaction)
          if (!current) throw new Error("Public sharing settings are missing.")
          const enabled = operation === "enable"
          if (current.publicSharingEnabled === enabled) {
            throw new PublicSharingError("state_changed", "Public sharing already has that state.")
          }
          const changed = await updateSharingSetting(transaction, { id: current.id, enabled })
          if (!enabled) {
            await revokeAllShareLinks(transaction, new Date())
          }
          return { enabled: changed.publicSharingEnabled, revision: changed.revision }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    },
    async listLinks(prototypeId, approval) {
      const records = hosted
        ? await database.$transaction(async (transaction) => {
            if (!allowedByDeployment) {
              throw new PublicSharingError("disabled", "Public sharing is disabled.")
            }
            await lockHostedSharingApproval(transaction, approval, { prototypeId })
            return listShareLinks(transaction, prototypeId, true)
          })
        : await listShareLinks(database, prototypeId)
      return records.map(({ build, ...link }) => ({ ...link, buildNumber: build.number }))
    },
    async createLink(input) {
      const label = input.label.trim()
      if (!label || Buffer.byteLength(label, "utf8") > 100) {
        throw new PublicSharingError(
          "invalid_label",
          "Enter a link label containing at most 100 bytes.",
        )
      }
      const selectedDays = durationDays[input.expiration]
      if (selectedDays > maximumDays) {
        throw new PublicSharingError(
          "invalid_expiration",
          "Choose an expiration allowed by this Hub.",
        )
      }
      const initialSetting = await getSharingSetting(database, key)
      if (!allowedByDeployment || !initialSetting?.publicSharingEnabled) {
        throw new PublicSharingError("disabled", "Public sharing is disabled.")
      }
      if (hosted && input.approval?.userId !== input.createdById) {
        throw new PublicSharingError("forbidden", "Current GitHub sharing permission is required.")
      }
      const initialBuild = await findShareableBuild(database, input, hosted)
      const buildError = hosted
        ? "Choose a successful Build with an available preview."
        : "Choose a successful local Build with an available preview."
      if (
        !initialBuild ||
        initialBuild.prototype.branchName === initialBuild.prototype.repository.defaultBranch
      ) {
        throw new PublicSharingError("unavailable_build", buildError)
      }
      return database.$transaction(
        async (transaction) => {
          const approval = hosted
            ? await lockHostedSharingApproval(transaction, input.approval, input)
            : undefined
          const currentSetting = await getSharingSetting(transaction, key)
          if (!currentSetting?.publicSharingEnabled) {
            throw new PublicSharingError("disabled", "Public sharing is disabled.")
          }
          if (currentSetting.revision !== initialSetting.revision) {
            throw new PublicSharingError(
              "policy_changed",
              "Public sharing changed while this link was being created.",
            )
          }
          const build = await findShareableBuild(transaction, input, hosted)
          if (
            !build ||
            build.id !== initialBuild.id ||
            build.prototype.branchName === build.prototype.repository.defaultBranch
          ) {
            throw new PublicSharingError("unavailable_build", buildError)
          }
          const createdAt = new Date()
          const link = await createShareLink(transaction, {
            buildId: build.id,
            createdAt,
            ...(approval ? { createdByExternalIdentityId: approval.identity.id } : {}),
            createdById: input.createdById,
            createdByLogin: input.createdByLogin,
            expiresAt: new Date(createdAt.getTime() + selectedDays * 24 * 60 * 60_000),
            label,
            prototypeId: input.prototypeId,
            publicId: randomUUID(),
          })
          if (input.actorMembershipId) {
            await recordRepositoryAudit(transaction, {
              action: "share_link.created",
              repositoryId: input.repositoryId,
              targetId: link.id,
              actorMembershipId: input.actorMembershipId,
            })
          }
          return { ...link, buildNumber: input.buildNumber }
        },
        { isolationLevel },
      )
    },
    async revokeLink(input) {
      const initialSetting = await getSharingSetting(database, key)
      if (!allowedByDeployment || !initialSetting?.publicSharingEnabled) {
        throw new PublicSharingError("disabled", "Public sharing is disabled.")
      }
      return database.$transaction(
        async (transaction) => {
          if (hosted) await lockHostedSharingApproval(transaction, input.approval, input)
          const currentSetting = await getSharingSetting(transaction, key)
          if (!currentSetting?.publicSharingEnabled) {
            throw new PublicSharingError("disabled", "Public sharing is disabled.")
          }
          if (currentSetting.revision !== initialSetting.revision) {
            throw new PublicSharingError(
              "policy_changed",
              "Public sharing changed while this link was being revoked.",
            )
          }
          const existing = input.actorMembershipId
            ? await transaction.shareLink.findUnique({
                where: { publicId: input.publicId },
                select: { id: true },
              })
            : null
          const revoked = await revokeShareLink(
            transaction,
            { ...input, revokedAt: new Date() },
            hosted,
          )
          if (revoked && existing && input.actorMembershipId) {
            await recordRepositoryAudit(transaction, {
              action: "share_link.revoked",
              repositoryId: input.repositoryId,
              targetId: existing.id,
              actorMembershipId: input.actorMembershipId,
            })
          }
          return revoked
        },
        { isolationLevel },
      )
    },
    async readPublicLink(publicId) {
      if (!allowedByDeployment) return null
      const [current, link] = await Promise.all([
        getSharingSetting(database, key),
        findShareLink(database, { publicId }),
      ])
      if (!link || hosted !== (link.createdByExternalIdentityId !== null)) return null
      const now = new Date()
      const available = isAvailableLink(link, current, now, hosted)
      if (hosted && !available) return null
      if (!current?.publicSharingEnabled) return { state: "disabled" }
      if (link.revokedAt) return { state: "revoked" }
      if (link.expiresAt <= now) return { state: "expired" }
      if (!available) return { state: "unavailable" }
      return {
        state: "active",
        id: link.id,
        buildId: link.buildId,
        buildNumber: link.build.number,
        expiresAt: link.expiresAt,
        label: link.label,
        prototypeName:
          link.build.prototype.name ??
          (hosted ? "Shared prototype" : link.build.prototype.branchName),
        startPage: link.build.prototype.startPage ?? "/",
      }
    },
    async readAvailableLink(shareLinkId, buildId) {
      if (!allowedByDeployment) return null
      const [current, link] = await Promise.all([
        getSharingSetting(database, key),
        findShareLink(database, { id: shareLinkId }),
      ])
      return link?.buildId === buildId && isAvailableLink(link, current, new Date(), hosted)
        ? {
            expiresAt: link.expiresAt,
            startPage: link.build.prototype.startPage ?? "/",
            ...(hosted ? { hosted: true } : {}),
          }
        : null
    },
  }
}
