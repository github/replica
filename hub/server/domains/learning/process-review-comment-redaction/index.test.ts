import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { processReviewCommentRedaction } from "."

type Dependencies = Parameters<typeof processReviewCommentRedaction>[1]

async function withLearningLock<T>(run: (signal: AbortSignal) => Promise<T>) {
  return await run(new AbortController().signal)
}

describe("processReviewCommentRedaction()", () => {
  it("serializes redaction through the learning lock and does nothing without a store", async () => {
    let lockCalls = 0
    async function withLock<T>(run: (signal: AbortSignal) => Promise<T>) {
      lockCalls++
      return await withLearningLock(run)
    }
    const prepare = vi.fn().mockResolvedValue({
      directory: "/private/repository",
      repositoryScope: "github.com/repositories/repository",
    })
    const runCommand: Dependencies["runCommand"] = vi.fn()
    const markComplete = vi.fn().mockResolvedValue(undefined)

    await processReviewCommentRedaction(
      { repositoryId: "repository", commentId: 101, actor: "human:mona" },
      {
        root: "/private",
        markComplete,
        now: () => new Date("2026-11-13T10:00:00Z"),
        prepare,
        runCommand,
        withLock,
      },
    )

    expect(lockCalls).toBe(1)
    expect(prepare).not.toHaveBeenCalled()
    expect(runCommand).not.toHaveBeenCalled()
    expect(markComplete).not.toHaveBeenCalled()
  })

  it("redacts by Hub comment ID while holding the store lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "replica-redaction-"))
    await mkdir(join(root, "repositories", "repository"), { recursive: true })
    await writeFile(join(root, "repositories", "repository", "config.json"), "{}")
    try {
      let lockCalls = 0
      async function withLock<T>(run: (signal: AbortSignal) => Promise<T>) {
        lockCalls++
        return await withLearningLock(run)
      }
      const prepare = vi.fn().mockResolvedValue({
        directory: join(root, "repositories", "repository"),
        repositoryScope: "github.com/repositories/repository",
      })
      const runCommand: Dependencies["runCommand"] = vi.fn().mockResolvedValue(undefined)
      const markComplete = vi.fn().mockResolvedValue(undefined)
      await processReviewCommentRedaction(
        { repositoryId: "repository", commentId: 101, actor: "human:mona" },
        {
          root,
          markComplete,
          now: () => new Date("2026-11-13T10:00:00Z"),
          prepare,
          runCommand,
          withLock,
        },
      )

      expect(lockCalls).toBe(1)
      expect(prepare).toHaveBeenCalledWith("repository")
      const [arguments_, options] = vi.mocked(runCommand).mock.calls[0] ?? []
      expect(arguments_).toEqual([
        "redact",
        "--comment",
        "101",
        "--by",
        "human:mona",
        "--dir",
        join(root, "repositories", "repository"),
        "--repository",
        "github.com/repositories/repository",
      ])
      expect(options?.signal).toBeInstanceOf(AbortSignal)
      expect(markComplete).toHaveBeenCalledWith({
        repositoryId: "repository",
        commentId: 101,
        redactedAt: new Date("2026-11-13T10:00:00Z"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("keeps redaction pending when the store is inaccessible", async () => {
    const root = await mkdtemp(join(tmpdir(), "replica-redaction-"))
    await mkdir(join(root, "repositories", "repository"), { recursive: true })
    await writeFile(join(root, "repositories", "repository", "config.json"), "{}")
    try {
      const markComplete = vi.fn()
      await expect(
        processReviewCommentRedaction(
          { repositoryId: "repository", commentId: 101, actor: "human:mona" },
          {
            root,
            markComplete,
            now: () => new Date(),
            prepare: vi
              .fn()
              .mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" })),
            runCommand: vi.fn(),
            withLock: withLearningLock,
          },
        ),
      ).rejects.toMatchObject({ code: "EACCES" })
      expect(markComplete).not.toHaveBeenCalled()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
