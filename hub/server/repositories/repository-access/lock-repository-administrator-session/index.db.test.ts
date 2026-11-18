import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { lockRepositoryAdministratorSession } from "."

async function createSessionAuthority() {
  const provider = await prisma.authenticationProvider.create({
    data: { key: "github", enabled: false },
  })
  const revision = await prisma.authenticationProviderRevision.create({
    data: {
      configurationDigest: "a".repeat(64),
      providerId: provider.id,
      revision: 1,
    },
  })
  await prisma.authenticationProvider.update({
    data: { enabled: true, selectedRevisionId: revision.id },
    where: { id: provider.id },
  })
  const user = await prisma.user.create({ data: {} })
  const identity = await prisma.externalIdentity.create({
    data: {
      issuer: "https://github.com",
      provider: "github",
      subject: "17",
      userId: user.id,
    },
  })
  const membership = await prisma.membership.create({ data: { userId: user.id } })
  const repository = await prisma.repository.create({
    data: {
      defaultBranch: "main",
      githubRepositoryId: 17n,
      nameWithOwner: "octo/example",
    },
  })
  await prisma.repositoryAccessGrant.create({
    data: {
      accessLevel: "ADMIN",
      membershipId: membership.id,
      observedAt: new Date(),
      repositoryId: repository.id,
    },
  })
  const revocation = await prisma.sessionRevocationState.findUniqueOrThrow({
    where: { key: "global" },
  })
  const sessionDigest = "b".repeat(64)
  const session = await prisma.hubSession.create({
    data: {
      digest: sessionDigest,
      expiresAt: new Date(Date.now() + 60_000),
      externalIdentityId: identity.id,
      membershipId: membership.id,
      providerRevisionId: revision.id,
      revocationRevision: revocation.revision,
    },
  })
  return { membership, repository, session, sessionDigest }
}

function authorize(input: { membershipId: string; repositoryId: string; sessionDigest: string }) {
  return prisma.$transaction((transaction) =>
    lockRepositoryAdministratorSession(transaction, input),
  )
}

describe("lockRepositoryAdministratorSession()", () => {
  it("authorizes a live session with current repository ADMIN evidence", async () => {
    const { membership, repository, sessionDigest } = await createSessionAuthority()

    await expect(
      authorize({
        membershipId: membership.id,
        repositoryId: repository.id,
        sessionDigest,
      }),
    ).resolves.toBe(true)
  })

  it("fails closed after the Hub session ends", async () => {
    const { membership, repository, session, sessionDigest } = await createSessionAuthority()
    await prisma.hubSession.update({
      data: { endedAt: new Date() },
      where: { id: session.id },
    })

    await expect(
      authorize({
        membershipId: membership.id,
        repositoryId: repository.id,
        sessionDigest,
      }),
    ).resolves.toBe(false)
  })

  it("fails closed after the global session revision advances", async () => {
    const { membership, repository, sessionDigest } = await createSessionAuthority()
    await prisma.$executeRaw`
      UPDATE "session_revocation_states"
      SET "revision" = "revision" + 1, "updated_at" = clock_timestamp()
      WHERE "key" = 'global'
    `

    await expect(
      authorize({
        membershipId: membership.id,
        repositoryId: repository.id,
        sessionDigest,
      }),
    ).resolves.toBe(false)
  })
})
