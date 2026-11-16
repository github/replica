import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { findPrototypeDetail } from "."

describe("findPrototypeDetail()", () => {
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
})
