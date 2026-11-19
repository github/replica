import { describe, expect, it } from "vitest"
import pg from "pg"

import { prisma } from "../../../integrations/prisma"
import { getDatabaseUrl } from "../../../../test/database/get-database-url"
import { waitForBlockedQuery } from "../../../../test/database/wait-for-blocked-query"
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
  const grant = await prisma.repositoryAccessGrant.create({
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
  return { grant, membership, repository, session, sessionDigest }
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

  it("locks membership before session while overlapping restoration", async () => {
    const { membership, repository, session, sessionDigest } = await createSessionAuthority()
    const membershipHolder = new pg.Client({ connectionString: getDatabaseUrl() })
    const contender = new pg.Client({ connectionString: getDatabaseUrl() })
    const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([membershipHolder.connect(), contender.connect(), inspector.connect()])
    let holderOpen = false
    let contenderOpen = false
    let authorization: ReturnType<typeof authorize> | null = null
    try {
      await membershipHolder.query("BEGIN")
      holderOpen = true
      await membershipHolder.query("SELECT id FROM memberships WHERE id = $1 FOR UPDATE", [
        membership.id,
      ])
      const { pid } = (
        await membershipHolder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!
      authorization = authorize({
        membershipId: membership.id,
        repositoryId: repository.id,
        sessionDigest,
      })
      void authorization.catch(() => {})
      await waitForBlockedQuery(inspector, pid, 'FROM "memberships"')

      await contender.query("BEGIN")
      contenderOpen = true
      await contender.query("SELECT id FROM hub_sessions WHERE id = $1 FOR UPDATE NOWAIT", [
        session.id,
      ])
      await contender.query("ROLLBACK")
      contenderOpen = false

      await membershipHolder.query("COMMIT")
      holderOpen = false
      await expect(authorization).resolves.toBe(true)
    } finally {
      if (contenderOpen) await contender.query("ROLLBACK")
      if (holderOpen) await membershipHolder.query("ROLLBACK")
      if (authorization) await Promise.allSettled([authorization])
      await Promise.all([membershipHolder.end(), contender.end(), inspector.end()])
    }
  })

  it("locks repository before grant while overlapping admission changes", async () => {
    const { grant, membership, repository, sessionDigest } = await createSessionAuthority()
    const repositoryHolder = new pg.Client({ connectionString: getDatabaseUrl() })
    const contender = new pg.Client({ connectionString: getDatabaseUrl() })
    const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([repositoryHolder.connect(), contender.connect(), inspector.connect()])
    let holderOpen = false
    let contenderOpen = false
    let authorization: ReturnType<typeof authorize> | null = null
    try {
      await repositoryHolder.query("BEGIN")
      holderOpen = true
      await repositoryHolder.query("SELECT id FROM repositories WHERE id = $1 FOR UPDATE", [
        repository.id,
      ])
      const { pid } = (
        await repositoryHolder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!
      authorization = authorize({
        membershipId: membership.id,
        repositoryId: repository.id,
        sessionDigest,
      })
      void authorization.catch(() => {})
      await waitForBlockedQuery(inspector, pid, 'FROM "repositories"')

      await contender.query("BEGIN")
      contenderOpen = true
      await contender.query(
        "SELECT id FROM repository_access_grants WHERE id = $1 FOR UPDATE NOWAIT",
        [grant.id],
      )
      await contender.query("ROLLBACK")
      contenderOpen = false

      await repositoryHolder.query("COMMIT")
      holderOpen = false
      await expect(authorization).resolves.toBe(true)
    } finally {
      if (contenderOpen) await contender.query("ROLLBACK")
      if (holderOpen) await repositoryHolder.query("ROLLBACK")
      if (authorization) await Promise.allSettled([authorization])
      await Promise.all([repositoryHolder.end(), contender.end(), inspector.end()])
    }
  })

  it("denies authority when global revocation wins the overlap", async () => {
    const { membership, repository, sessionDigest } = await createSessionAuthority()
    const revocationHolder = new pg.Client({ connectionString: getDatabaseUrl() })
    const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([revocationHolder.connect(), inspector.connect()])
    let holderOpen = false
    let authorization: ReturnType<typeof authorize> | null = null
    try {
      await revocationHolder.query("BEGIN")
      holderOpen = true
      await revocationHolder.query(
        `UPDATE session_revocation_states
         SET revision = revision + 1, updated_at = clock_timestamp()
         WHERE key = 'global'`,
      )
      const { pid } = (
        await revocationHolder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!
      authorization = authorize({
        membershipId: membership.id,
        repositoryId: repository.id,
        sessionDigest,
      })
      void authorization.catch(() => {})
      await waitForBlockedQuery(inspector, pid, 'FROM "session_revocation_states"')

      await revocationHolder.query("COMMIT")
      holderOpen = false
      await expect(authorization).resolves.toBe(false)
    } finally {
      if (holderOpen) await revocationHolder.query("ROLLBACK")
      if (authorization) await Promise.allSettled([authorization])
      await Promise.all([revocationHolder.end(), inspector.end()])
    }
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
