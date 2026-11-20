import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { findPrototypeDetail } from "."

describe("findPrototypeDetail()", () => {
  it("uses the current Build's author on every history page without creating an owner", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "octo/demo", defaultBranch: "main" },
    })
    const prototype = await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "proto/demo" },
    })
    const current = await prisma.build.create({
      data: {
        prototypeId: prototype.id,
        number: 1,
        authorProvider: "github",
        authorIssuer: "https://github.com",
        authorProviderUserId: "9",
        authorLogin: "commit-author",
      },
    })
    await prisma.build.create({ data: { prototypeId: prototype.id, number: 2 } })
    await prisma.prototype.update({
      where: { id: prototype.id },
      data: { currentBuildId: current.id },
    })

    const detail = await findPrototypeDetail(prisma, repository.id, prototype.id, undefined, {
      page: 1,
      pageSize: 1,
    })
    expect(detail?.prototype).toMatchObject({
      authorLogin: "commit-author",
      authorProvider: "github",
    })
    expect(await prisma.user.count()).toBe(0)

    await prisma.prototype.update({ where: { id: prototype.id }, data: { currentBuildId: null } })
    const olderPage = await findPrototypeDetail(prisma, repository.id, prototype.id, undefined, {
      page: 2,
      pageSize: 1,
    })
    expect(olderPage?.prototype.authorLogin).toBeNull()
  })

  it("keeps the explicit Hub owner rather than substituting a contributor", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "octo/demo", defaultBranch: "main" },
    })
    const owner = await prisma.user.create({
      data: { profile: { create: { provider: "github", login: "owner" } } },
    })
    const prototype = await prisma.prototype.create({
      data: {
        repositoryId: repository.id,
        branchName: "proto/demo",
        authorId: owner.id,
        builds: {
          create: {
            number: 1,
            authorProvider: "github",
            authorIssuer: "https://github.com",
            authorProviderUserId: "9",
            authorLogin: "contributor",
          },
        },
      },
    })
    expect(
      (await findPrototypeDetail(prisma, repository.id, prototype.id))?.prototype.authorLogin,
    ).toBe("owner")
  })

  it("maps successful Build artifacts to canonical URLs and the selected Controls identity", async () => {
    const repositoryId = randomUUID()
    const prototypeId = randomUUID()
    const buildId = randomUUID()
    await prisma.repository.create({
      data: {
        id: repositoryId,
        githubRepositoryId: 2001n,
        nameWithOwner: "team/design",
        defaultBranch: "main",
      },
    })
    await prisma.prototype.create({
      data: {
        id: prototypeId,
        repositoryId,
        branchName: "prototype/checkout",
        startPage: "/checkout",
      },
    })
    await prisma.build.create({
      data: {
        id: buildId,
        prototypeId,
        number: 42,
        state: "successful",
        githubWorkflowRunId: 3002n,
        artifacts: {
          create: [
            {
              path: "dist/index.html",
              kind: "dist",
              storageKey: "preview-index",
              byteLength: 10,
            },
            {
              path: "screenshots/desktop.png",
              kind: "screenshot",
              storageKey: "desktop-image",
              byteLength: 20,
            },
            {
              path: "screenshots/narrow.png",
              kind: "screenshot",
              storageKey: "narrow-image",
              byteLength: 20,
            },
            {
              path: "dist/controls.replica.json",
              kind: "dist",
              storageKey: "controls-binding",
              byteLength: 30,
            },
          ],
        },
      },
    })

    const detail = await findPrototypeDetail(
      prisma,
      repositoryId,
      prototypeId,
      42,
      undefined,
      null,
      (mountPath, target, startPage = "/") =>
        mountPath
          ? `${mountPath}${target === "preview" ? startPage.slice(1) : `__replica/screenshots/${target}.png`}`
          : null,
    )

    expect(detail?.selectedBuild).toMatchObject({
      number: 42,
      previewUrl: "/previews/github/2001/3002/checkout",
      desktopScreenshotUrl: "/previews/github/2001/3002/__replica/screenshots/desktop.png",
      narrowScreenshotUrl: "/previews/github/2001/3002/__replica/screenshots/narrow.png",
    })
    expect(detail?.controlsIdentity).toBe("controls-binding")
  })

  it("bounds database results on later pages while retaining the global current Build", async () => {
    const repositoryId = randomUUID()
    const prototypeId = randomUUID()
    const currentBuildId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    await prisma.prototype.create({
      data: { id: prototypeId, repositoryId, branchName: "prototype/checkout" },
    })
    await prisma.build.createMany({
      data: Array.from({ length: 100 }, (_, index) => ({
        id: index === 0 ? currentBuildId : randomUUID(),
        prototypeId,
        number: index + 1,
        state: "successful",
        createdAt: new Date(Date.UTC(2026, 9, 1, index)),
      })),
    })
    await prisma.prototype.update({
      where: { id: prototypeId },
      data: { currentBuildId },
    })
    const returnedBuildRows: number[] = []
    const observedDatabase = prisma.$extends({
      query: {
        async $allOperations({ args, query }) {
          const result: unknown = await query(args)
          const records: unknown[] = Array.isArray(result) ? result : [result]
          const buildRows = records.filter(
            (record) => record !== null && typeof record === "object" && "number" in record,
          )
          if (buildRows.length) returnedBuildRows.push(buildRows.length)
          return result
        },
      },
    })
    // Query-only observation preserves delegates, but Prisma's extension types differ.
    const database = observedDatabase as unknown as Parameters<typeof findPrototypeDetail>[0]

    const history = await findPrototypeDetail(database, repositoryId, prototypeId, 100, {
      page: 2,
      pageSize: 25,
    })

    expect(history?.buildPage?.builds.map(({ number }) => number)).toEqual(
      Array.from({ length: 25 }, (_, index) => 75 - index),
    )
    expect(history?.buildPage?.totalCount).toBe(100)
    expect(history?.prototype.builds).toHaveLength(26)
    expect(history?.selectedBuild?.number).toBe(100)
    expect(history?.prototype.latestBuild).toEqual({ number: 1, state: "successful" })
    // Observe real database results, not just the sliced response or SQL spelling.
    expect(returnedBuildRows.length).toBeGreaterThan(0)
    expect(Math.max(...returnedBuildRows)).toBeLessThanOrEqual(26)
    expect(returnedBuildRows.reduce((total, count) => total + count, 0)).toBeLessThanOrEqual(52)

    const detail = await findPrototypeDetail(prisma, repositoryId, prototypeId, 100)
    expect(detail?.prototype.builds).toHaveLength(100)
    expect(detail?.selectedBuild?.number).toBe(100)
    expect(detail?.prototype.latestBuild).toEqual({ number: 1, state: "successful" })
  })

  it("withholds a visible snapshot after its repository grant is revoked while another grant remains", async () => {
    const membership = await prisma.membership.create({
      data: { user: { create: {} } },
    })
    const repositoryId = randomUUID()
    const retainedRepositoryId = randomUUID()
    const currentBuildId = randomUUID()
    const commitSha = "a".repeat(40)
    await prisma.repository.createMany({
      data: [
        {
          id: repositoryId,
          githubRepositoryId: 1001,
          nameWithOwner: "team/private",
          defaultBranch: "main",
        },
        {
          id: retainedRepositoryId,
          githubRepositoryId: 1002,
          nameWithOwner: "team/retained",
          defaultBranch: "main",
        },
      ],
    })
    await prisma.repositoryAccessGrant.createMany({
      data: [repositoryId, retainedRepositoryId].map((id) => ({
        membershipId: membership.id,
        repositoryId: id,
        observedAt: new Date(),
      })),
    })
    const prototype = await prisma.prototype.create({
      data: {
        repositoryId,
        branchName: "prototype/private",
        name: "Private prototype",
        builds: {
          create: [
            { number: 1, state: "successful", createdAt: new Date("2026-10-02T00:00:00Z") },
            {
              id: currentBuildId,
              number: 2,
              state: "successful",
              commitSha,
              authorProvider: "github",
              authorIssuer: "https://github.com",
              authorProviderUserId: "123",
              authorLogin: "mona",
              createdAt: new Date("2026-10-01T00:00:00Z"),
            },
          ],
        },
      },
    })
    await prisma.prototype.update({ where: { id: prototype.id }, data: { currentBuildId } })
    const retainedPrototype = await prisma.prototype.create({
      data: {
        repositoryId: retainedRepositoryId,
        branchName: "prototype/retained",
        name: "Retained prototype",
      },
    })
    const scope = { membershipId: membership.id }
    const visibleDetail = {
      repository: { id: repositoryId },
      prototype: {
        id: prototype.id,
        latestBuild: { number: 2, state: "successful" },
      },
      selectedBuild: { number: 1, state: "successful" },
    }
    await expect(
      findPrototypeDetail(prisma, repositoryId, prototype.id, undefined, undefined, scope),
    ).resolves.toMatchObject(visibleDetail)

    const transaction = prisma.$transaction.bind(prisma)
    const transactionSpy = vi.spyOn(prisma, "$transaction")
    function revokeAfterSnapshot() {
      transactionSpy.mockImplementationOnce(async (operation, options) => {
        const snapshot = await transaction(operation, options)
        await prisma.repositoryAccessGrant.deleteMany({
          where: { membershipId: membership.id, repositoryId },
        })
        return snapshot
      })
    }

    revokeAfterSnapshot()
    const revokedDetail = await findPrototypeDetail(
      prisma,
      repositoryId,
      prototype.id,
      undefined,
      undefined,
      scope,
    )
    await expect(
      findPrototypeDetail(
        prisma,
        retainedRepositoryId,
        retainedPrototype.id,
        undefined,
        undefined,
        scope,
      ),
    ).resolves.toMatchObject({ repository: { id: retainedRepositoryId } })
    await expect(findPrototypeDetail(prisma, repositoryId, prototype.id)).resolves.toMatchObject(
      visibleDetail,
    )
    expect(revokedDetail).toBeNull()

    const buildPage = { page: 1, pageSize: 1 }
    await expect(
      findPrototypeDetail(prisma, repositoryId, prototype.id, 2, buildPage, scope),
    ).resolves.toBeNull()

    await prisma.repositoryAccessGrant.create({
      data: { membershipId: membership.id, repositoryId, observedAt: new Date() },
    })
    await expect(
      findPrototypeDetail(prisma, repositoryId, prototype.id, 2, buildPage, scope),
    ).resolves.toMatchObject({
      ...visibleDetail,
      selectedBuild: {
        number: 2,
        state: "successful",
        commitSha,
        commitAuthorProvider: "github",
        commitAuthorIssuer: "https://github.com",
        commitAuthorProviderUserId: "123",
        commitAuthorLogin: "mona",
      },
      buildPage: { builds: [{ number: 1, state: "successful" }], totalCount: 2 },
    })

    revokeAfterSnapshot()
    await expect(
      findPrototypeDetail(prisma, repositoryId, prototype.id, 2, buildPage, scope),
    ).resolves.toBeNull()
  })
})
