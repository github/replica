import { randomUUID } from "node:crypto"
import { chmod, copyFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { describe, expect, it, vi } from "vitest"

import { enqueueRecoverableJob } from "../../../integrations/bullmq/enqueue-recoverable-job"
import * as learningCommand from "../../../integrations/learning/run-learning-command"
import { deleteExpiredLearningRuns } from "../../../repositories/learning-runs/delete-expired-learning-runs"
import { redactReviewCommentJob } from "../jobs/redact-review-comment"
import { createLearningJobProcessors } from "."

const prisma = {
  learningRun: { findMany: vi.fn() },
  agentScreenshot: { findMany: vi.fn() },
  learningDecisionOperation: { findMany: vi.fn() },
  repository: { findUnique: vi.fn() },
  reviewComment: { findMany: vi.fn(), updateMany: vi.fn() },
}

vi.mock("../../../integrations/prisma", () => ({ prisma }))
vi.mock("../../../repositories/learning-runs/delete-expired-learning-runs", () => ({
  deleteExpiredLearningRuns: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("../../../integrations/postgres/with-learning-execution-lock", () => ({
  withLearningExecutionLock: ({ run }: { run: (signal: AbortSignal) => Promise<unknown> }) =>
    run(new AbortController().signal),
}))
vi.mock("../../../integrations/bullmq/create-job-queue", () => ({
  createJobQueue: vi.fn(() => ({ close: vi.fn() })),
}))
vi.mock("../../../integrations/bullmq/enqueue-recoverable-job", () => ({
  enqueueRecoverableJob: vi.fn(),
}))

describe("createLearningJobProcessors()", () => {
  it("redacts database comments without creating a local store", async () => {
    const root = resolve(`server/domains/learning/.redaction-worker-${randomUUID()}`)
    const repositoryId = "11111111-2222-4333-8444-555555555555"
    const learningDatabaseUrl = "postgresql://learning.example/replica"
    const command = vi.spyOn(learningCommand, "runLearningCommand").mockResolvedValue({})
    prisma.repository.findUnique.mockResolvedValue({ githubRepositoryId: 123n })
    prisma.reviewComment.updateMany.mockResolvedValue({ count: 1 })
    const processors = createLearningJobProcessors(
      {
        DATABASE_URL: "postgresql://unused.example/replica",
        HUB_APPLICATION_ORIGIN: "https://hub.example.com",
        REPLICA_LEARNING_DATABASE_URL: learningDatabaseUrl,
        REPLICA_LEARNING_ROOT: root,
      },
      {} as never,
    )

    await processors.redact.process({ repositoryId, commentId: 101, actor: "human:mona" })

    expect(command).toHaveBeenCalledOnce()
    const [arguments_, options] = command.mock.calls[0]!
    expect(arguments_).toEqual(expect.arrayContaining(["redact", "--comment", "101"]))
    expect(arguments_).not.toContain(learningDatabaseUrl)
    expect(options).toMatchObject({ learningDatabaseUrl })
    expect(prisma.reviewComment.updateMany).toHaveBeenCalledOnce()
    await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("prunes run history without initializing learning or Copilot when scheduling is disabled", async () => {
    const processors = createLearningJobProcessors(
      {
        DATABASE_URL: "postgresql://unused.example/replica",
        REPLICA_COPILOT_TOKEN: "would-require-explicit-authentication",
        REPLICA_LEARNING_AUTOMATIC_RUNS: "false",
        REPLICA_LEARNING_ROOT: "/would-be-rejected",
      },
      {} as never,
    )

    await expect(processors.schedule.process({})).resolves.toEqual({ scheduled: 0 })

    expect(deleteExpiredLearningRuns).toHaveBeenCalledOnce()
    expect(deleteExpiredLearningRuns).toHaveBeenCalledWith(prisma, expect.any(Date))
  })

  it("recovers a failed redaction in the ID-less repository's own store", async () => {
    await mkdir(resolve(".local"), { recursive: true })
    const root = await mkdtemp(resolve(".local/redaction-worker-"))
    const repositoryId = "11111111-2222-4333-8444-555555555555"
    const directory = join(root, "repositories", repositoryId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await copyFile(
      resolve("../packages/learning/test/fixtures/legacy-hub-scope.sqlite"),
      join(directory, "learning.sqlite"),
    )
    await chmod(join(directory, "learning.sqlite"), 0o600)
    await writeFile(join(directory, "config.json"), "{", { mode: 0o600 })
    try {
      prisma.repository.findUnique.mockResolvedValue({ githubRepositoryId: null })
      prisma.reviewComment.updateMany.mockResolvedValue({ count: 1 })
      const processors = createLearningJobProcessors(
        {
          DATABASE_URL: "postgresql://unused.example/replica",
          HUB_APPLICATION_ORIGIN: "https://hub.example.com",
          REPLICA_LEARNING_ROOT: root,
        },
        {} as never,
      )
      const request = { repositoryId, commentId: 101, actor: "human:mona" }
      await expect(processors.redact.process(request)).rejects.toThrow()
      expect(prisma.reviewComment.updateMany).not.toHaveBeenCalled()

      await writeFile(
        join(directory, "config.json"),
        JSON.stringify({ schemaVersion: "replica.learning-config/v1" }),
      )
      prisma.learningRun.findMany.mockResolvedValue([])
      prisma.agentScreenshot.findMany.mockResolvedValue([])
      prisma.learningDecisionOperation.findMany.mockResolvedValue([])
      prisma.reviewComment.findMany.mockResolvedValue([
        {
          publicId: 101,
          id: "22222222-2222-4222-8222-222222222222",
          deletedAt: new Date("2026-11-13T10:00:00Z"),
          authorLogin: "mona",
          learningRedactionActor: "human:mona",
          thread: { repositoryId },
        },
      ])
      await processors.recover.process({})
      expect(enqueueRecoverableJob).toHaveBeenCalledWith(
        expect.anything(),
        redactReviewCommentJob,
        request,
        `learning-redact-${repositoryId}-101`,
      )
      await processors.redact.process(request)

      const db = new DatabaseSync(join(directory, "learning.sqlite"), { readOnly: true })
      try {
        const events = db.prepare("select body from records where stream = 'events'").all()
        expect(
          events.some(
            (row) =>
              (JSON.parse(String(row.body)) as { redaction?: { commentId?: number } }).redaction
                ?.commentId === 101,
          ),
        ).toBe(true)
      } finally {
        db.close()
      }
      expect(prisma.reviewComment.updateMany).toHaveBeenCalledOnce()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it("uses the repository ID from one lookup for an ID-backed redaction", async () => {
    await mkdir(resolve(".local"), { recursive: true })
    const root = await mkdtemp(resolve(".local/redaction-worker-"))
    const repositoryId = "11111111-2222-4333-8444-555555555555"
    const directory = join(root, "repositories", repositoryId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await copyFile(
      resolve("../packages/learning/test/fixtures/legacy-hub-scope.sqlite"),
      join(directory, "learning.sqlite"),
    )
    await chmod(join(directory, "learning.sqlite"), 0o600)
    await writeFile(
      join(directory, "config.json"),
      JSON.stringify({ schemaVersion: "replica.learning-config/v1" }),
      { mode: 0o600 },
    )
    try {
      prisma.repository.findUnique
        .mockResolvedValueOnce({ githubRepositoryId: 9007199254740993n })
        .mockResolvedValueOnce({ githubRepositoryId: 2n })
      prisma.reviewComment.updateMany.mockResolvedValue({ count: 1 })
      const processors = createLearningJobProcessors(
        {
          DATABASE_URL: "postgresql://unused.example/replica",
          HUB_APPLICATION_ORIGIN: "https://hub.example.com",
          REPLICA_LEARNING_ROOT: root,
        },
        {} as never,
      )

      await processors.redact.process({ repositoryId, commentId: 101, actor: "human:mona" })

      expect(prisma.repository.findUnique).toHaveBeenCalledOnce()
      const db = new DatabaseSync(join(directory, "learning.sqlite"), { readOnly: true })
      try {
        const events = db
          .prepare("select scope_key, body from records where stream = 'events'")
          .all()
        expect(
          events.some(
            (row) =>
              row.scope_key ===
                '{"host":"github.com","repository":"repositories/9007199254740993"}' &&
              (JSON.parse(String(row.body)) as { redaction?: { commentId?: number } }).redaction
                ?.commentId === 101,
          ),
        ).toBe(true)
      } finally {
        db.close()
      }
      expect(prisma.reviewComment.updateMany).toHaveBeenCalledOnce()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
