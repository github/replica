import { createHash } from "node:crypto"

import { z } from "zod"

import type { ArtifactStorage } from "#server/integrations/artifact-storage/types"
import { saveSecurityAudit } from "#server/repositories/security-audits/save-audit"
import { digestSecret } from "#server/utils/digest-secret"
import { secretsMatch } from "#server/utils/secrets-match"
import { AuthenticationError } from "#server/utils/authentication-error"

import { maximumArtifactBytes } from "./constants.ts"
import type { ArtifactPublishingService, PrototypeChannelName, PublisherAction } from "./types.ts"

import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

const boundedIdentifier = z.string().trim().min(1).max(255)
function isSafeProvenanceUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      ["http:", "https:"].includes(url.protocol) &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0
    )
  } catch {
    return false
  }
}

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    prototypeId: z.uuid(),
    artifact: z
      .object({
        format: z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/),
        version: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/),
        digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        sizeBytes: z.number().int().min(0),
        builtAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
    provenance: z
      .object({
        provider: z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/),
        sourceUrl: z.string().max(2_048).refine(isSafeProvenanceUrl).optional(),
        revision: boundedIdentifier.optional(),
        ref: boundedIdentifier.optional(),
        pipeline: boundedIdentifier.optional(),
        runId: boundedIdentifier.optional(),
      })
      .strict(),
  })
  .strict()
const publishSchema = z
  .object({
    manifest: manifestSchema,
    artifactBase64: z.string(),
    promoteChannel: z.enum(["current", "preview"]).optional(),
  })
  .strict()
const promotionSchema = z.object({ versionId: z.uuid() }).strict()
const channelSchema = z.enum(["current", "preview"])
const prototypeIdSchema = z.uuid()
const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\x21-\x7e]+$/)
const authorizationSchema =
  /^Bearer (rpl_pub_([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43}))$/i

function error(status: number, code: string, message: string): never {
  throw new AuthenticationError(status, code, message)
}

function parsePrototypeId(prototypeId: string): void {
  if (!prototypeIdSchema.safeParse(prototypeId).success) {
    error(404, "prototype_not_found", "The prototype was not found.")
  }
}

function parseIdempotencyKey(value: string): string {
  const parsed = idempotencyKeySchema.safeParse(value)
  if (!parsed.success) {
    error(422, "invalid_idempotency_key", "The idempotency key is invalid.")
  }
  return parsed.data
}

function parseArtifactBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0) {
    error(422, "invalid_artifact", "The artifact encoding is invalid.")
  }
  const bytes = Buffer.from(value, "base64")
  if (bytes.toString("base64") !== value) {
    error(422, "invalid_artifact", "The artifact encoding is invalid.")
  }
  if (bytes.length > maximumArtifactBytes) {
    error(413, "artifact_too_large", "The artifact exceeds the maximum size.")
  }
  return bytes
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

async function lockPrototype(
  database: Prisma.TransactionClient,
  prototypeId: string,
): Promise<void> {
  await database.$queryRaw`SELECT "id" FROM "prototypes" WHERE "id" = ${prototypeId}::uuid FOR UPDATE`
}

function versionResponse(version: {
  id: string
  prototypeId: string
  sequence: number
  label: string | null
  artifactFormat: string | null
  artifactVersion: string | null
  contentDigest: string | null
  sizeBytes: number | null
  builtAt: Date | null
  provenanceProvider: string | null
  provenanceSourceUrl: string | null
  provenanceRevision: string | null
  provenanceRef: string | null
  provenancePipeline: string | null
  provenanceRunId: string | null
  createdAt: Date
}) {
  return {
    id: version.id,
    prototypeId: version.prototypeId,
    sequence: version.sequence,
    label: version.label,
    artifact: {
      format: version.artifactFormat,
      version: version.artifactVersion,
      digest: version.contentDigest,
      sizeBytes: version.sizeBytes,
      builtAt: version.builtAt,
    },
    provenance: {
      provider: version.provenanceProvider,
      sourceUrl: version.provenanceSourceUrl,
      revision: version.provenanceRevision,
      ref: version.provenanceRef,
      pipeline: version.provenancePipeline,
      runId: version.provenanceRunId,
    },
    createdAt: version.createdAt,
  }
}

export function createArtifactPublishingService({
  database,
  storage,
}: {
  database: PrismaClient
  storage: ArtifactStorage
}): ArtifactPublishingService {
  type PublisherAuthentication = {
    credentialId: string
    publisherId: string
    tokenDigest: string
  }

  async function requireUnarchivedPrototype(prototypeId: string) {
    const prototype = await database.prototype.findUnique({
      where: { id: prototypeId },
      select: { archivedAt: true },
    })
    if (!prototype) error(404, "prototype_not_found", "The prototype was not found.")
    if (prototype.archivedAt) {
      error(409, "prototype_archived", "Archived prototypes cannot be published.")
    }
  }

  async function authenticate(authorization: string, prototypeId: string, action: PublisherAction) {
    parsePrototypeId(prototypeId)
    const match = authorizationSchema.exec(authorization)
    if (!match?.[1] || !match[2]) {
      error(401, "publisher_authentication_required", "Publisher authentication failed.")
    }
    const [, token, credentialId] = match
    const tokenDigest = digestSecret(token)
    const credential = await database.workloadCredential.findUnique({
      where: { id: credentialId },
      include: { workloadPublisher: true },
    })
    if (
      !credential ||
      credential.revokedAt ||
      (credential.expiresAt && credential.expiresAt <= new Date()) ||
      !credential.workloadPublisher.active ||
      credential.workloadPublisher.prototypeId !== prototypeId ||
      !credential.workloadPublisher.actions.includes(action) ||
      !secretsMatch(credential.tokenDigest, tokenDigest)
    ) {
      error(403, "publisher_access_denied", "Publisher access is denied.")
    }
    return {
      credentialId: credential.id,
      publisherId: credential.workloadPublisher.id,
      tokenDigest,
    }
  }

  async function requireCurrentPublisherAuthorization(
    transaction: Prisma.TransactionClient,
    authentication: PublisherAuthentication,
    prototypeId: string,
    action: PublisherAction,
  ) {
    const credential = await transaction.workloadCredential.findUnique({
      where: { id: authentication.credentialId },
      include: { workloadPublisher: true },
    })
    if (
      !credential ||
      credential.revokedAt ||
      (credential.expiresAt && credential.expiresAt <= new Date()) ||
      !credential.workloadPublisher.active ||
      credential.workloadPublisher.id !== authentication.publisherId ||
      credential.workloadPublisher.prototypeId !== prototypeId ||
      !credential.workloadPublisher.actions.includes(action) ||
      !secretsMatch(credential.tokenDigest, authentication.tokenDigest)
    ) {
      error(403, "publisher_access_denied", "Publisher access is denied.")
    }
    return credential.workloadPublisher
  }

  return {
    async publish(authorization, prototypeId, idempotencyKey, input) {
      const authentication = await authenticate(authorization, prototypeId, "publish")
      await requireUnarchivedPrototype(prototypeId)
      const parsed = publishSchema.safeParse(input)
      if (!parsed.success || parsed.data.manifest.prototypeId !== prototypeId) {
        error(422, "invalid_artifact_manifest", "The artifact manifest is invalid.")
      }
      if (
        parsed.data.manifest.artifact.sizeBytes > maximumArtifactBytes ||
        parsed.data.artifactBase64.length > Math.ceil((maximumArtifactBytes * 4) / 3) + 4
      ) {
        error(413, "artifact_too_large", "The artifact exceeds the maximum size.")
      }
      const keyDigest = digestSecret(parseIdempotencyKey(idempotencyKey))
      const bytes = parseArtifactBase64(parsed.data.artifactBase64)
      if (bytes.length !== parsed.data.manifest.artifact.sizeBytes) {
        error(422, "artifact_size_mismatch", "The artifact size does not match the manifest.")
      }
      if (sha256(bytes) !== parsed.data.manifest.artifact.digest) {
        error(422, "artifact_digest_mismatch", "The artifact digest does not match the manifest.")
      }
      const requestDigest = digestSecret(
        JSON.stringify({
          manifest: parsed.data.manifest,
          promoteChannel: parsed.data.promoteChannel ?? null,
        }),
      )
      const stored = await storage.put(parsed.data.manifest.artifact.digest, bytes)

      return database.$transaction(async (transaction) => {
        await lockPrototype(transaction, prototypeId)
        const publisher = await requireCurrentPublisherAuthorization(
          transaction,
          authentication,
          prototypeId,
          "publish",
        )
        const prototype = await transaction.prototype.findUnique({ where: { id: prototypeId } })
        if (!prototype) error(404, "prototype_not_found", "The prototype was not found.")
        if (prototype.archivedAt) {
          error(409, "prototype_archived", "Archived prototypes cannot receive versions.")
        }
        const existing = await transaction.artifactPublication.findUnique({
          where: {
            workloadPublisherId_idempotencyKeyDigest: {
              workloadPublisherId: publisher.id,
              idempotencyKeyDigest: keyDigest,
            },
          },
          include: { prototypeVersion: true },
        })
        if (existing) {
          if (existing.requestDigest !== requestDigest) {
            error(
              409,
              "idempotency_conflict",
              "The idempotency key was already used for a different publication.",
            )
          }
          return {
            version: versionResponse(existing.prototypeVersion),
            replayed: true,
            promotedChannel: parsed.data.promoteChannel ?? null,
          }
        }
        const duplicate = await transaction.prototypeVersion.findFirst({
          where: {
            prototypeId,
            contentDigest: parsed.data.manifest.artifact.digest,
          },
        })
        if (duplicate) {
          error(409, "artifact_already_published", "This artifact was already published.")
        }
        const latest = await transaction.prototypeVersion.findFirst({
          where: { prototypeId },
          orderBy: { sequence: "desc" },
        })
        const manifest = parsed.data.manifest
        const version = await transaction.prototypeVersion.create({
          data: {
            prototypeId,
            workloadPublisherId: publisher.id,
            sequence: (latest?.sequence ?? 0) + 1,
            artifactFormat: manifest.artifact.format,
            artifactVersion: manifest.artifact.version,
            contentDigest: manifest.artifact.digest,
            sizeBytes: manifest.artifact.sizeBytes,
            builtAt: new Date(manifest.artifact.builtAt),
            provenanceProvider: manifest.provenance.provider,
            provenanceSourceUrl: manifest.provenance.sourceUrl ?? null,
            provenanceRevision: manifest.provenance.revision ?? null,
            provenanceRef: manifest.provenance.ref ?? null,
            provenancePipeline: manifest.provenance.pipeline ?? null,
            provenanceRunId: manifest.provenance.runId ?? null,
            storageKey: stored.key,
          },
        })
        await transaction.artifactPublication.create({
          data: {
            prototypeId,
            workloadPublisherId: publisher.id,
            prototypeVersionId: version.id,
            idempotencyKeyDigest: keyDigest,
            requestDigest,
          },
        })
        if (parsed.data.promoteChannel) {
          await transaction.prototypeChannel.upsert({
            where: {
              prototypeId_name: { prototypeId, name: parsed.data.promoteChannel },
            },
            create: {
              prototypeId,
              prototypeVersionId: version.id,
              name: parsed.data.promoteChannel,
            },
            update: { prototypeVersionId: version.id },
          })
        }
        await saveSecurityAudit(transaction, {
          event: "prototype.version.publish",
          actorUserId: null,
          sessionId: null,
          authenticationProviderRevisionId: null,
          workspaceId: prototype.workspaceId,
          prototypeId,
          prototypeVersionId: version.id,
          workloadPublisherId: publisher.id,
          context: {
            source: "workload_publisher",
            ...(parsed.data.promoteChannel
              ? { reason: `channel_${parsed.data.promoteChannel}` }
              : {}),
          },
        })
        return {
          version: versionResponse(version),
          replayed: false,
          promotedChannel: parsed.data.promoteChannel ?? null,
        }
      })
    },

    async getStatus(authorization, prototypeId, idempotencyKey) {
      const authentication = await authenticate(authorization, prototypeId, "read-status")
      const publication = await database.artifactPublication.findUnique({
        where: {
          workloadPublisherId_idempotencyKeyDigest: {
            workloadPublisherId: authentication.publisherId,
            idempotencyKeyDigest: digestSecret(parseIdempotencyKey(idempotencyKey)),
          },
        },
        include: { prototypeVersion: true },
      })
      if (!publication || publication.prototypeId !== prototypeId) {
        error(404, "publication_not_found", "The publication was not found.")
      }
      return {
        publicationId: publication.id,
        version: versionResponse(publication.prototypeVersion),
      }
    },

    async promote(authorization, prototypeId, channel, input) {
      const authentication = await authenticate(authorization, prototypeId, "publish")
      const parsedChannel = channelSchema.safeParse(channel)
      const parsed = promotionSchema.safeParse(input)
      if (!parsedChannel.success || !parsed.success) {
        error(422, "invalid_promotion", "The promotion is invalid.")
      }
      return database.$transaction(async (transaction) => {
        await lockPrototype(transaction, prototypeId)
        const publisher = await requireCurrentPublisherAuthorization(
          transaction,
          authentication,
          prototypeId,
          "publish",
        )
        const prototype = await transaction.prototype.findUnique({ where: { id: prototypeId } })
        if (!prototype) error(404, "prototype_not_found", "The prototype was not found.")
        if (prototype.archivedAt) {
          error(409, "prototype_archived", "Archived prototypes cannot be promoted.")
        }
        const version = await transaction.prototypeVersion.findFirst({
          where: { id: parsed.data.versionId, prototypeId },
        })
        if (!version) error(404, "version_not_found", "The version was not found.")
        const pointer = await transaction.prototypeChannel.upsert({
          where: {
            prototypeId_name: {
              prototypeId,
              name: parsedChannel.data satisfies PrototypeChannelName,
            },
          },
          create: {
            prototypeId,
            prototypeVersionId: version.id,
            name: parsedChannel.data,
          },
          update: { prototypeVersionId: version.id },
        })
        await saveSecurityAudit(transaction, {
          event: "prototype.channel.promote",
          actorUserId: null,
          sessionId: null,
          authenticationProviderRevisionId: null,
          workspaceId: prototype.workspaceId,
          prototypeId,
          prototypeVersionId: version.id,
          workloadPublisherId: publisher.id,
          context: {
            source: "workload_publisher",
            reason: `channel_${parsedChannel.data}`,
          },
        })
        return pointer
      })
    },
  }
}
