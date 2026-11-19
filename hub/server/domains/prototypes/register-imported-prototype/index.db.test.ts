import { randomInt, randomUUID } from "node:crypto"

import pg from "pg"
import { describe, expect, it } from "vitest"

import { getDatabaseUrl } from "../../../../test/database/get-database-url"
import { waitForBlockedQuery } from "../../../../test/database/wait-for-blocked-query"
import type { BuildState, Prisma } from "../../../generated/prisma/client.ts"
import { prisma } from "../../../integrations/prisma/index.ts"
import { registerImportedPrototype } from "."

interface FixtureOptions {
  prototype?: Partial<
    Pick<
      Prisma.PrototypeUncheckedCreateInput,
      "branchName" | "name" | "description" | "registeredAt" | "branchDeletedAt" | "replica"
    >
  >
  repository?: { defaultBranch?: string; removedAt?: Date }
  build?: { state?: BuildState; githubWorkflowRunId?: bigint | null }
}

async function createFixture(options: FixtureOptions = {}) {
  const repository = await prisma.repository.create({
    data: {
      githubRepositoryId: randomInt(1, 2 ** 31),
      nameWithOwner: `octo/${randomUUID()}`,
      defaultBranch: "main",
      ...options.repository,
    },
  })
  const prototype = await prisma.prototype.create({
    data: {
      repositoryId: repository.id,
      branchName: "proto/welcome",
      ...options.prototype,
    },
  })
  const build = await prisma.build.create({
    data: {
      prototypeId: prototype.id,
      number: 1,
      state: "successful",
      githubWorkflowRunId: 1n,
      ...options.build,
    },
  })
  return {
    prototype,
    build,
    findPrototype: () => prisma.prototype.findUniqueOrThrow({ where: { id: prototype.id } }),
  }
}

describe("registerImportedPrototype()", () => {
  it("registers a nested proto branch once when imports overlap", async () => {
    const fixture = await createFixture({
      prototype: { branchName: "proto/team/welcome" },
    })

    await Promise.all([
      registerImportedPrototype(prisma, fixture.build.id),
      registerImportedPrototype(prisma, fixture.build.id),
    ])
    const registered = await fixture.findPrototype()
    expect(registered.registeredAt).toBeInstanceOf(Date)
    expect(registered.name).toBe("proto/team/welcome")

    await registerImportedPrototype(prisma, fixture.build.id)
    expect(await fixture.findPrototype()).toEqual(registered)
  })

  it("preserves the saved name and description", async () => {
    const fixture = await createFixture({
      prototype: { name: "Saved title", description: "A manually saved description" },
    })

    await registerImportedPrototype(prisma, fixture.build.id)

    const prototype = await fixture.findPrototype()
    expect(prototype).toMatchObject({
      name: "Saved title",
      description: "A manually saved description",
    })
    expect(prototype.registeredAt).toBeInstanceOf(Date)
  })

  it("keeps an existing manual registration unchanged", async () => {
    const fixture = await createFixture({
      prototype: {
        registeredAt: new Date("2025-01-01T00:00:00Z"),
        name: "Manually tracked",
        description: "Saved before import",
      },
    })

    await Promise.all([
      registerImportedPrototype(prisma, fixture.build.id),
      registerImportedPrototype(prisma, fixture.build.id),
    ])

    expect(await fixture.findPrototype()).toEqual(fixture.prototype)
  })

  it.each(["repository", "prototype"] as const)(
    "rereads a concurrent %s edit before registering",
    async (edited) => {
      const fixture = await createFixture()
      const blocker = new pg.Client({ connectionString: getDatabaseUrl() })
      const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
      let registration: Promise<unknown> | undefined
      try {
        await Promise.all([blocker.connect(), inspector.connect()])
        await blocker.query("BEGIN")
        const { pid } = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
          .rows[0]!
        if (edited === "repository") {
          await blocker.query("UPDATE repositories SET default_branch = $1 WHERE id = $2", [
            fixture.prototype.branchName,
            fixture.prototype.repositoryId,
          ])
        } else {
          await blocker.query("UPDATE prototypes SET name = $1, description = $2 WHERE id = $3", [
            "Concurrent title",
            "Concurrent description",
            fixture.prototype.id,
          ])
        }
        registration = registerImportedPrototype(prisma, fixture.build.id).then(
          () => null,
          (error: unknown) => error,
        )
        await waitForBlockedQuery(inspector, pid, "prototypes")
        await blocker.query("COMMIT")
        expect(await registration).toBeNull()

        const prototype = await fixture.findPrototype()
        if (edited === "repository") {
          expect(prototype.registeredAt).toBeNull()
        } else {
          expect(prototype).toMatchObject({
            name: "Concurrent title",
            description: "Concurrent description",
          })
          expect(prototype.registeredAt).toBeInstanceOf(Date)
        }
      } finally {
        await blocker.query("ROLLBACK")
        await registration
        await Promise.all([blocker.end(), inspector.end()])
      }
    },
  )

  it.each([
    { prototype: { branchName: "prototype/welcome" } },
    { prototype: { branchName: "Proto/welcome" } },
    { prototype: { branchName: "feature/proto/welcome" } },
    { prototype: { branchName: "proto" } },
    { repository: { defaultBranch: "proto/welcome" } },
    { prototype: { branchName: "replica/install-workflow" } },
    { prototype: { replica: true } },
    { prototype: { branchDeletedAt: new Date("2026-01-01T00:00:00Z") } },
    { repository: { removedAt: new Date("2026-01-01T00:00:00Z") } },
    { build: { githubWorkflowRunId: null } },
  ] satisfies FixtureOptions[])("leaves an ineligible prototype unchanged: %j", async (options) => {
    const fixture = await createFixture(options)

    await registerImportedPrototype(prisma, fixture.build.id)

    expect(await fixture.findPrototype()).toEqual(fixture.prototype)
  })

  it.each(["queued", "running", "failed", "superseded"] as const)(
    "does not register a %s Build",
    async (state) => {
      const fixture = await createFixture({ build: { state } })

      await registerImportedPrototype(prisma, fixture.build.id)

      expect(await fixture.findPrototype()).toEqual(fixture.prototype)
    },
  )
})
