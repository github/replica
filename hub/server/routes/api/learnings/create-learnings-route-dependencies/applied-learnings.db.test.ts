import pino from "pino"
import { describe, expect, it, vi } from "vitest"

import { getAppliedLearnings } from "../../../../domains/learning/get-applied-learnings"
import { prisma } from "../../../../integrations/prisma"
import { getDatabaseUrl } from "../../../../../test/database/get-database-url"
import { createLearningsRouteDependencies } from "."

vi.mock("../../../../integrations/bullmq/create-job-queue", () => ({
  createJobQueue: vi.fn(() => ({ close: vi.fn() })),
}))
vi.mock("../../../../domains/learning/get-applied-learnings", () => ({
  getAppliedLearnings: vi.fn(),
}))

describe("applied learnings", () => {
  it("stops showing a screenshot as soon as screenshot consent changes", async () => {
    const repository = await prisma.repository.create({
      data: { defaultBranch: "main", githubRepositoryId: 17n, nameWithOwner: "octo/source" },
    })
    await prisma.repositoryEvaluationSetting.create({
      data: { repositoryId: repository.id, enabled: true, screenshotGrantId: "grant_1" },
    })
    const sha256 = "c".repeat(64)
    await prisma.agentScreenshot.create({
      data: { repositoryId: repository.id, grantId: "grant_1", sha256, storageKey: "shot-1" },
    })
    // The same image reported under an earlier, withdrawn grant must stay hidden.
    vi.mocked(getAppliedLearnings).mockResolvedValue([
      {
        id: "mem_1",
        title: "Label every field",
        version: 2,
        after: { sha256, route: "/checkout", consentGrantId: "grant_1" },
      },
      {
        id: "mem_2",
        title: "Use one column",
        version: 1,
        after: { sha256, route: "/checkout", consentGrantId: "grant_0" },
      },
    ])
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const read = vi.fn().mockResolvedValue({ status: "ok", bytes })
    const learnings = await createLearningsRouteDependencies(
      { HUB_APPLICATION_ORIGIN: "https://hub.example.test", DATABASE_URL: getDatabaseUrl() },
      { restore: vi.fn() },
      pino({ level: "silent" }),
      { artifactStorage: { read } },
    )
    const address = {
      repositoryId: repository.id,
      prototypeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      commitSha: "a".repeat(40),
    }

    expect(await learnings.getAppliedLearnings(address)).toEqual([
      {
        id: "mem_1",
        title: "Label every field",
        version: 2,
        after: { sha256, route: "/checkout" },
      },
      { id: "mem_2", title: "Use one column", version: 1 },
    ])
    expect(await learnings.readScreenshot({ repositoryId: repository.id, sha256 })).toEqual({
      bytes,
      grantId: "grant_1",
    })
    expect(read).toHaveBeenCalledWith("shot-1")
    await prisma.repositoryEvaluationSetting.update({
      where: { repositoryId: repository.id },
      data: { screenshotGrantId: null },
    })

    expect(await learnings.getAppliedLearnings(address)).toEqual([
      { id: "mem_1", title: "Label every field", version: 2 },
      { id: "mem_2", title: "Use one column", version: 1 },
    ])
    expect(await learnings.readScreenshot({ repositoryId: repository.id, sha256 })).toBeNull()
    expect(
      await learnings.isScreenshotGrantActive({ repositoryId: repository.id, grantId: "grant_1" }),
    ).toBe(false)
  })
})
