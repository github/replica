import { randomUUID } from "node:crypto"
import pg from "pg"
import { describe, expect, it } from "vitest"

import { getDatabaseUrl } from "../../../test/database/get-database-url"
import { waitForBlockedQuery } from "../../../test/database/wait-for-blocked-query"
import { prisma } from "../../integrations/prisma"
import { createPublicSharingRouteDependencies } from "../../routes/api/public-sharing/create-public-sharing-route-dependencies"

const environment = {
  HUB_APPLICATION_ORIGIN: "http://hub.localhost:3001",
  HUB_PREVIEW_ORIGIN: "http://preview.localhost:3001",
  HUB_SHARE_LINK_MAX_DAYS: "7",
}

async function createFixture() {
  const user = await prisma.user.create({ data: {} })
  const repository = await prisma.repository.create({
    data: {
      defaultBranch: "main",
      localPath: `/prototype-root/${randomUUID()}`,
      nameWithOwner: "local/prototype",
    },
  })
  const prototype = await prisma.prototype.create({
    data: {
      branchName: "prototype/welcome",
      name: "Welcome",
      repositoryId: repository.id,
      startPage: "/checkout",
    },
  })
  const build = await prisma.build.create({
    data: {
      finishedAt: new Date(),
      number: 1,
      prototypeId: prototype.id,
      state: "successful",
    },
  })
  await prisma.buildArtifact.create({
    data: {
      buildId: build.id,
      byteLength: 15,
      kind: "dist",
      path: "dist/index.html",
      storageKey: randomUUID(),
    },
  })
  return { build, prototype, repository, user }
}

describe("public sharing persistence", () => {
  it("defaults disabled and creates a new opaque link pinned to the requested immutable Build", async () => {
    const fixture = await createFixture()
    const sharing = await createPublicSharingRouteDependencies(environment)

    await expect(sharing.getSettings()).resolves.toMatchObject({
      enabled: false,
      revision: 0,
    })
    await expect(sharing.changeSettings("enable")).resolves.toEqual({
      enabled: true,
      revision: 1,
    })

    const before = Date.now()
    const created = await sharing.createLink({
      buildNumber: fixture.build.number,
      createdById: fixture.user.id,
      createdByLogin: "octocat",
      expiration: "seven_days",
      label: "  Partner review  ",
      prototypeId: fixture.prototype.id,
      repositoryId: fixture.repository.id,
    })

    expect(created).toMatchObject({
      buildId: fixture.build.id,
      buildNumber: fixture.build.number,
      createdById: fixture.user.id,
      label: "Partner review",
      prototypeId: fixture.prototype.id,
    })
    expect(created.publicId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(created.expiresAt.getTime() - created.createdAt.getTime()).toBe(7 * 24 * 60 * 60_000)
    expect(created.createdAt.getTime()).toBeGreaterThanOrEqual(before)
    await expect(sharing.readPublicLink(created.publicId)).resolves.toMatchObject({
      state: "active",
      buildId: fixture.build.id,
      buildNumber: fixture.build.number,
      prototypeName: "Welcome",
      startPage: "/checkout",
    })
  })

  it("rejects invalid labels, lifetimes, and unavailable Builds without partial persistence", async () => {
    const fixture = await createFixture()
    const sharing = await createPublicSharingRouteDependencies(environment)
    await sharing.changeSettings("enable")
    function create(overrides: Partial<Parameters<typeof sharing.createLink>[0]> = {}) {
      return sharing.createLink({
        buildNumber: fixture.build.number,
        createdById: fixture.user.id,
        createdByLogin: "octocat",
        expiration: "seven_days",
        label: "Review",
        prototypeId: fixture.prototype.id,
        repositoryId: fixture.repository.id,
        ...overrides,
      })
    }

    await expect(create({ label: ` ${"é".repeat(51)} ` })).rejects.toMatchObject({
      code: "invalid_label",
    })
    await expect(create({ expiration: "thirty_days" })).rejects.toMatchObject({
      code: "invalid_expiration",
    })
    await prisma.build.update({
      where: { id: fixture.build.id },
      data: { state: "running", finishedAt: null },
    })
    await expect(create()).rejects.toMatchObject({ code: "unavailable_build" })
    await expect(prisma.shareLink.count()).resolves.toBe(0)
  })

  it("disabling increments the policy revision, revokes every link, and re-enabling never restores it", async () => {
    const fixture = await createFixture()
    const sharing = await createPublicSharingRouteDependencies(environment)
    await sharing.changeSettings("enable")
    const link = await sharing.createLink({
      buildNumber: fixture.build.number,
      createdById: fixture.user.id,
      createdByLogin: "octocat",
      expiration: "one_day",
      label: "Review",
      prototypeId: fixture.prototype.id,
      repositoryId: fixture.repository.id,
    })

    await expect(sharing.changeSettings("disable")).resolves.toEqual({
      enabled: false,
      revision: 2,
    })
    await expect(sharing.readPublicLink(link.publicId)).resolves.toEqual({ state: "disabled" })
    await expect(sharing.readAvailableLink(link.id, fixture.build.id)).resolves.toBeNull()

    await expect(sharing.changeSettings("enable")).resolves.toEqual({
      enabled: true,
      revision: 3,
    })
    await expect(sharing.readPublicLink(link.publicId)).resolves.toEqual({ state: "revoked" })
    const persisted = await prisma.shareLink.findUniqueOrThrow({ where: { id: link.id } })
    expect(persisted.revokedAt).toBeInstanceOf(Date)
  })

  it("returns an explicit missing result instead of silently succeeding when a link cannot be revoked", async () => {
    const fixture = await createFixture()
    const sharing = await createPublicSharingRouteDependencies(environment)
    await sharing.changeSettings("enable")

    await expect(
      sharing.revokeLink({ prototypeId: fixture.prototype.id, publicId: randomUUID() }),
    ).resolves.toBe(false)
  })

  it("rechecks link and policy availability after a public preview has already been prepared", async () => {
    const fixture = await createFixture()
    const sharing = await createPublicSharingRouteDependencies(environment)
    await sharing.changeSettings("enable")
    const link = await sharing.createLink({
      buildNumber: fixture.build.number,
      createdById: fixture.user.id,
      createdByLogin: "octocat",
      expiration: "seven_days",
      label: "Review",
      prototypeId: fixture.prototype.id,
      repositoryId: fixture.repository.id,
    })
    const prepared = await sharing.readPublicLink(link.publicId)
    expect(prepared).toMatchObject({ state: "active" })

    await sharing.revokeLink({ prototypeId: fixture.prototype.id, publicId: link.publicId })

    await expect(sharing.readAvailableLink(link.id, fixture.build.id)).resolves.toBeNull()
    await expect(sharing.readAvailableLink(link.id, randomUUID())).resolves.toBeNull()
  })

  it("fails creation when the policy revision changes after validation but before commit", async () => {
    const fixture = await createFixture()
    const sharing = await createPublicSharingRouteDependencies(environment)
    await sharing.changeSettings("enable")
    const blocker = new pg.Client({ connectionString: getDatabaseUrl() })
    const mutator = new pg.Client({ connectionString: getDatabaseUrl() })
    const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([blocker.connect(), mutator.connect(), inspector.connect()])
    const suffix = randomUUID().replaceAll("-", "")
    const trigger = `share_link_policy_${suffix}`
    const functionName = `block_share_link_policy_${suffix}`
    const lockKey = 7_341_109
    let blockerOpen = false
    let creation:
      | Promise<
          | { status: "fulfilled"; value: Awaited<ReturnType<typeof sharing.createLink>> }
          | { status: "rejected"; reason: unknown }
        >
      | undefined
    try {
      await mutator.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
        BEGIN
          IF NEW.label = 'Policy overlap' THEN
            PERFORM pg_advisory_xact_lock(${lockKey});
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `)
      await mutator.query(`
        CREATE TRIGGER ${trigger}
        BEFORE INSERT ON share_links
        FOR EACH ROW EXECUTE FUNCTION ${functionName}()
      `)
      await blocker.query("BEGIN")
      blockerOpen = true
      await blocker.query("SELECT pg_advisory_xact_lock($1)", [lockKey])
      const { pid: blockerPid } = (
        await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!
      creation = sharing
        .createLink({
          buildNumber: fixture.build.number,
          createdById: fixture.user.id,
          createdByLogin: "octocat",
          expiration: "seven_days",
          label: "Policy overlap",
          prototypeId: fixture.prototype.id,
          repositoryId: fixture.repository.id,
        })
        .then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason: unknown) => ({ status: "rejected" as const, reason }),
        )
      await waitForBlockedQuery(inspector, blockerPid, "share_links")

      await mutator.query(
        `UPDATE sharing_settings
         SET revision = revision + 2, public_sharing_enabled = true
         WHERE key = 'public-sharing'`,
      )
      await blocker.query("COMMIT")
      blockerOpen = false

      const result = await creation
      expect(result).toMatchObject({
        status: "rejected",
        reason: { code: "policy_changed" },
      })
      await expect(prisma.shareLink.count()).resolves.toBe(0)
    } finally {
      if (blockerOpen) await blocker.query("ROLLBACK")
      if (creation) await Promise.allSettled([creation])
      await mutator.query(`DROP TRIGGER IF EXISTS ${trigger} ON share_links`)
      await mutator.query(`DROP FUNCTION IF EXISTS ${functionName}()`)
      await Promise.all([blocker.end(), mutator.end(), inspector.end()])
    }
  })
})
