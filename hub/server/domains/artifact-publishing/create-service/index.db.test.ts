import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"

import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createArtifactPublishingService } from "#server/domains/artifact-publishing/create-service"
import { maximumArtifactBytes } from "#server/domains/artifact-publishing/create-service/constants"
import type { ArtifactManifest } from "#server/domains/artifact-publishing/create-service/types"
import { createIdentityStore } from "#server/domains/identity/create-store"
import { createPrototypeAuthorizationService } from "#server/domains/prototype-authorization/create-service"
import type { ArtifactStorage } from "#server/integrations/artifact-storage/types"
import { digestSecret } from "#server/utils/digest-secret"

import type { PrismaClient } from "../../../generated/prisma/client.ts"

function artifact(content: string) {
  return artifactBytes(Buffer.from(content))
}

function artifactBytes(bytes: Buffer) {
  return {
    bytes,
    base64: bytes.toString("base64"),
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  }
}

function manifest(
  prototypeId: string,
  publishedArtifact: ReturnType<typeof artifact>,
  overrides: Partial<ArtifactManifest> = {},
): ArtifactManifest {
  return {
    schemaVersion: 1,
    prototypeId,
    artifact: {
      format: "replica-build",
      version: "1",
      digest: publishedArtifact.digest,
      sizeBytes: publishedArtifact.bytes.length,
      builtAt: "2026-10-27T20:00:00.000Z",
    },
    provenance: {
      provider: "build-system",
      sourceUrl: "https://ci.example/runs/123",
      revision: "abc123",
      ref: "refs/heads/main",
      pipeline: "publish",
      runId: "123",
    },
    ...overrides,
  }
}

async function database(storageOverride?: ArtifactStorage) {
  vi.stubGlobal("prisma", undefined)
  const { prisma } = await import("../../../integrations/prisma")
  onTestFinished(() => prisma.$disconnect())

  const stored = new Map<string, Uint8Array>()
  const storage: ArtifactStorage = storageOverride ?? {
    put(digest, bytes) {
      const key = digest.replace(":", "/")
      const created = !stored.has(key)
      if (created) stored.set(key, bytes.slice())
      return Promise.resolve({ key, created })
    },
    read(key) {
      const bytes = stored.get(key)
      return bytes
        ? Promise.resolve(bytes.slice())
        : Promise.reject(new Error("Artifact not found"))
    },
    remove(key) {
      stored.delete(key)
      return Promise.resolve()
    },
  }

  return {
    prisma,
    storage,
    service: createArtifactPublishingService({ database: prisma, storage }),
  }
}

function deferred() {
  let resolvePromise!: () => void
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

async function waitForBlockedDatabaseQuery(database: PrismaClient, queryPattern: string) {
  await vi.waitFor(
    async () => {
      const [result] = await database.$queryRaw<{ blocked: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'
            AND query LIKE ${queryPattern}
        ) AS blocked
      `
      expect(result?.blocked).toBe(true)
    },
    { interval: 20, timeout: 5_000 },
  )
}

async function holdPublisherAuthorizationRow(
  database: PrismaClient,
  target: { type: "credential" | "publisher"; id: string },
) {
  const released = deferred()
  const locked = deferred()
  const holder = database.$transaction(async (transaction) => {
    if (target.type === "credential") {
      await transaction.$queryRaw`
        SELECT "id" FROM "workload_credentials" WHERE "id" = ${target.id}::uuid FOR UPDATE
      `
    } else {
      await transaction.$queryRaw`
        SELECT "id" FROM "workload_publishers" WHERE "id" = ${target.id}::uuid FOR UPDATE
      `
    }
    locked.resolve()
    await released.promise
  })
  await locked.promise
  return { holder, release: released.resolve }
}

async function holdPrototypeRow(database: PrismaClient, prototypeId: string) {
  const released = deferred()
  const locked = deferred()
  const holder = database.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id" FROM "prototypes" WHERE "id" = ${prototypeId}::uuid FOR UPDATE
    `
    locked.resolve()
    await released.promise
  })
  await locked.promise
  return { holder, release: released.resolve }
}

async function createPrototype(prisma: PrismaClient) {
  const user = await prisma.user.create({ data: { displayName: "Publisher owner" } })
  const workspace = await prisma.workspace.create({
    data: {
      name: "Workspace",
      createdByUserId: user.id,
    },
  })
  const prototype = await prisma.prototype.create({
    data: {
      name: "Prototype",
      workspaceId: workspace.id,
      createdByUserId: user.id,
    },
  })
  return { prototype, user, workspace }
}

async function createAdministratorSession(prisma: PrismaClient, token: string) {
  const store = createIdentityStore(prisma)
  const authorizedAt = new Date()
  const actor = await store.lock(async (records) => {
    const user = await records.createUser({
      displayName: "Prototype administrator",
      avatarUrl: null,
    })
    const identity = await records.saveExternalIdentity({
      userId: user.id,
      provider: "github",
      issuer: "https://github.com",
      subject: "publisher-administrator",
      username: "publisher-administrator",
      displayName: user.displayName,
      avatarUrl: null,
    })
    const provider = await records.createAuthenticationProviderRevision({
      key: "github",
      type: "github",
      enabled: true,
      revision: 1,
      issuer: "https://github.com",
      configuration: { clientId: "github-client" },
    })
    await records.saveMembership({
      userId: user.id,
      status: "active",
      role: "member",
      source: "manual",
    })
    await records.createSession({
      userId: user.id,
      externalIdentityId: identity.id,
      authenticationProviderRevisionId: provider.id,
      tokenDigest: digestSecret(token),
      signedInAt: authorizedAt,
      freshAuthorizedAt: authorizedAt,
    })
    return user
  })
  return { actor, store }
}

async function createPublisherAdministrator(prisma: PrismaClient, sessionToken: string) {
  const { actor, store } = await createAdministratorSession(prisma, sessionToken)
  const workspace = await prisma.workspace.create({
    data: {
      name: "Publisher workspace",
      createdByUserId: actor.id,
      grants: {
        create: {
          userId: actor.id,
          effect: "allow",
          role: "administrator",
        },
      },
    },
  })
  const prototype = await prisma.prototype.create({
    data: {
      name: "Publisher prototype",
      workspaceId: workspace.id,
      createdByUserId: actor.id,
    },
  })
  const authorization = createPrototypeAuthorizationService({ database: prisma, store })
  return { authorization, prototype }
}

async function provisionPublisher(prisma: PrismaClient, sessionToken: string) {
  const { authorization, prototype } = await createPublisherAdministrator(prisma, sessionToken)
  const provisioned = (await authorization.createPublisherCredential(sessionToken, prototype.id, {
    name: "CI publisher",
    actions: ["publish", "read-status"],
  })) as {
    publisher: { id: string }
    credential: { id: string; token: string }
  }
  return {
    authorization,
    prototype,
    provisioned,
    workloadAuthorization: `Bearer ${provisioned.credential.token}`,
  }
}

async function createCredential(
  prisma: PrismaClient,
  prototypeId: string,
  actions: ("publish" | "read-status")[] = ["publish", "read-status"],
) {
  const credentialId = randomUUID()
  const token = `rpl_pub_${credentialId}.${"t".repeat(43)}`
  const publisher = await prisma.workloadPublisher.create({
    data: {
      prototypeId,
      name: "CI publisher",
      actions,
      credentials: {
        create: {
          id: credentialId,
          tokenDigest: digestSecret(token),
        },
      },
    },
  })
  return {
    authorization: `Bearer ${token}`,
    credentialId,
    publisher,
    token,
  }
}

function publicationInput(
  prototypeId: string,
  publishedArtifact: ReturnType<typeof artifact>,
  overrides: Record<string, unknown> = {},
) {
  return {
    manifest: manifest(prototypeId, publishedArtifact),
    artifactBase64: publishedArtifact.base64,
    ...overrides,
  }
}

function publishedVersion(result: { version: unknown }) {
  if (
    result.version === null ||
    typeof result.version !== "object" ||
    !("id" in result.version) ||
    typeof result.version.id !== "string"
  ) {
    throw new Error("Expected a published version")
  }
  return { id: result.version.id }
}

describe("createArtifactPublishingService() database behavior", () => {
  it.each([
    {
      name: "unknown manifest field",
      change: (valid: ReturnType<typeof publicationInput>) => ({
        ...valid,
        manifest: { ...valid.manifest, unrecognized: true },
      }),
    },
    {
      name: "unknown artifact field",
      change: (valid: ReturnType<typeof publicationInput>) => ({
        ...valid,
        manifest: {
          ...valid.manifest,
          artifact: { ...valid.manifest.artifact, unrecognized: true },
        },
      }),
    },
    {
      name: "unknown provenance field",
      change: (valid: ReturnType<typeof publicationInput>) => ({
        ...valid,
        manifest: {
          ...valid.manifest,
          provenance: { ...valid.manifest.provenance, unrecognized: true },
        },
      }),
    },
    {
      name: "unsupported schema version",
      change: (valid: ReturnType<typeof publicationInput>) => ({
        ...valid,
        manifest: { ...valid.manifest, schemaVersion: 2 },
      }),
    },
    {
      name: "non-HTTP provenance URL",
      change: (valid: ReturnType<typeof publicationInput>) => ({
        ...valid,
        manifest: {
          ...valid.manifest,
          provenance: { ...valid.manifest.provenance, sourceUrl: "file:///private/build" },
        },
      }),
    },
    {
      name: "malformed provenance URL",
      change: (valid: ReturnType<typeof publicationInput>) => ({
        ...valid,
        manifest: {
          ...valid.manifest,
          provenance: { ...valid.manifest.provenance, sourceUrl: "https://[invalid" },
        },
      }),
    },
    {
      name: "provenance URL username",
      change: (valid: ReturnType<typeof publicationInput>) => ({
        ...valid,
        manifest: {
          ...valid.manifest,
          provenance: {
            ...valid.manifest.provenance,
            sourceUrl: "https://publisher@ci.example/runs/123",
          },
        },
      }),
    },
    {
      name: "provenance URL password",
      change: (valid: ReturnType<typeof publicationInput>) => ({
        ...valid,
        manifest: {
          ...valid.manifest,
          provenance: {
            ...valid.manifest.provenance,
            sourceUrl: "https://publisher:secret@ci.example/runs/123",
          },
        },
      }),
    },
    {
      name: "provenance URL query",
      change: (valid: ReturnType<typeof publicationInput>) => ({
        ...valid,
        manifest: {
          ...valid.manifest,
          provenance: {
            ...valid.manifest.provenance,
            sourceUrl: "https://ci.example/runs/123?token=private",
          },
        },
      }),
    },
    {
      name: "provenance URL fragment",
      change: (valid: ReturnType<typeof publicationInput>) => ({
        ...valid,
        manifest: {
          ...valid.manifest,
          provenance: {
            ...valid.manifest.provenance,
            sourceUrl: "https://ci.example/runs/123#private",
          },
        },
      }),
    },
    {
      name: "different prototype identifier",
      change: (valid: ReturnType<typeof publicationInput>) => ({
        ...valid,
        manifest: { ...valid.manifest, prototypeId: randomUUID() },
      }),
    },
  ])("rejects a manifest with $name before creating a version", async ({ change }) => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)
    const publishedArtifact = artifact("manifest-validation")

    await expect(
      context.service.publish(
        credential.authorization,
        prototype.id,
        "manifest-case",
        change(publicationInput(prototype.id, publishedArtifact)),
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: "invalid_artifact_manifest",
    })
    expect(await context.prisma.prototypeVersion.count()).toBe(0)
  })

  it.each(["provider", "sourceUrl", "revision", "ref", "pipeline", "runId"] as const)(
    "rejects a NUL in provenance $field before storage or state changes",
    async (field) => {
      const put = vi.fn(() => Promise.resolve({ key: "unused", created: true }))
      const storage: ArtifactStorage = {
        put,
        read: () => Promise.reject(new Error("Artifact not found")),
        remove: () => Promise.resolve(),
      }
      const context = await database(storage)
      const { prototype } = await createPrototype(context.prisma)
      const credential = await createCredential(context.prisma, prototype.id)
      const input = publicationInput(prototype.id, artifact(`nul-${field}`))
      input.manifest.provenance = {
        ...input.manifest.provenance,
        [field]: field === "sourceUrl" ? "https://ci.example/runs/\0hidden" : "visible\0hidden",
      }

      await expect(
        context.service.publish(credential.authorization, prototype.id, `nul-${field}`, input),
      ).rejects.toMatchObject({
        status: 422,
        code: "invalid_artifact_manifest",
      })
      expect(put).not.toHaveBeenCalled()
      await expect(
        Promise.all([
          context.prisma.prototypeVersion.count(),
          context.prisma.artifactPublication.count(),
          context.prisma.securityAudit.count(),
        ]),
      ).resolves.toEqual([0, 0, 0])
    },
  )

  it("publishes a valid artifact at the decoded size limit", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)
    const publishedArtifact = artifactBytes(Buffer.alloc(maximumArtifactBytes, 0x61))

    await expect(
      context.service.publish(
        credential.authorization,
        prototype.id,
        "maximum-artifact",
        publicationInput(prototype.id, publishedArtifact),
      ),
    ).resolves.toMatchObject({ replayed: false })
  })

  it("reports a correctly shaped artifact over the decoded size limit as too large", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)
    const publishedArtifact = artifactBytes(Buffer.alloc(maximumArtifactBytes + 1, 0x61))

    await expect(
      context.service.publish(
        credential.authorization,
        prototype.id,
        "oversized-artifact",
        publicationInput(prototype.id, publishedArtifact),
      ),
    ).rejects.toMatchObject({ status: 413, code: "artifact_too_large" })
    expect(await context.prisma.prototypeVersion.count()).toBe(0)
  })

  it("rejects noncanonical base64 as an invalid artifact instead of an oversized artifact", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)
    const input = publicationInput(prototype.id, artifact("base64"))
    input.artifactBase64 = "AB=="

    await expect(
      context.service.publish(credential.authorization, prototype.id, "invalid-base64", input),
    ).rejects.toMatchObject({ status: 422, code: "invalid_artifact" })
  })

  it("rejects malformed workload credential identifiers before querying the database", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const findCredential = vi.spyOn(context.prisma.workloadCredential, "findUnique")

    await expect(
      context.service.publish(
        `Bearer rpl_pub_00000000-0000-0000-0000-00000000000-.${"t".repeat(43)}`,
        prototype.id,
        "malformed-credential",
        publicationInput(prototype.id, artifact("malformed-credential")),
      ),
    ).rejects.toMatchObject({ status: 401, code: "publisher_authentication_required" })
    expect(findCredential).not.toHaveBeenCalled()
  })

  it("rejects an artifact whose decoded size differs from the manifest", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)
    const publishedArtifact = artifact("size-mismatch")
    const input = publicationInput(prototype.id, publishedArtifact)
    input.manifest.artifact.sizeBytes += 1

    await expect(
      context.service.publish(credential.authorization, prototype.id, "size-case", input),
    ).rejects.toMatchObject({
      status: 422,
      code: "artifact_size_mismatch",
    })
    expect(await context.prisma.prototypeVersion.count()).toBe(0)
  })

  it("rejects an artifact whose content digest differs from the manifest", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)
    const publishedArtifact = artifact("digest-mismatch")
    const input = publicationInput(prototype.id, publishedArtifact)
    input.manifest.artifact.digest = artifact("different-content").digest

    await expect(
      context.service.publish(credential.authorization, prototype.id, "digest-case", input),
    ).rejects.toMatchObject({
      status: 422,
      code: "artifact_digest_mismatch",
    })
    expect(await context.prisma.prototypeVersion.count()).toBe(0)
  })

  it("stores only a digest of a prototype-scoped workload token", async () => {
    const context = await database()
    const sessionToken = "publisher-administrator-session"
    const { actor, store } = await createAdministratorSession(context.prisma, sessionToken)
    const workspace = await context.prisma.workspace.create({
      data: {
        name: "Credential workspace",
        createdByUserId: actor.id,
        grants: {
          create: {
            userId: actor.id,
            effect: "allow",
            role: "administrator",
          },
        },
      },
    })
    const prototype = await context.prisma.prototype.create({
      data: {
        name: "Credential prototype",
        workspaceId: workspace.id,
        createdByUserId: actor.id,
      },
    })
    const authorization = createPrototypeAuthorizationService({
      database: context.prisma,
      store,
    })
    const provisioned = await authorization.createPublisherCredential(sessionToken, prototype.id, {
      name: "CI publisher",
      actions: ["publish", "read-status"],
    })
    if (
      provisioned === null ||
      typeof provisioned !== "object" ||
      !("credential" in provisioned) ||
      provisioned.credential === null ||
      typeof provisioned.credential !== "object" ||
      !("id" in provisioned.credential) ||
      typeof provisioned.credential.id !== "string" ||
      !("token" in provisioned.credential) ||
      typeof provisioned.credential.token !== "string"
    ) {
      throw new Error("Expected a provisioned workload credential")
    }

    const saved = await context.prisma.workloadCredential.findUniqueOrThrow({
      where: { id: provisioned.credential.id },
    })

    expect(saved.tokenDigest).toBe(digestSecret(provisioned.credential.token))
    expect(saved.tokenDigest).not.toContain(provisioned.credential.token)
    expect(JSON.stringify(saved)).not.toContain(provisioned.credential.token)
  })

  it("rejects provisioning a workload credential that is already expired", async () => {
    const context = await database()
    const sessionToken = "expired-provisioning-session"
    const { authorization, prototype } = await createPublisherAdministrator(
      context.prisma,
      sessionToken,
    )

    await expect(
      authorization.createPublisherCredential(sessionToken, prototype.id, {
        name: "Expired publisher",
        actions: ["publish", "read-status"],
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_workload_publisher" })
    expect(
      await context.prisma.workloadPublisher.count({ where: { prototypeId: prototype.id } }),
    ).toBe(0)
    expect(
      await context.prisma.securityAudit.count({
        where: { prototypeId: prototype.id, event: "prototype.publisher.create" },
      }),
    ).toBe(0)
  })

  it("accepts and persists an ordinary HTTPS provenance source URL", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)
    const sourceUrl = "https://ci.example/runs/ordinary"

    const result = await context.service.publish(
      credential.authorization,
      prototype.id,
      "ordinary-source-url",
      publicationInput(prototype.id, artifact("ordinary-source-url"), {
        manifest: manifest(prototype.id, artifact("ordinary-source-url"), {
          provenance: {
            provider: "build-system",
            sourceUrl,
            revision: "abc123",
            ref: "refs/heads/main",
            pipeline: "publish",
            runId: "123",
          },
        }),
      }),
    )

    expect(
      await context.prisma.prototypeVersion.findUniqueOrThrow({
        where: { id: publishedVersion(result).id },
        select: { provenanceSourceUrl: true },
      }),
    ).toEqual({ provenanceSourceUrl: sourceUrl })
  })

  it("keeps a revoked credential unusable after its publisher is disabled and re-enabled", async () => {
    const context = await database()
    const sessionToken = "publisher-lifecycle-session"
    const { authorization, prototype, provisioned, workloadAuthorization } =
      await provisionPublisher(context.prisma, sessionToken)

    await context.service.publish(
      workloadAuthorization,
      prototype.id,
      "before-disable",
      publicationInput(prototype.id, artifact("before-disable")),
    )
    await authorization.setPublisherActive(sessionToken, prototype.id, provisioned.publisher.id, {
      active: false,
    })
    await expect(
      context.service.publish(
        workloadAuthorization,
        prototype.id,
        "while-disabled",
        publicationInput(prototype.id, artifact("while-disabled")),
      ),
    ).rejects.toMatchObject({ status: 403, code: "publisher_access_denied" })

    await authorization.setPublisherActive(sessionToken, prototype.id, provisioned.publisher.id, {
      active: true,
    })
    await context.service.publish(
      workloadAuthorization,
      prototype.id,
      "after-enable",
      publicationInput(prototype.id, artifact("after-enable")),
    )
    await authorization.revokePublisherCredential(
      sessionToken,
      prototype.id,
      provisioned.publisher.id,
      provisioned.credential.id,
    )
    await authorization.setPublisherActive(sessionToken, prototype.id, provisioned.publisher.id, {
      active: false,
    })
    await authorization.setPublisherActive(sessionToken, prototype.id, provisioned.publisher.id, {
      active: true,
    })

    await expect(
      context.service.publish(
        workloadAuthorization,
        prototype.id,
        "after-revocation",
        publicationInput(prototype.id, artifact("after-revocation")),
      ),
    ).rejects.toMatchObject({ status: 403, code: "publisher_access_denied" })
    expect(
      await context.prisma.prototypeVersion.count({ where: { prototypeId: prototype.id } }),
    ).toBe(2)
  })

  it.each([
    { mutation: "revoke", operation: "publish" },
    { mutation: "disable", operation: "publish" },
    { mutation: "revoke", operation: "promote" },
    { mutation: "disable", operation: "promote" },
  ] as const)(
    "rejects an already-started $operation after an administrator wins the $mutation race",
    async ({ mutation, operation }) => {
      const context = await database()
      const sessionToken = `${mutation}-${operation}-session`
      const { authorization, prototype, provisioned, workloadAuthorization } =
        await provisionPublisher(context.prisma, sessionToken)
      const published =
        operation === "promote"
          ? await context.service.publish(
              workloadAuthorization,
              prototype.id,
              `${mutation}-promotion-source`,
              publicationInput(prototype.id, artifact(`${mutation}-promotion-source`)),
            )
          : null
      const version = published ? publishedVersion(published) : null
      const authorizationRow =
        mutation === "revoke"
          ? { type: "credential" as const, id: provisioned.credential.id }
          : { type: "publisher" as const, id: provisioned.publisher.id }
      const authorizationTable =
        mutation === "revoke" ? "workload_credentials" : "workload_publishers"
      const before = {
        publications: await context.prisma.artifactPublication.count({
          where: { prototypeId: prototype.id },
        }),
        versions: await context.prisma.prototypeVersion.count({
          where: { prototypeId: prototype.id },
        }),
        channels: await context.prisma.prototypeChannel.findMany({
          where: { prototypeId: prototype.id },
          select: { name: true, prototypeVersionId: true },
          orderBy: { name: "asc" },
        }),
        workloadAudits: await context.prisma.securityAudit.count({
          where: {
            prototypeId: prototype.id,
            event: { in: ["prototype.version.publish", "prototype.channel.promote"] },
          },
        }),
      }
      const rowLock = await holdPublisherAuthorizationRow(context.prisma, authorizationRow)

      const administratorMutation =
        mutation === "revoke"
          ? authorization.revokePublisherCredential(
              sessionToken,
              prototype.id,
              provisioned.publisher.id,
              provisioned.credential.id,
            )
          : authorization.setPublisherActive(sessionToken, prototype.id, provisioned.publisher.id, {
              active: false,
            })
      await waitForBlockedDatabaseQuery(context.prisma, `%${authorizationTable}%`)

      const workloadResult = (
        operation === "publish"
          ? context.service.publish(
              workloadAuthorization,
              prototype.id,
              `${mutation}-concurrent-publish`,
              publicationInput(prototype.id, artifact(`${mutation}-concurrent-publish`)),
            )
          : context.service.promote(workloadAuthorization, prototype.id, "current", {
              versionId: version!.id,
            })
      ).then(
        () => ({ error: null }),
        (error: unknown) => ({ error }),
      )
      await waitForBlockedDatabaseQuery(context.prisma, "%prototypes%FOR UPDATE%")

      rowLock.release()
      await rowLock.holder
      await administratorMutation

      expect((await workloadResult).error).toMatchObject({
        status: 403,
        code: "publisher_access_denied",
      })
      expect({
        publications: await context.prisma.artifactPublication.count({
          where: { prototypeId: prototype.id },
        }),
        versions: await context.prisma.prototypeVersion.count({
          where: { prototypeId: prototype.id },
        }),
        channels: await context.prisma.prototypeChannel.findMany({
          where: { prototypeId: prototype.id },
          select: { name: true, prototypeVersionId: true },
          orderBy: { name: "asc" },
        }),
        workloadAudits: await context.prisma.securityAudit.count({
          where: {
            prototypeId: prototype.id,
            event: { in: ["prototype.version.publish", "prototype.channel.promote"] },
          },
        }),
      }).toEqual(before)
    },
  )

  it.each(["publish", "promote"] as const)(
    "rejects an already-started %s when its credential expires while waiting for the prototype lock",
    async (operation) => {
      const context = await database()
      const sessionToken = `expiring-${operation}-session`
      const { prototype, provisioned, workloadAuthorization } = await provisionPublisher(
        context.prisma,
        sessionToken,
      )
      const published =
        operation === "promote"
          ? await context.service.publish(
              workloadAuthorization,
              prototype.id,
              "expiration-promotion-source",
              publicationInput(prototype.id, artifact("expiration-promotion-source")),
            )
          : null
      const expiresAt = new Date(Date.now() + 60_000)
      await context.prisma.workloadCredential.update({
        where: { id: provisioned.credential.id },
        data: { expiresAt },
      })
      const before = {
        publications: await context.prisma.artifactPublication.count({
          where: { prototypeId: prototype.id },
        }),
        versions: await context.prisma.prototypeVersion.count({
          where: { prototypeId: prototype.id },
        }),
        channels: await context.prisma.prototypeChannel.findMany({
          where: { prototypeId: prototype.id },
          select: { name: true, prototypeVersionId: true },
        }),
        workloadAudits: await context.prisma.securityAudit.count({
          where: {
            prototypeId: prototype.id,
            event: { in: ["prototype.version.publish", "prototype.channel.promote"] },
          },
        }),
      }
      const prototypeLock = await holdPrototypeRow(context.prisma, prototype.id)
      onTestFinished(prototypeLock.release)
      const workloadResult =
        operation === "publish"
          ? context.service.publish(
              workloadAuthorization,
              prototype.id,
              "expired-while-blocked",
              publicationInput(prototype.id, artifact("expired-while-blocked")),
            )
          : context.service.promote(workloadAuthorization, prototype.id, "current", {
              versionId: publishedVersion(published!).id,
            })
      await waitForBlockedDatabaseQuery(context.prisma, "%prototypes%FOR UPDATE%")

      vi.useFakeTimers({ toFake: ["Date"] })
      vi.setSystemTime(expiresAt.getTime() + 1)
      prototypeLock.release()
      await prototypeLock.holder

      await expect(workloadResult).rejects.toMatchObject({
        status: 403,
        code: "publisher_access_denied",
      })
      expect({
        publications: await context.prisma.artifactPublication.count({
          where: { prototypeId: prototype.id },
        }),
        versions: await context.prisma.prototypeVersion.count({
          where: { prototypeId: prototype.id },
        }),
        channels: await context.prisma.prototypeChannel.findMany({
          where: { prototypeId: prototype.id },
          select: { name: true, prototypeVersionId: true },
        }),
        workloadAudits: await context.prisma.securityAudit.count({
          where: {
            prototypeId: prototype.id,
            event: { in: ["prototype.version.publish", "prototype.channel.promote"] },
          },
        }),
      }).toEqual(before)
    },
  )

  it("enforces publish and read-status action scopes independently", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const publishOnly = await createCredential(context.prisma, prototype.id, ["publish"])
    const statusOnly = await createCredential(context.prisma, prototype.id, ["read-status"])
    const publishedArtifact = artifact("action-scope")

    await context.service.publish(
      publishOnly.authorization,
      prototype.id,
      "action-scope",
      publicationInput(prototype.id, publishedArtifact),
    )

    await expect(
      context.service.getStatus(publishOnly.authorization, prototype.id, "action-scope"),
    ).rejects.toMatchObject({ status: 403, code: "publisher_access_denied" })
    await expect(
      context.service.publish(
        statusOnly.authorization,
        prototype.id,
        "status-cannot-publish",
        publicationInput(prototype.id, artifact("status-only")),
      ),
    ).rejects.toMatchObject({ status: 403, code: "publisher_access_denied" })
  })

  it("rejects status reads after the workload credential expires", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)
    await context.service.publish(
      credential.authorization,
      prototype.id,
      "expired-status",
      publicationInput(prototype.id, artifact("expired-status")),
    )
    await context.prisma.workloadCredential.update({
      where: { id: credential.credentialId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    })

    await expect(
      context.service.getStatus(credential.authorization, prototype.id, "expired-status"),
    ).rejects.toMatchObject({ status: 403, code: "publisher_access_denied" })
  })

  it("rejects a canonical wrong secret for an existing credential before storage or state changes", async () => {
    const put = vi.fn((contentDigest: string) =>
      Promise.resolve({
        key: contentDigest.replace(":", "/"),
        created: true,
      }),
    )
    const storage: ArtifactStorage = {
      put,
      read: vi.fn(),
      remove: vi.fn(),
    }
    const context = await database(storage)
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)
    await context.service.publish(
      credential.authorization,
      prototype.id,
      "wrong-secret-status",
      publicationInput(prototype.id, artifact("wrong-secret-status")),
    )
    put.mockClear()
    const wrongToken = `${["rpl", "pub"].join("_")}_${credential.credentialId}.${"w".repeat(43)}`
    const wrongAuthorization = `Bearer ${wrongToken}`
    const before = {
      publications: await context.prisma.artifactPublication.count({
        where: { prototypeId: prototype.id },
      }),
      versions: await context.prisma.prototypeVersion.count({
        where: { prototypeId: prototype.id },
      }),
      workloadAudits: await context.prisma.securityAudit.count({
        where: { prototypeId: prototype.id, event: "prototype.version.publish" },
      }),
    }

    await expect(
      context.service.getStatus(wrongAuthorization, prototype.id, "wrong-secret-status"),
    ).rejects.toMatchObject({ status: 403, code: "publisher_access_denied" })
    await expect(
      context.service.publish(
        wrongAuthorization,
        prototype.id,
        "wrong-secret-publish",
        publicationInput(prototype.id, artifact("wrong-secret-publish")),
      ),
    ).rejects.toMatchObject({ status: 403, code: "publisher_access_denied" })

    expect(put).not.toHaveBeenCalled()
    expect({
      publications: await context.prisma.artifactPublication.count({
        where: { prototypeId: prototype.id },
      }),
      versions: await context.prisma.prototypeVersion.count({
        where: { prototypeId: prototype.id },
      }),
      workloadAudits: await context.prisma.securityAudit.count({
        where: { prototypeId: prototype.id, event: "prototype.version.publish" },
      }),
    }).toEqual(before)
  })

  it("rejects a credential issued for a different prototype", async () => {
    const context = await database()
    const first = await createPrototype(context.prisma)
    const second = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, first.prototype.id)

    await expect(
      context.service.publish(
        credential.authorization,
        second.prototype.id,
        "cross-prototype",
        publicationInput(second.prototype.id, artifact("isolated")),
      ),
    ).rejects.toMatchObject({ status: 403, code: "publisher_access_denied" })
    expect(
      await context.prisma.prototypeVersion.count({
        where: { prototypeId: second.prototype.id },
      }),
    ).toBe(0)
  })

  it("returns the same immutable version for an idempotent retry", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)
    const input = publicationInput(prototype.id, artifact("idempotent"))

    const first = await context.service.publish(
      credential.authorization,
      prototype.id,
      "same-request",
      input,
    )
    const replay = await context.service.publish(
      credential.authorization,
      prototype.id,
      "same-request",
      input,
    )

    expect(first).toMatchObject({ replayed: false })
    expect(replay).toMatchObject({ replayed: true, version: publishedVersion(first) })
    expect(
      await context.prisma.prototypeVersion.count({ where: { prototypeId: prototype.id } }),
    ).toBe(1)
    expect(
      await context.prisma.artifactPublication.count({
        where: { workloadPublisherId: credential.publisher.id },
      }),
    ).toBe(1)
  })

  it("normalizes uppercase prototype identifiers across publishing operations", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const other = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)
    const uppercasePrototypeId = prototype.id.toUpperCase()
    const uppercaseInput = publicationInput(
      uppercasePrototypeId,
      artifact("uppercase-prototype-id"),
    )

    const first = await context.service.publish(
      credential.authorization,
      uppercasePrototypeId,
      "uppercase-request",
      uppercaseInput,
    )
    const replay = await context.service.publish(
      credential.authorization,
      prototype.id,
      "uppercase-request",
      publicationInput(prototype.id, artifact("uppercase-prototype-id")),
    )
    const status = await context.service.getStatus(
      credential.authorization,
      uppercasePrototypeId,
      "uppercase-request",
    )
    await context.service.promote(credential.authorization, uppercasePrototypeId, "current", {
      versionId: publishedVersion(first).id,
    })

    expect(first).toMatchObject({ replayed: false })
    expect(replay).toMatchObject({ replayed: true, version: publishedVersion(first) })
    expect(status).toMatchObject({ version: publishedVersion(first) })
    await expect(
      context.prisma.prototypeChannel.findUniqueOrThrow({
        where: { prototypeId_name: { prototypeId: prototype.id, name: "current" } },
        select: { prototypeVersionId: true },
      }),
    ).resolves.toEqual({ prototypeVersionId: publishedVersion(first).id })
    await expect(
      context.service.publish(
        credential.authorization,
        other.prototype.id.toUpperCase(),
        "uppercase-cross-prototype",
        publicationInput(other.prototype.id.toUpperCase(), artifact("isolated-uppercase")),
      ),
    ).rejects.toMatchObject({ status: 403, code: "publisher_access_denied" })
    expect(
      await context.prisma.prototypeVersion.count({
        where: { prototypeId: other.prototype.id },
      }),
    ).toBe(0)
  })

  it("commits a promoted publication, version, channel, and audit together", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)
    const input = publicationInput(prototype.id, artifact("publish-and-promote"), {
      promoteChannel: "preview",
    })

    const result = await context.service.publish(
      credential.authorization,
      prototype.id,
      "publish-and-promote",
      input,
    )
    const version = publishedVersion(result)

    expect(result).toMatchObject({ replayed: false, promotedChannel: "preview" })
    expect(
      await context.prisma.prototypeVersion.findMany({
        where: { prototypeId: prototype.id },
        select: { id: true, workloadPublisherId: true },
      }),
    ).toEqual([{ id: version.id, workloadPublisherId: credential.publisher.id }])
    expect(
      await context.prisma.artifactPublication.findMany({
        where: { prototypeId: prototype.id },
        select: { prototypeVersionId: true, workloadPublisherId: true },
      }),
    ).toEqual([
      {
        prototypeVersionId: version.id,
        workloadPublisherId: credential.publisher.id,
      },
    ])
    expect(
      await context.prisma.prototypeChannel.findMany({
        where: { prototypeId: prototype.id },
        select: { name: true, prototypeVersionId: true },
      }),
    ).toEqual([{ name: "preview", prototypeVersionId: version.id }])
    expect(
      await context.prisma.securityAudit.findMany({
        where: { prototypeId: prototype.id, event: "prototype.version.publish" },
        select: { prototypeVersionId: true, workloadPublisherId: true },
      }),
    ).toEqual([
      {
        prototypeVersionId: version.id,
        workloadPublisherId: credential.publisher.id,
      },
    ])
  })

  it("does not move a later channel promotion when replaying an earlier publication", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)
    const firstInput = publicationInput(prototype.id, artifact("earlier-publication"), {
      promoteChannel: "current",
    })
    const first = await context.service.publish(
      credential.authorization,
      prototype.id,
      "earlier-publication",
      firstInput,
    )
    const second = await context.service.publish(
      credential.authorization,
      prototype.id,
      "later-publication",
      publicationInput(prototype.id, artifact("later-publication"), {
        promoteChannel: "current",
      }),
    )

    await expect(
      context.service.publish(
        credential.authorization,
        prototype.id,
        "earlier-publication",
        firstInput,
      ),
    ).resolves.toMatchObject({
      replayed: true,
      version: publishedVersion(first),
      promotedChannel: "current",
    })
    expect(
      await context.prisma.prototypeChannel.findUniqueOrThrow({
        where: { prototypeId_name: { prototypeId: prototype.id, name: "current" } },
        select: { prototypeVersionId: true },
      }),
    ).toEqual({ prototypeVersionId: publishedVersion(second).id })
  })

  it("isolates status reads for publishers that reuse the same idempotency key", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const firstPublisher = await createCredential(context.prisma, prototype.id)
    const secondPublisher = await createCredential(context.prisma, prototype.id)
    const first = await context.service.publish(
      firstPublisher.authorization,
      prototype.id,
      "shared-request-key",
      publicationInput(prototype.id, artifact("first publisher version")),
    )
    const second = await context.service.publish(
      secondPublisher.authorization,
      prototype.id,
      "shared-request-key",
      publicationInput(prototype.id, artifact("second publisher version")),
    )

    await expect(
      context.service.getStatus(firstPublisher.authorization, prototype.id, "shared-request-key"),
    ).resolves.toMatchObject({ version: publishedVersion(first) })
    await expect(
      context.service.getStatus(secondPublisher.authorization, prototype.id, "shared-request-key"),
    ).resolves.toMatchObject({ version: publishedVersion(second) })
  })

  it("rejects reuse of an idempotency key for a different publication", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)
    const publishedArtifact = artifact("idempotency-conflict")
    const first = publicationInput(prototype.id, publishedArtifact)
    const conflicting = publicationInput(prototype.id, publishedArtifact)
    conflicting.manifest.provenance.runId = "different-run"

    await context.service.publish(credential.authorization, prototype.id, "reused-key", first)
    await expect(
      context.service.publish(credential.authorization, prototype.id, "reused-key", conflicting),
    ).rejects.toMatchObject({ status: 409, code: "idempotency_conflict" })
    expect(
      await context.prisma.prototypeVersion.count({ where: { prototypeId: prototype.id } }),
    ).toBe(1)
  })

  it("serializes concurrent publications into ordered immutable versions", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)

    const results = await Promise.all([
      context.service.publish(
        credential.authorization,
        prototype.id,
        "concurrent-one",
        publicationInput(prototype.id, artifact("concurrent-one")),
      ),
      context.service.publish(
        credential.authorization,
        prototype.id,
        "concurrent-two",
        publicationInput(prototype.id, artifact("concurrent-two")),
      ),
    ])
    const versions = await context.prisma.prototypeVersion.findMany({
      where: { prototypeId: prototype.id },
      orderBy: { sequence: "asc" },
    })

    expect(results.map(({ replayed }) => replayed)).toEqual([false, false])
    expect(versions.map(({ sequence }) => sequence)).toEqual([1, 2])
    const migration = await readFile(
      new URL(
        "../../../../schema/migrations/20261027230000_artifact_ingestion/migration.sql",
        import.meta.url,
      ),
      "utf8",
    )
    const immutableVersionStart = migration.indexOf(
      "CREATE FUNCTION reject_prototype_version_mutation()",
    )
    expect(immutableVersionStart).toBeGreaterThanOrEqual(0)
    const immutableVersionSql = migration.slice(immutableVersionStart)
    await context.prisma.$executeRawUnsafe(immutableVersionSql)
    try {
      await expect(
        context.prisma.prototypeVersion.update({
          where: { id: versions[0]!.id },
          data: { label: "rewritten" },
        }),
      ).rejects.toThrow(/prototype versions are immutable/i)
      await expect(
        context.prisma.prototypeVersion.delete({ where: { id: versions[1]!.id } }),
      ).rejects.toThrow(/prototype versions are immutable/i)
    } finally {
      await context.prisma.$executeRawUnsafe(
        "DROP TRIGGER prototype_versions_immutable ON prototype_versions",
      )
      await context.prisma.$executeRawUnsafe("DROP FUNCTION reject_prototype_version_mutation()")
    }
  })

  it("rejects an already-started publication when archive acquires the prototype lock first", async () => {
    const putStarted = deferred()
    const releasePut = deferred()
    const storage: ArtifactStorage = {
      async put(digest) {
        putStarted.resolve()
        await releasePut.promise
        return { key: digest.replace(":", "/"), created: true }
      },
      read: vi.fn(),
      remove: vi.fn(),
    }
    const context = await database(storage)
    const sessionToken = "archive-race-session"
    const { authorization, prototype, workloadAuthorization } = await provisionPublisher(
      context.prisma,
      sessionToken,
    )
    const publication = context.service.publish(
      workloadAuthorization,
      prototype.id,
      "archive-race",
      publicationInput(prototype.id, artifact("archive-race")),
    )
    await putStarted.promise

    await authorization.archivePrototype(sessionToken, prototype.id)
    releasePut.resolve()

    await expect(publication).rejects.toMatchObject({
      status: 409,
      code: "prototype_archived",
    })
    expect(
      await context.prisma.prototypeVersion.count({ where: { prototypeId: prototype.id } }),
    ).toBe(0)
    expect(
      await context.prisma.artifactPublication.count({ where: { prototypeId: prototype.id } }),
    ).toBe(0)
    expect(
      await context.prisma.securityAudit.count({
        where: { prototypeId: prototype.id, event: "prototype.version.publish" },
      }),
    ).toBe(0)
  })

  it("promotes and rolls back a channel by moving one atomic pointer", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)
    const first = await context.service.publish(
      credential.authorization,
      prototype.id,
      "channel-one",
      publicationInput(prototype.id, artifact("channel-one")),
    )
    const second = await context.service.publish(
      credential.authorization,
      prototype.id,
      "channel-two",
      publicationInput(prototype.id, artifact("channel-two")),
    )
    const firstVersion = publishedVersion(first)
    const secondVersion = publishedVersion(second)

    await context.service.promote(credential.authorization, prototype.id, "current", {
      versionId: firstVersion.id,
    })
    await context.service.promote(credential.authorization, prototype.id, "current", {
      versionId: secondVersion.id,
    })
    await context.service.promote(credential.authorization, prototype.id, "preview", {
      versionId: secondVersion.id,
    })
    await context.service.promote(credential.authorization, prototype.id, "current", {
      versionId: firstVersion.id,
    })

    expect(
      await context.prisma.prototypeChannel.findMany({
        where: { prototypeId: prototype.id },
        orderBy: { name: "asc" },
        select: { name: true, prototypeVersionId: true },
      }),
    ).toEqual([
      { name: "current", prototypeVersionId: firstVersion.id },
      { name: "preview", prototypeVersionId: secondVersion.id },
    ])
    expect(
      await context.prisma.prototypeVersion.findMany({
        where: { prototypeId: prototype.id },
        orderBy: { sequence: "asc" },
        select: { id: true, sequence: true },
      }),
    ).toEqual([
      { id: firstVersion.id, sequence: 1 },
      { id: secondVersion.id, sequence: 2 },
    ])
  })

  it("blocks publication and current or preview promotion after a prototype is archived", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)
    const published = await context.service.publish(
      credential.authorization,
      prototype.id,
      "before-archive",
      publicationInput(prototype.id, artifact("before-archive")),
    )
    const version = publishedVersion(published)
    await context.prisma.prototype.update({
      where: { id: prototype.id },
      data: { archivedAt: new Date() },
    })

    await expect(
      context.service.publish(
        credential.authorization,
        prototype.id,
        "after-archive",
        publicationInput(prototype.id, artifact("after-archive")),
      ),
    ).rejects.toMatchObject({ status: 409, code: "prototype_archived" })
    for (const channel of ["current", "preview"] as const) {
      await expect(
        context.service.promote(credential.authorization, prototype.id, channel, {
          versionId: version.id,
        }),
      ).rejects.toMatchObject({ status: 409, code: "prototype_archived" })
    }

    expect(
      await context.prisma.prototypeVersion.count({ where: { prototypeId: prototype.id } }),
    ).toBe(1)
    expect(
      await context.prisma.prototypeChannel.count({ where: { prototypeId: prototype.id } }),
    ).toBe(0)
  })

  it("rolls back a promoted publication, version, channel, and audit together", async () => {
    const context = await database()
    const { prototype } = await createPrototype(context.prisma)
    const credential = await createCredential(context.prisma, prototype.id)

    await context.prisma.$executeRawUnsafe(`
      CREATE FUNCTION reject_version_publish_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.event = 'prototype.version.publish' THEN
          RAISE EXCEPTION 'audit unavailable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `)
    await context.prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_version_publish_audit
      BEFORE INSERT ON security_audits
      FOR EACH ROW EXECUTE FUNCTION reject_version_publish_audit();
    `)
    try {
      await expect(
        context.service.publish(
          credential.authorization,
          prototype.id,
          "audit-failure",
          publicationInput(prototype.id, artifact("audit-failure"), {
            promoteChannel: "current",
          }),
        ),
      ).rejects.toThrow("audit unavailable")
    } finally {
      await context.prisma.$executeRawUnsafe(
        "DROP TRIGGER reject_version_publish_audit ON security_audits",
      )
      await context.prisma.$executeRawUnsafe("DROP FUNCTION reject_version_publish_audit()")
    }

    expect(
      await context.prisma.prototypeVersion.count({ where: { prototypeId: prototype.id } }),
    ).toBe(0)
    expect(
      await context.prisma.artifactPublication.count({ where: { prototypeId: prototype.id } }),
    ).toBe(0)
    expect(
      await context.prisma.prototypeChannel.count({ where: { prototypeId: prototype.id } }),
    ).toBe(0)
    expect(
      await context.prisma.securityAudit.count({
        where: { prototypeId: prototype.id, event: "prototype.version.publish" },
      }),
    ).toBe(0)
  })
})
