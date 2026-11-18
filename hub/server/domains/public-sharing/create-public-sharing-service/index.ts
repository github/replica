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
import { PublicSharingError } from "../errors.ts"
import { parseShareLinkMaximumDays } from "../parse-share-link-maximum-days/index.ts"
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
    prototype.repository.localPath &&
    prototype.branchName !== prototype.repository.defaultBranch &&
    prototype.branchName !== "replica/install-workflow",
  )
}

export async function createPublicSharingService(
  database: PrismaClient,
  environment: NodeJS.ProcessEnv,
): Promise<PublicSharingService> {
  const applicationOrigin = new URL(environment.HUB_APPLICATION_ORIGIN ?? "")
  const previewBaseOrigin = new URL(environment.HUB_PREVIEW_ORIGIN ?? "")
  const maximumDays = parseShareLinkMaximumDays(environment.HUB_SHARE_LINK_MAX_DAYS)
  const setting = await initializeSharingSetting(database)

  const maximumMilliseconds = maximumDays * 24 * 60 * 60_000
  const links = await listShareLinkExpirations(database)
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
    async getSettings() {
      const current = (await getSharingSetting(database)) ?? setting
      return {
        enabled: current.publicSharingEnabled,
        revision: current.revision,
        activeLinkCount: await countActiveShareLinks(database, new Date()),
      }
    },
    async changeSettings(operation) {
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
    async listLinks(prototypeId) {
      const records = await listShareLinks(database, prototypeId)
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
      const initialSetting = await getSharingSetting(database)
      if (!initialSetting?.publicSharingEnabled) {
        throw new PublicSharingError("disabled", "Public sharing is disabled.")
      }
      const initialBuild = await findShareableBuild(database, input)
      if (
        !initialBuild ||
        initialBuild.prototype.branchName === initialBuild.prototype.repository.defaultBranch
      ) {
        throw new PublicSharingError(
          "unavailable_build",
          "Choose a successful local Build with an available preview.",
        )
      }
      return database.$transaction(
        async (transaction) => {
          const currentSetting = await getSharingSetting(transaction)
          if (!currentSetting?.publicSharingEnabled) {
            throw new PublicSharingError("disabled", "Public sharing is disabled.")
          }
          if (currentSetting.revision !== initialSetting.revision) {
            throw new PublicSharingError(
              "policy_changed",
              "Public sharing changed while this link was being created.",
            )
          }
          const build = await findShareableBuild(transaction, input)
          if (
            !build ||
            build.id !== initialBuild.id ||
            build.prototype.branchName === build.prototype.repository.defaultBranch
          ) {
            throw new PublicSharingError(
              "unavailable_build",
              "Choose a successful local Build with an available preview.",
            )
          }
          const createdAt = new Date()
          const link = await createShareLink(transaction, {
            buildId: build.id,
            createdAt,
            createdById: input.createdById,
            createdByLogin: input.createdByLogin,
            expiresAt: new Date(createdAt.getTime() + selectedDays * 24 * 60 * 60_000),
            label,
            prototypeId: input.prototypeId,
            publicId: randomUUID(),
          })
          return { ...link, buildNumber: input.buildNumber }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    },
    async revokeLink(input) {
      const initialSetting = await getSharingSetting(database)
      if (!initialSetting?.publicSharingEnabled) {
        throw new PublicSharingError("disabled", "Public sharing is disabled.")
      }
      return database.$transaction(
        async (transaction) => {
          const currentSetting = await getSharingSetting(transaction)
          if (!currentSetting?.publicSharingEnabled) {
            throw new PublicSharingError("disabled", "Public sharing is disabled.")
          }
          if (currentSetting.revision !== initialSetting.revision) {
            throw new PublicSharingError(
              "policy_changed",
              "Public sharing changed while this link was being revoked.",
            )
          }
          return revokeShareLink(transaction, { ...input, revokedAt: new Date() })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    },
    async readPublicLink(publicId) {
      const [current, link] = await Promise.all([
        getSharingSetting(database),
        findShareLink(database, { publicId }),
      ])
      if (!link) return null
      if (!current?.publicSharingEnabled) return { state: "disabled" }
      if (link.revokedAt) return { state: "revoked" }
      if (link.expiresAt <= new Date()) return { state: "expired" }
      if (!isAvailableLink(link, current, new Date())) return { state: "unavailable" }
      return {
        state: "active",
        id: link.id,
        buildId: link.buildId,
        buildNumber: link.build.number,
        expiresAt: link.expiresAt,
        label: link.label,
        prototypeName: link.build.prototype.name ?? link.build.prototype.branchName,
        startPage: link.build.prototype.startPage ?? "/",
      }
    },
    async readAvailableLink(shareLinkId, buildId) {
      const [current, link] = await Promise.all([
        getSharingSetting(database),
        findShareLink(database, { id: shareLinkId }),
      ])
      return link?.buildId === buildId && isAvailableLink(link, current, new Date())
        ? { expiresAt: link.expiresAt, startPage: link.build.prototype.startPage ?? "/" }
        : null
    },
  }
}
