import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { seedPrototypeIndexData } from "./seed-prototype-index-data"

describe("prototype index seed", () => {
  it("seeds a member's prototypes and restores their metadata on rerun", async () => {
    const user = await prisma.user.create({ data: {} })
    await prisma.membership.create({ data: { userId: user.id } })
    await seedPrototypeIndexData(prisma, user.id)
    const select = {
      id: true,
      number: true,
      state: true,
      workflowCreatedAt: true,
      commitSha: true,
      authorProvider: true,
      authorIssuer: true,
      authorProviderUserId: true,
      authorLogin: true,
      authorName: true,
      authorAvatarUrl: true,
      startedAt: true,
      finishedAt: true,
      failureSummary: true,
    } as const
    const samples = await prisma.build.findMany({ select, orderBy: { id: "asc" } })
    expect(samples).toHaveLength(5)
    const prototypes = await prisma.prototype.findMany({
      select: { id: true, authorId: true, startPage: true },
      orderBy: { id: "asc" },
    })
    expect(prototypes.every((prototype) => prototype.authorId === user.id)).toBe(true)
    expect(prototypes.every((prototype) => prototype.startPage === null)).toBe(true)
    expect(samples.map((build) => build.state)).toEqual(
      expect.arrayContaining(["queued", "running", "successful", "failed", "superseded"]),
    )
    for (const build of samples) {
      expect(build.commitSha).toMatch(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
      expect(build.authorProvider).toMatch(/\S/)
      expect(build.authorIssuer).toMatch(/\S/)
      expect(build.authorProviderUserId).toMatch(/\S/)
      expect(build.authorLogin).toMatch(/\S/)
      expect(build.authorName).toMatch(/\S/)
      expect(build.authorProviderUserId).not.toBe(user.id)
      if (build.state === "queued") {
        expect(build.startedAt).toBeNull()
        expect(build.finishedAt).toBeNull()
      }
      if (build.state === "running") {
        expect(build.startedAt).toBeInstanceOf(Date)
        expect(build.finishedAt).toBeNull()
      }
      if (build.state === "successful" || build.state === "failed") {
        expect(build.startedAt).toBeInstanceOf(Date)
        expect(build.finishedAt).toBeInstanceOf(Date)
      }
      if (build.state === "superseded") {
        expect(build.startedAt).toBeNull()
        expect(build.finishedAt).toBeInstanceOf(Date)
      }
      if (build.workflowCreatedAt && build.startedAt) {
        expect(build.startedAt.getTime()).toBeGreaterThanOrEqual(build.workflowCreatedAt.getTime())
      }
      if (build.startedAt && build.finishedAt) {
        expect(build.finishedAt.getTime()).toBeGreaterThanOrEqual(build.startedAt.getTime())
      }
      if (build.state === "failed") {
        expect(build.failureSummary).toEqual(expect.stringMatching(/\S/))
      } else {
        expect(build.failureSummary).toBeNull()
      }
    }

    for (const build of samples) {
      await prisma.build.update({
        where: { id: build.id },
        data: {
          commitSha: null,
          authorProvider: "changed-provider",
          authorIssuer: "https://changed.example.test",
          authorProviderUserId: "changed-external-id",
          authorLogin: "changed-login",
          authorName: "Changed Author",
          authorAvatarUrl: "https://example.test/changed.png",
          startedAt:
            build.state === "running" || build.state === "successful" || build.state === "failed"
              ? new Date("2000-01-01T00:00:00Z")
              : null,
          finishedAt:
            build.state === "superseded" || build.state === "successful" || build.state === "failed"
              ? new Date("2000-01-01T00:01:00Z")
              : null,
          failureSummary: build.state === "failed" ? "Changed failure" : null,
        },
      })
    }
    await prisma.prototype.updateMany({ data: { startPage: "/settings" } })
    await seedPrototypeIndexData(prisma, user.id)
    expect(await prisma.build.findMany({ select, orderBy: { id: "asc" } })).toEqual(samples)
    expect(
      await prisma.prototype.findMany({
        select: { id: true, authorId: true, startPage: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(prototypes)
  }, 60_000)
})
