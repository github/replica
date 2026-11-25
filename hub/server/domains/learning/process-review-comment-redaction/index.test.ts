import { chmod, copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { describe, expect, it, vi } from "vitest"

import { processReviewCommentRedaction } from "."
import { redactLegacyReviewComment } from "../../../integrations/learning/redact-legacy-review-comment"
import { runLearningCommand } from "../../../integrations/learning/run-learning-command"

type Dependencies = Parameters<typeof processReviewCommentRedaction>[1]
type StoredEvent = {
  payload?: { commentId?: number; body?: string }
  redaction?: { commentId?: number }
}

const repositoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

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
      repositoryScope: "github.com/repositories/123",
      repositoryId,
    })
    const runCommand: Dependencies["runCommand"] = vi.fn()
    const markComplete = vi.fn().mockResolvedValue(undefined)

    await processReviewCommentRedaction(
      { repositoryId, commentId: 101, actor: "human:mona" },
      {
        root: "/private",
        markComplete,
        now: () => new Date("2026-11-13T10:00:00Z"),
        prepare,
        redactLegacy: vi.fn(),
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
    await mkdir(join(root, "repositories", repositoryId), { recursive: true })
    await writeFile(join(root, "repositories", repositoryId, "config.json"), "{}")
    try {
      let lockCalls = 0
      async function withLock<T>(run: (signal: AbortSignal) => Promise<T>) {
        lockCalls++
        return await withLearningLock(run)
      }
      const prepare = vi.fn().mockResolvedValue({
        directory: join(root, "repositories", repositoryId),
        repositoryScope: "github.com/repositories/123",
        repositoryId,
      })
      const runCommand: Dependencies["runCommand"] = vi.fn().mockResolvedValue(undefined)
      const markComplete = vi.fn().mockResolvedValue(undefined)
      await processReviewCommentRedaction(
        { repositoryId, commentId: 101, actor: "human:mona" },
        {
          root,
          markComplete,
          now: () => new Date("2026-11-13T10:00:00Z"),
          prepare,
          redactLegacy: vi.fn(),
          runCommand,
          withLock,
        },
      )

      expect(lockCalls).toBe(1)
      expect(prepare).toHaveBeenCalledWith(repositoryId)
      const [arguments_, options] = vi.mocked(runCommand).mock.calls[0] ?? []
      expect(arguments_).toEqual([
        "redact",
        "--comment",
        "101",
        "--by",
        "human:mona",
        "--dir",
        join(root, "repositories", repositoryId),
        "--repository",
        "github.com/repositories/123",
        "--legacy-repository",
        `github.com/repositories/${repositoryId}`,
      ])
      expect(options?.signal).toBeInstanceOf(AbortSignal)
      expect(markComplete).toHaveBeenCalledWith({
        repositoryId,
        commentId: 101,
        redactedAt: new Date("2026-11-13T10:00:00Z"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("keeps redaction pending when the store is inaccessible", async () => {
    const root = await mkdtemp(join(tmpdir(), "replica-redaction-"))
    await mkdir(join(root, "repositories", repositoryId), { recursive: true })
    await writeFile(join(root, "repositories", repositoryId, "config.json"), "{}")
    try {
      const markComplete = vi.fn()
      await expect(
        processReviewCommentRedaction(
          { repositoryId, commentId: 101, actor: "human:mona" },
          {
            root,
            markComplete,
            now: () => new Date(),
            prepare: vi
              .fn()
              .mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" })),
            redactLegacy: vi.fn(),
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

  it("retries an ID-less repository's legacy redaction before marking it complete", async () => {
    await mkdir(resolve(".local"), { recursive: true })
    const root = await mkdtemp(resolve(".local/redaction-"))
    await mkdir(join(root, "repositories", repositoryId), { recursive: true })
    await writeFile(join(root, "repositories", repositoryId, "config.json"), "{}")
    try {
      const redactLegacy = vi
        .fn()
        .mockRejectedValueOnce(new Error("interrupted"))
        .mockResolvedValueOnce(undefined)
      const markComplete = vi.fn()
      const dependencies = {
        root,
        markComplete,
        now: () => new Date("2026-11-13T10:00:00Z"),
        prepare: vi.fn().mockResolvedValue(null),
        redactLegacy,
        runCommand: vi.fn(),
        withLock: withLearningLock,
      }
      const input = { repositoryId, commentId: 101, actor: "human:mona" }

      await expect(processReviewCommentRedaction(input, dependencies)).rejects.toThrow(
        "interrupted",
      )
      expect(markComplete).not.toHaveBeenCalled()
      await processReviewCommentRedaction(input, dependencies)
      expect(redactLegacy).toHaveBeenCalledTimes(2)
      expect(redactLegacy.mock.calls[0]?.[0]).toEqual(input)
      expect((redactLegacy.mock.calls[0]?.[1] as { signal: AbortSignal }).signal).toBeInstanceOf(
        AbortSignal,
      )
      expect(markComplete).toHaveBeenCalledOnce()
      expect(dependencies.runCommand).not.toHaveBeenCalled()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("removes deleted comment text from the original SQLite store without assigning a GitHub ID", async () => {
    await mkdir(resolve(".local"), { recursive: true })
    const root = await mkdtemp(resolve(".local/redaction-"))
    const legacyId = "11111111-2222-4333-8444-555555555555"
    const directory = join(root, "repositories", legacyId)
    const cliPath = resolve("../packages/learning/bin/replica-learning.mjs")
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(
      join(directory, "config.json"),
      JSON.stringify({
        schemaVersion: "replica.learning-config/v1",
        memory: { provider: "sqlite" },
      }),
      { mode: 0o600 },
    )
    try {
      await copyFile(
        resolve("../packages/learning/test/fixtures/legacy-hub-scope.sqlite"),
        join(directory, "learning.sqlite"),
      )
      await chmod(join(directory, "learning.sqlite"), 0o600)
      const markComplete = vi.fn()
      const input = { repositoryId: legacyId, commentId: 101, actor: "human:mona" }
      const dependencies = {
        root,
        prepare: vi.fn().mockResolvedValue(null),
        redactLegacy: (request: typeof input, { signal }: { signal: AbortSignal }) =>
          redactLegacyReviewComment(request, {
            root,
            staticDirectories: [],
            cliPath,
            nodePath: process.execPath,
            signal,
          }),
        runCommand: vi.fn(),
        markComplete,
        now: () => new Date(),
        withLock: withLearningLock,
      }

      await processReviewCommentRedaction(input, dependencies)
      await processReviewCommentRedaction(input, dependencies)

      const db = new DatabaseSync(join(directory, "learning.sqlite"), { readOnly: true })
      try {
        const events = db
          .prepare("select body from records where stream = 'events'")
          .all()
          .map((row) => JSON.parse(String(row.body)) as StoredEvent)
        expect(events.some((event) => event.redaction?.commentId === 101 && !event.payload)).toBe(
          true,
        )
        expect(events.some((event) => event.payload?.commentId === 101)).toBe(false)
        expect(
          events.some((event) => event.payload?.commentId !== 101 && event.payload?.body),
        ).toBe(true)
        expect(
          db.prepare("select name from sqlite_master where name = 'scope_migrations'").get(),
        ).toBeUndefined()
      } finally {
        db.close()
      }
      expect(markComplete).toHaveBeenCalledTimes(2)
      const config = JSON.parse(await readFile(join(directory, "config.json"), "utf8")) as {
        memory: { provider: string }
      }
      expect(config.memory.provider).toBe("sqlite")
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it("removes deleted comment text from the original JSON Lines store without assigning a GitHub ID", async () => {
    await mkdir(resolve(".local"), { recursive: true })
    const root = await mkdtemp(resolve(".local/redaction-"))
    const legacyId = "11111111-2222-4333-8444-555555555555"
    const directory = join(root, "repositories", legacyId)
    const cliPath = resolve("../packages/learning/bin/replica-learning.mjs")
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(
      join(directory, "config.json"),
      JSON.stringify({
        schemaVersion: "replica.learning-config/v1",
        memory: { provider: "jsonl" },
      }),
      { mode: 0o600 },
    )
    try {
      const fixtureCopy = join(root, "fixture.sqlite")
      await copyFile(
        resolve("../packages/learning/test/fixtures/legacy-hub-scope.sqlite"),
        fixtureCopy,
      )
      const db = new DatabaseSync(fixtureCopy, { readOnly: true })
      try {
        const rows = db.prepare("select stream, body from records order by seq").all()
        const memories = db.prepare("select body from memory_versions order by seq").all()
        await mkdir(join(directory, "v1"), { mode: 0o700 })
        for (const stream of new Set(rows.map((row) => String(row.stream)))) {
          const bodies = rows.filter((row) => row.stream === stream).map((row) => row.body)
          await writeFile(join(directory, "v1", `${stream}.jsonl`), `${bodies.join("\n")}\n`, {
            mode: 0o600,
          })
        }
        if (memories.length) {
          await writeFile(
            join(directory, "v1", "memories.jsonl"),
            `${memories.map((row) => row.body).join("\n")}\n`,
            { mode: 0o600 },
          )
        }
      } finally {
        db.close()
      }
      const markComplete = vi.fn()
      const input = { repositoryId: legacyId, commentId: 101, actor: "human:mona" }
      const dependencies = {
        root,
        prepare: vi.fn().mockResolvedValue(null),
        redactLegacy: (request: typeof input, { signal }: { signal: AbortSignal }) =>
          redactLegacyReviewComment(request, {
            root,
            staticDirectories: [],
            cliPath,
            nodePath: process.execPath,
            signal,
          }),
        runCommand: vi.fn(),
        markComplete,
        now: () => new Date(),
        withLock: withLearningLock,
      }

      await processReviewCommentRedaction(input, dependencies)
      await processReviewCommentRedaction(input, dependencies)

      const events = (await readFile(join(directory, "v1", "events.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as StoredEvent)
      expect(events.some((event) => event.redaction?.commentId === 101 && !event.payload)).toBe(
        true,
      )
      expect(events.some((event) => event.payload?.commentId === 101)).toBe(false)
      expect(events.some((event) => event.payload?.commentId !== 101 && event.payload?.body)).toBe(
        true,
      )
      expect(markComplete).toHaveBeenCalledTimes(2)
      const config = JSON.parse(await readFile(join(directory, "config.json"), "utf8")) as {
        memory: { provider: string }
      }
      expect(config.memory.provider).toBe("jsonl")
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it("redacts a migrated SQLite store using its durable UUID mapping", async () => {
    await mkdir(resolve(".local"), { recursive: true })
    const root = await mkdtemp(resolve(".local/redaction-"))
    const legacyId = "11111111-2222-4333-8444-555555555555"
    const directory = join(root, "repositories", legacyId)
    const cliPath = resolve("../packages/learning/bin/replica-learning.mjs")
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
      await runLearningCommand(
        [
          "status",
          "--dir",
          directory,
          "--repository",
          "github.com/repositories/123",
          "--legacy-repository",
          `github.com/repositories/${legacyId}`,
        ],
        { cliPath },
      )
      const markComplete = vi.fn()
      const input = { repositoryId: legacyId, commentId: 101, actor: "human:mona" }
      await processReviewCommentRedaction(input, {
        root,
        prepare: vi.fn().mockResolvedValue(null),
        redactLegacy: (request, { signal }) =>
          redactLegacyReviewComment(request, {
            root,
            staticDirectories: [],
            cliPath,
            nodePath: process.execPath,
            signal,
          }),
        runCommand: vi.fn(),
        markComplete,
        now: () => new Date(),
        withLock: withLearningLock,
      })
      const db = new DatabaseSync(join(directory, "learning.sqlite"), { readOnly: true })
      try {
        const events = db
          .prepare("select scope_key, body from records where stream = 'events'")
          .all()
        expect(
          events.some(
            (row) => (JSON.parse(String(row.body)) as StoredEvent).redaction?.commentId === 101,
          ),
        ).toBe(true)
        expect(events.every((row) => String(row.scope_key).includes("repositories/123"))).toBe(true)
      } finally {
        db.close()
      }
      expect(markComplete).toHaveBeenCalledOnce()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
