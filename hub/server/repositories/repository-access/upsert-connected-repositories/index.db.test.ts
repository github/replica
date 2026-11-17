import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { createQueryCountingClient } from "../../../../test/database/create-query-counting-client/index.ts"
import { upsertConnectedRepositories } from "."

function evidence(githubRepositoryId: number, nameWithOwner = `octo/repo-${githubRepositoryId}`) {
  return { defaultBranch: "main", githubRepositoryId, nameWithOwner }
}

describe("upsertConnectedRepositories", () => {
  it("saves a supported installation in a bounded number of queries", async () => {
    const repositories = Array.from({ length: 2_000 }, (_, index) => evidence(index + 1))
    await prisma.repository.createMany({
      data: repositories.slice(0, 1_000).map((repository) => ({
        defaultBranch: "trunk",
        githubRepositoryId: BigInt(repository.githubRepositoryId),
        nameWithOwner: repository.nameWithOwner,
      })),
    })

    const counted = createQueryCountingClient()
    const ids = await counted.client
      .$transaction((transaction) =>
        upsertConnectedRepositories(transaction, repositories, { allowReconnect: false }),
      )
      .finally(() => counted.client.$disconnect())

    expect(counted.statements()).toBeLessThanOrEqual(4)
    expect(new Set(ids).size).toBe(2_000)
    const saved = await prisma.repository.findMany({
      select: { defaultBranch: true, githubRepositoryId: true, id: true },
    })
    expect(saved).toHaveLength(2_000)
    expect(saved.every((row) => row.defaultBranch === "main")).toBe(true)
    const idsByGitHubId = new Map(saved.map((row) => [Number(row.githubRepositoryId), row.id]))
    expect(ids).toEqual(
      repositories.map((repository) => idsByGitHubId.get(repository.githubRepositoryId)),
    )
  })

  it("writes only repositories whose evidence changed", async () => {
    const unchanged = await prisma.repository.create({
      data: { defaultBranch: "main", githubRepositoryId: 1n, nameWithOwner: "octo/one" },
    })
    const renamed = await prisma.repository.create({
      data: { defaultBranch: "main", githubRepositoryId: 2n, nameWithOwner: "octo/old-two" },
    })

    const ids = await upsertConnectedRepositories(
      prisma,
      [evidence(2, "octo/two"), evidence(1, "octo/one"), evidence(3, "octo/three")],
      { allowReconnect: false },
    )

    const rows = await prisma.repository.findMany({ orderBy: { githubRepositoryId: "asc" } })
    expect(ids.slice(0, 2)).toEqual([renamed.id, unchanged.id])
    expect(ids[2]).toBe(rows[2]?.id)
    expect(rows.map((row) => row.nameWithOwner)).toEqual(["octo/one", "octo/two", "octo/three"])
    expect(rows[0]?.updatedAt).toEqual(unchanged.updatedAt)
    expect(rows[1]!.updatedAt.getTime()).toBeGreaterThan(renamed.updatedAt.getTime())
  })

  it("preserves ambiguous legacy histories instead of attaching either to a GitHub ID", async () => {
    const older = await prisma.repository.create({
      data: {
        createdAt: new Date("2024-01-01"),
        defaultBranch: "main",
        nameWithOwner: "Octo/Legacy",
      },
    })
    const newer = await prisma.repository.create({
      data: {
        createdAt: new Date("2024-02-01"),
        defaultBranch: "main",
        nameWithOwner: "octo/legacy",
      },
    })
    const olderHistory = await prisma.prototype.create({
      data: { branchName: "prototype/older", repositoryId: older.id },
    })
    const newerHistory = await prisma.prototype.create({
      data: { branchName: "prototype/newer", repositoryId: newer.id },
    })

    const ids = await upsertConnectedRepositories(
      prisma,
      [evidence(7, "octo/legacy"), evidence(7, "octo/legacy")],
      { allowReconnect: false },
    )

    expect(ids[0]).not.toBe(older.id)
    expect(ids[0]).not.toBe(newer.id)
    expect(ids[1]).toBe(ids[0])
    await expect(
      prisma.repository.findUniqueOrThrow({
        include: { prototypes: { select: { id: true } } },
        where: { id: ids[0]! },
      }),
    ).resolves.toMatchObject({
      githubRepositoryId: 7n,
      prototypes: [],
    })
    await expect(
      prisma.repository.findMany({
        include: { prototypes: { select: { id: true } } },
        orderBy: { createdAt: "asc" },
        where: { id: { in: [older.id, newer.id] } },
      }),
    ).resolves.toMatchObject([
      { githubRepositoryId: null, id: older.id, prototypes: [{ id: olderHistory.id }] },
      { githubRepositoryId: null, id: newer.id, prototypes: [{ id: newerHistory.id }] },
    ])
  })

  it("reconnects disconnected repositories only when allowed", async () => {
    const disconnected = await prisma.repository.create({
      data: {
        defaultBranch: "main",
        githubRepositoryId: 5n,
        nameWithOwner: "octo/five",
        removedAt: new Date("2024-01-01"),
      },
    })

    await expect(
      upsertConnectedRepositories(prisma, [evidence(6), evidence(5, "octo/five")], {
        allowReconnect: false,
      }),
    ).rejects.toThrow("User evidence cannot reconnect a disconnected GitHub repository.")
    expect(await prisma.repository.count()).toBe(1)

    await expect(
      upsertConnectedRepositories(prisma, [evidence(5, "octo/five")], { allowReconnect: true }),
    ).resolves.toEqual([disconnected.id])
    expect(
      await prisma.repository.findUniqueOrThrow({ where: { id: disconnected.id } }),
    ).toMatchObject({
      removedAt: null,
    })
  })
})
