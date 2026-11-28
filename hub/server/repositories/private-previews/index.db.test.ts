import { randomBytes, randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { privatePreviewAddress } from "../../utils/private-preview-address"
import { createPrivatePreviewAccessStore } from "./create-private-preview-access-store"
import { findPrivatePreviewTarget } from "./find-private-preview-target"

const sessionLifetime = 8 * 60 * 60_000

function digest() {
  return randomBytes(32).toString("hex")
}

async function createAccessBuild() {
  const repository = await prisma.repository.create({
    data: { defaultBranch: "main", nameWithOwner: "example/synthetic" },
  })
  const prototype = await prisma.prototype.create({
    data: { repositoryId: repository.id, branchName: "prototype/welcome" },
  })
  return prisma.build.create({
    data: { number: 1, prototypeId: prototype.id },
    select: { id: true },
  })
}

describe("createPrivatePreviewAccessStore()", () => {
  it("allows only one concurrent exchange and preserves the winning access scope", async () => {
    const store = createPrivatePreviewAccessStore(prisma, sessionLifetime)
    const readerOrigin = "https://preview.example.net"
    const grantDigest = digest()
    const challengeDigest = digest()
    const sessionDigest = digest()
    const { id: buildId } = await createAccessBuild()
    const grantExpiresAt = new Date(Date.now() + 30_000)
    await store.issue({
      id: randomUUID(),
      tokenDigest: grantDigest,
      sessionDigest,
      buildId,
      readerOrigin,
      challengeDigest,
      expiresAt: grantExpiresAt,
    })

    const accessDigests = [digest(), digest()]
    const attempts = await Promise.all(
      accessDigests.map((tokenDigest) =>
        store.exchange({
          grantDigest,
          tokenDigest,
          readerOrigin,
          challengeDigest,
        }),
      ),
    )

    expect(attempts.filter(Boolean)).toHaveLength(1)
    const [winner, loser] = attempts[0] ? accessDigests : accessDigests.toReversed()
    const winning = await store.read(winner!, readerOrigin, null)
    expect(winning).toMatchObject({ buildId, sessionDigest })
    // The reader session lasts eight hours from the exchange, measured by the database.
    expect(winning!.expiresAt.getTime() - Date.now()).toBeGreaterThan(8 * 60 * 60_000 - 60_000)
    await expect(store.read(loser!, readerOrigin, null)).resolves.toBeNull()
    await expect(store.read(grantDigest, readerOrigin, challengeDigest)).resolves.toBeNull()
  })

  it.each(["wrong browser", "wrong origin", "expired"] as const)(
    "does not turn a %s grant into reader access",
    async (condition) => {
      const store = createPrivatePreviewAccessStore(prisma, sessionLifetime)
      const readerOrigin = "https://preview.example.net"
      const grantDigest = digest()
      const challengeDigest = digest()
      const { id: buildId } = await createAccessBuild()
      const grantExpiresAt = new Date(Date.now() + 30_000)
      const id = randomUUID()
      await store.issue({
        id,
        tokenDigest: grantDigest,
        sessionDigest: digest(),
        buildId,
        readerOrigin,
        challengeDigest,
        expiresAt: grantExpiresAt,
      })

      if (condition === "expired") {
        await prisma.privatePreviewAccess.update({
          where: { id },
          data: { expiresAt: new Date(Date.now() - 1_000) },
        })
      }
      const tokenDigest = digest()
      await expect(
        store.exchange({
          grantDigest,
          tokenDigest,
          readerOrigin: condition === "wrong origin" ? "https://other.example.org" : readerOrigin,
          challengeDigest: condition === "wrong browser" ? digest() : challengeDigest,
        }),
      ).resolves.toBe(false)
      await expect(store.read(tokenDigest, readerOrigin, null)).resolves.toBeNull()
      if (condition !== "expired") {
        await expect(store.read(grantDigest, readerOrigin, challengeDigest)).resolves.not.toBeNull()
      }
    },
  )

  it("does not exchange a grant that expires while the exchange waits for its row lock", async () => {
    const store = createPrivatePreviewAccessStore(prisma, sessionLifetime)
    const readerOrigin = "https://preview.example.net"
    const { id: buildId } = await createAccessBuild()
    const id = randomUUID()
    const grantDigest = digest()
    const challengeDigest = digest()
    await store.issue({
      id,
      tokenDigest: grantDigest,
      sessionDigest: digest(),
      buildId,
      readerOrigin,
      challengeDigest,
      expiresAt: new Date(Date.now() + 30_000),
    })
    let signalLocked!: () => void
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve
    })
    const holder = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM private_preview_accesses WHERE id = ${id}::uuid FOR UPDATE`
      await transaction.$executeRaw`
        UPDATE private_preview_accesses
        SET expires_at = clock_timestamp() + interval '200 milliseconds'
        WHERE id = ${id}::uuid
      `
      signalLocked()
      await new Promise((resolve) => setTimeout(resolve, 500))
    })

    await locked
    const exchange = store.exchange({
      grantDigest,
      tokenDigest: digest(),
      readerOrigin,
      challengeDigest,
    })
    await holder

    await expect(exchange).resolves.toBe(false)
    await expect(prisma.privatePreviewAccess.findUnique({ where: { id } })).resolves.toMatchObject({
      tokenDigest: grantDigest,
      challengeDigest,
    })
  })

  it("issues at most one handoff per launch ID, even after its exchange", async () => {
    const store = createPrivatePreviewAccessStore(prisma, sessionLifetime)
    const readerOrigin = "https://preview.example.net"
    const { id: buildId } = await createAccessBuild()
    const id = randomUUID()
    const challengeDigest = digest()
    const grantDigest = digest()
    const claim = {
      id,
      sessionDigest: digest(),
      buildId,
      readerOrigin,
      challengeDigest,
      expiresAt: new Date(Date.now() + 30_000),
    }

    await expect(store.issue({ ...claim, tokenDigest: grantDigest })).resolves.toBe(true)
    await expect(store.issue({ ...claim, tokenDigest: digest() })).resolves.toBe(false)
    await expect(
      store.exchange({ grantDigest, tokenDigest: digest(), readerOrigin, challengeDigest }),
    ).resolves.toBe(true)
    await expect(store.issue({ ...claim, tokenDigest: digest() })).resolves.toBe(false)
    await expect(
      store.issue({ ...claim, id: randomUUID(), tokenDigest: digest(), expiresAt: new Date(0) }),
    ).resolves.toBe(false)
    await expect(prisma.privatePreviewAccess.count({ where: { buildId } })).resolves.toBe(1)
  })
})

function distArtifact(path = "dist/index.html") {
  return { kind: "dist" as const, path, storageKey: randomUUID(), byteLength: 32 }
}

function workflowBuild(githubWorkflowRunId: bigint, number = 1) {
  return {
    number,
    state: "successful" as const,
    privatePreviewState: "ready" as const,
    githubWorkflowRunId,
    githubWorkflowRunAttempt: 1,
    artifacts: { create: distArtifact() },
  }
}

function find(repo: bigint, run: bigint) {
  return findPrivatePreviewTarget(prisma, privatePreviewAddress(String(repo), String(run))!)
}

describe("findPrivatePreviewTarget()", () => {
  it("resolves the dist-owning run, not the current Build or a contributing run", async () => {
    const repositoryId = 9_007_199_254_740_993n
    const owningRunId = 301n
    const currentRunId = 302n
    const contributingRunId = 303n
    const repository = await prisma.repository.create({
      data: {
        defaultBranch: "main",
        nameWithOwner: "example/synthetic",
        githubRepositoryId: repositoryId,
      },
    })
    const prototype = await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "prototype/welcome" },
    })
    const builds = await Promise.all(
      [owningRunId, currentRunId].map((runId, index) =>
        prisma.build.create({
          data: { prototypeId: prototype.id, ...workflowBuild(runId, index + 1) },
        }),
      ),
    )
    await prisma.prototype.update({
      where: { id: prototype.id },
      data: { currentBuildId: builds[1]!.id },
    })
    await prisma.gitHubBuildRunCompletion.create({
      data: {
        buildId: builds[0]!.id,
        githubWorkflowRunId: contributingRunId,
        runAttempt: 1,
        completedAt: new Date(),
      },
    })
    await expect(find(repositoryId, owningRunId)).resolves.toMatchObject({
      buildId: builds[0]!.id,
      repositoryId: repository.id,
    })
    await expect(find(repositoryId, contributingRunId)).resolves.toBeNull()
    await expect(find(repositoryId + 1n, owningRunId)).resolves.toBeNull()
  })

  it("resolves the retained Build on a retired branch even after the name is reused", async () => {
    const repositoryId = 401n
    const runId = 402n
    const repository = await prisma.repository.create({
      data: {
        defaultBranch: "main",
        nameWithOwner: "example/synthetic",
        githubRepositoryId: repositoryId,
      },
    })
    const branchName = "prototype/welcome"
    const retired = await prisma.prototype.create({
      data: {
        repositoryId: repository.id,
        branchName,
        branchDeletedAt: new Date("2026-01-03T00:00:00Z"),
        startPage: "/retained/",
        builds: { create: workflowBuild(runId) },
      },
      select: { builds: { select: { id: true } } },
    })
    await prisma.prototype.create({
      data: {
        repositoryId: repository.id,
        branchName,
        builds: { create: workflowBuild(runId + 1n) },
      },
    })

    await expect(find(repositoryId, runId)).resolves.toEqual({
      buildId: retired.builds[0]!.id,
      repositoryId: repository.id,
      startPage: "/retained/",
    })
  })

  it("does not choose between multiple Builds with the same repository and owning run", async () => {
    const repositoryId = 501n
    const runId = 502n
    const repository = await prisma.repository.create({
      data: {
        defaultBranch: "main",
        nameWithOwner: "example/synthetic",
        githubRepositoryId: repositoryId,
      },
    })
    await Promise.all(
      (["ready", "pending"] as const).map((privatePreviewState) =>
        prisma.prototype.create({
          data: {
            repositoryId: repository.id,
            branchName: `prototype/${privatePreviewState}`,
            builds: { create: { ...workflowBuild(runId), privatePreviewState } },
          },
        }),
      ),
    )

    await expect(find(repositoryId, runId)).resolves.toBeNull()
  })

  it.each([
    { reason: "a removed repository", repository: { removedAt: new Date("2026-01-03T00:00:00Z") } },
    { reason: "a local repository", repository: { localPath: "/synthetic/repository" } },
    { reason: "a replica branch", prototype: { replica: true } },
    { reason: "the default branch", prototype: { branchName: "main" } },
    {
      reason: "the install-workflow branch",
      prototype: { branchName: "replica/install-workflow" },
    },
    { reason: "a failed Build", build: { state: "failed" as const } },
    { reason: "a pending private preview", build: { privatePreviewState: "pending" as const } },
    { reason: "a legacy Build", build: { privatePreviewState: null } },
    {
      reason: "a Build without a dist entry point",
      build: {
        artifacts: {
          create: [
            distArtifact("dist/other.html"),
            { ...distArtifact(), kind: "screenshot" as const },
          ],
        },
      },
    },
  ])(
    "rejects $reason even when the owning run matches",
    async ({ repository, prototype, build }) => {
      const repositoryId = 601n
      const runId = 602n
      const { id } = await prisma.repository.create({
        data: {
          defaultBranch: "main",
          nameWithOwner: "example/synthetic",
          githubRepositoryId: repositoryId,
          ...repository,
        },
      })
      await prisma.prototype.create({
        data: {
          repositoryId: id,
          branchName: "prototype/welcome",
          ...prototype,
          builds: { create: { ...workflowBuild(runId), ...build } },
        },
      })

      await expect(find(repositoryId, runId)).resolves.toBeNull()
    },
  )
})
