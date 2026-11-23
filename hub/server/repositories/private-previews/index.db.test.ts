import { randomBytes, randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { privatePreviewAddress } from "../../utils/private-preview-address"
import { createPrivatePreviewAccessStore } from "./create-private-preview-access-store"
import { findPrivatePreviewTarget } from "./find-private-preview-target"

function digest() {
  return randomBytes(32).toString("hex")
}

describe("createPrivatePreviewAccessStore()", () => {
  it("allows only one concurrent exchange and preserves the winning access scope", async () => {
    const store = createPrivatePreviewAccessStore(prisma)
    const readerOrigin = "https://preview.example.net"
    const grantDigest = digest()
    const challengeDigest = digest()
    const sessionDigest = digest()
    const buildId = randomUUID()
    const grantExpiresAt = new Date(Date.now() + 30_000)
    await store.issue({
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
          grantExpiresAt,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ),
    )

    expect(attempts.filter(Boolean)).toHaveLength(1)
    const [winner, loser] = attempts[0] ? accessDigests : accessDigests.toReversed()
    await expect(store.read(winner!, readerOrigin, null)).resolves.toMatchObject({
      buildId,
      sessionDigest,
    })
    await expect(store.read(loser!, readerOrigin, null)).resolves.toBeNull()
    await expect(store.read(grantDigest, readerOrigin, challengeDigest)).resolves.toBeNull()
  })

  it.each(["wrong browser", "wrong origin", "expired"] as const)(
    "does not turn a %s grant into reader access",
    async (condition) => {
      const store = createPrivatePreviewAccessStore(prisma)
      const readerOrigin = "https://preview.example.net"
      const grantDigest = digest()
      const challengeDigest = digest()
      const grantExpiresAt = new Date(Date.now() + (condition === "expired" ? -30_000 : 30_000))
      await store.issue({
        tokenDigest: grantDigest,
        sessionDigest: digest(),
        buildId: randomUUID(),
        readerOrigin,
        challengeDigest,
        expiresAt: grantExpiresAt,
      })

      const tokenDigest = digest()
      await expect(
        store.exchange({
          grantDigest,
          tokenDigest,
          readerOrigin: condition === "wrong origin" ? "https://other.example.org" : readerOrigin,
          challengeDigest: condition === "wrong browser" ? digest() : challengeDigest,
          grantExpiresAt,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ).resolves.toBe(false)
      await expect(store.read(tokenDigest, readerOrigin, null)).resolves.toBeNull()
      if (condition !== "expired") {
        await expect(store.read(grantDigest, readerOrigin, challengeDigest)).resolves.not.toBeNull()
      }
    },
  )
})

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
          data: {
            prototypeId: prototype.id,
            number: index + 1,
            state: "successful",
            githubWorkflowRunId: runId,
            githubWorkflowRunAttempt: 1,
            artifacts: {
              create: {
                kind: "dist",
                path: "dist/index.html",
                storageKey: randomUUID(),
                byteLength: 32,
              },
            },
          },
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
    function find(repo: bigint, run: bigint) {
      return findPrivatePreviewTarget(prisma, privatePreviewAddress(String(repo), String(run))!)
    }

    await expect(find(repositoryId, owningRunId)).resolves.toMatchObject({
      buildId: builds[0]!.id,
      repositoryId: repository.id,
    })
    await expect(find(repositoryId, contributingRunId)).resolves.toBeNull()
    await expect(find(repositoryId + 1n, owningRunId)).resolves.toBeNull()
  })
})
