import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../../integrations/prisma"
import { advanceGitHubRepositoryAccessState } from "../../../../repositories/github-repository-access-states/advance-github-repository-access-state"
import { createProductRouteDependencies } from "."

const installationId = "456"
const githubLogin = "synthetic-preview-reader"
const githubUserId = 81002

async function githubMember(repositoryId: string) {
  const user = await prisma.user.create({
    data: { profile: { create: { provider: "github", login: githubLogin } } },
  })
  const identity = await prisma.externalIdentity.create({
    data: {
      userId: user.id,
      provider: "github",
      issuer: "https://github.com",
      subject: String(githubUserId),
    },
  })
  const membership = await prisma.membership.create({ data: { userId: user.id } })
  await prisma.repositoryAccessGrant.create({
    data: { repositoryId, membershipId: membership.id, observedAt: new Date() },
  })
  return {
    membershipId: membership.id,
    externalIdentityId: identity.id,
    sessionProvider: "github",
    role: "MEMBER" as const,
  }
}

function productDependencies(githubRepositoryId: number, readPermission: () => Promise<Response>) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const requested: string[] = []
  const product = createProductRouteDependencies({
    scopeGitHubMembers: true,
    githubRepositoryCredentials: { appId: "123", installationId, privateKey },
    requestGitHub: (async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input)
      requested.push(`${init?.method} ${url.pathname}`)
      if (url.origin === "https://api.github.com") {
        if (
          init?.method === "POST" &&
          url.pathname === `/app/installations/${installationId}/access_tokens`
        ) {
          if (typeof init.body !== "string") throw new Error("Missing GitHub repository IDs.")
          const payload: unknown = JSON.parse(init.body)
          expect(payload).toEqual({ repository_ids: [githubRepositoryId] })
          return Response.json({ token: "synthetic-installation-token" })
        }
        if (init?.method === "GET" && url.pathname === `/repositories/${githubRepositoryId}`) {
          return Response.json({ id: githubRepositoryId, full_name: "team/checkout" })
        }
        if (
          init?.method === "GET" &&
          url.pathname === `/repos/team/checkout/collaborators/${githubLogin}/permission`
        ) {
          return readPermission()
        }
      }
      throw new Error(`Unexpected synthetic GitHub request: ${init?.method} ${url.pathname}`)
    }) satisfies typeof fetch,
  })
  return { product, requested }
}

function readPermission() {
  return Response.json({ permission: "read", user: { id: githubUserId } })
}

describe("createProductRouteDependencies()", () => {
  describe("getVerifiedRepositoryPermission()", () => {
    it("checks GitHub with the supplied repository ID", async () => {
      const repository = await prisma.repository.create({
        data: { githubRepositoryId: 27201, nameWithOwner: "team/checkout", defaultBranch: "main" },
      })
      const viewer = await githubMember(repository.id)
      const { product, requested } = productDependencies(27299, () =>
        Promise.resolve(readPermission()),
      )

      await expect(
        product.getVerifiedRepositoryPermission!(viewer, repository.id, 27299n),
      ).resolves.toBe("read")
      expect(requested).toContain("GET /repositories/27299")
    })

    it.each([
      "the repository is removed",
      "the viewer loses repository access",
      "the GitHub access revision changes",
    ] as const)("returns no permission when %s during the GitHub check", async (change) => {
      const githubRepositoryId = 27202
      const repository = await prisma.repository.create({
        data: { githubRepositoryId, nameWithOwner: "team/checkout", defaultBranch: "main" },
      })
      const viewer = await githubMember(repository.id)
      const { product, requested } = productDependencies(githubRepositoryId, async () => {
        if (change === "the repository is removed") {
          await prisma.repository.update({
            where: { id: repository.id },
            data: { removedAt: new Date() },
          })
        } else if (change === "the viewer loses repository access") {
          await prisma.repositoryAccessGrant.deleteMany({
            where: { repositoryId: repository.id, membershipId: viewer.membershipId },
          })
        } else {
          await advanceGitHubRepositoryAccessState(prisma)
        }
        return readPermission()
      })

      await expect(
        product.getVerifiedRepositoryPermission!(viewer, repository.id, BigInt(githubRepositoryId)),
      ).resolves.toBeNull()
      expect(requested).toContain(
        `GET /repos/team/checkout/collaborators/${githubLogin}/permission`,
      )
    })
  })
})
