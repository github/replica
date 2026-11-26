import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it, onTestFinished, vi } from "vitest"
import { z } from "zod"

import { prisma } from "../../../integrations/prisma"
import { runLearningCommand } from "../../../integrations/learning/run-learning-command"
import { createHubReviewCollection } from "../../learning/create-hub-review-collection"
import { prepareLearningStore } from "../../learning/prepare-learning-store"
import { captureRepositoryReviewSnapshot } from "../../review-comments/capture-repository-review-snapshot"
import { createReviewCommentService } from "../../review-comments/create-review-comment-service"
import { getDatabaseUrl } from "../../../../test/database/get-database-url"
import { createHubDecisionTasksetSource } from "."

const execFileAsync = promisify(execFile)
const cliPath = resolve("../packages/learning/bin/replica-learning.mjs")
const repositoryScope = "github.com/repositories/123456"

async function workspace() {
  const root = resolve("..", `.decision-snapshot-${randomUUID()}`)
  await mkdir(root, { recursive: true, mode: 0o700 })
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  await execFileAsync("git", ["init", "-q", root])
  await writeFile(join(root, ".gitignore"), ".replica/\n")
  const scratch = join(root, ".replica", "scratch")
  await mkdir(scratch, { recursive: true, mode: 0o700 })
  vi.stubEnv("TMPDIR", scratch)
  vi.stubEnv("TMP", scratch)
  vi.stubEnv("TEMP", scratch)
  return root
}

async function learningDatabase(root: string) {
  const adminUrl = getDatabaseUrl()
  const name = `replica_learning_test_${randomUUID().replaceAll("-", "")}`
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`)
  } finally {
    await admin.end()
  }
  onTestFinished(async () => {
    const cleanup = new pg.Client({ connectionString: adminUrl })
    await cleanup.connect()
    try {
      await cleanup.query(`DROP DATABASE ${pg.escapeIdentifier(name)} WITH (FORCE)`)
    } finally {
      await cleanup.end()
    }
  })
  const url = new URL(adminUrl)
  url.pathname = name
  await execFileAsync(process.execPath, [cliPath, "migrate", "--json"], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      REPLICA_LEARNING_MIGRATION_DATABASE_URL: url.href,
    },
  })
  return url.href
}

async function reviewedRepository() {
  const repository = await prisma.repository.create({
    data: { githubRepositoryId: 123456n, nameWithOwner: "team/checkout", defaultBranch: "main" },
  })
  const prototype = await prisma.prototype.create({
    data: {
      repositoryId: repository.id,
      branchName: "checkout",
      name: "Checkout",
      registeredAt: new Date(),
    },
  })
  const build = await prisma.build.create({
    data: { prototypeId: prototype.id, number: 1, state: "successful" },
  })
  const user = await prisma.user.create({
    data: { profile: { create: { provider: "github", login: "reviewer", name: null } } },
  })
  await createReviewCommentService(prisma).createThread({
    sessionDigest: "a".repeat(64),
    repositoryId: repository.id,
    prototypeId: prototype.id,
    buildNumber: build.number,
    body: "Keep the field label visible.",
    actor: { userId: user.id, login: "reviewer", name: null },
    anchor: {
      schemaVersion: 1,
      kind: "element",
      route: { pathname: "/checkout", search: "", hash: "" },
      selector: "#email",
      accessibleName: "Email",
      tagName: "input",
      selectedText: "",
      rect: { x: 0, y: 0, width: 100, height: 40 },
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
      elementOffset: { x: 0.5, y: 0.5 },
    },
  })
  return { repository, prototype }
}

function storeArguments(root: string, repositoryId: string) {
  return [
    "--dir",
    join(root, ".replica", "learning", "repositories", repositoryId),
    "--repository",
    repositoryScope,
    "--legacy-repository",
    `github.com/repositories/${repositoryId}`,
  ]
}

async function addGrant(
  root: string,
  repositoryId: string,
  purposes: string[],
  learningDatabaseUrl?: string,
) {
  if (!learningDatabaseUrl) {
    await prepareLearningStore({
      applicationRoot: root,
      repositoryKey: repositoryId,
      repositoryScope,
      root: join(root, ".replica", "learning"),
      staticDirectories: [],
    })
  }
  return (await runLearningCommand(
    [
      "grants",
      "add",
      ...purposes.flatMap((purpose) => ["--purpose", purpose]),
      "--basis",
      "The team agreed to use review evidence.",
      "--by",
      "human:reviewer",
      ...storeArguments(root, repositoryId),
    ],
    { cliPath, learningDatabaseUrl },
  )) as { id: string }
}

async function withdrawTraining(root: string, repositoryId: string, grantId: string) {
  await runLearningCommand(
    [
      "grants",
      "withdraw",
      grantId,
      "--purpose",
      "training",
      "--by",
      "human:reviewer",
      ...storeArguments(root, repositoryId),
    ],
    { cliPath },
  )
}

async function importSqlite(root: string, repositoryId: string, databaseUrl: string) {
  await execFileAsync(
    process.execPath,
    [cliPath, "import-sqlite", "--offline", ...storeArguments(root, repositoryId), "--json"],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        REPLICA_LEARNING_DATABASE_URL: databaseUrl,
      },
    },
  )
}

function source(root: string, learningDatabaseUrl?: string) {
  return createHubDecisionTasksetSource({
    applicationRoot: root,
    artifactStorage: {} as never,
    cliPath,
    database: prisma,
    databaseUrl: getDatabaseUrl(),
    hubOrigin: "https://hub.example.test",
    learningDatabaseUrl,
    learningRoot: join(root, ".replica", "learning"),
    staticDirectories: [],
  }).tasksetSource
}

function exported(bytes: Uint8Array) {
  return JSON.parse(new TextDecoder().decode(bytes)) as {
    manifest: { records: { kind: string; id: string; digest: string }[] }
    grants: unknown[]
    collections: { id: string; snapshotId: string; capturedAt: string }[]
    episodes: { timeline: { payload?: { body?: string } }[] }[]
    memories: unknown[]
  }
}

async function sqliteWithLegacySnapshot() {
  const root = await workspace()
  const { repository, prototype } = await reviewedRepository()
  const grant = await addGrant(root, repository.id, ["review", "training"])
  const request = { repositoryId: repository.id, actorMembershipId: randomUUID() }
  const first = await source(root).exportTrainingEvidence(request)
  const [collection] = exported(first.bytes).collections
  if (!collection) throw new Error("Expected an initial review collection.")
  const path = join(
    root,
    ".replica",
    "learning",
    "repositories",
    repository.id,
    "decision-review-snapshot.json",
  )
  const legacy = readableLegacySnapshot(await readFile(path, "utf8"))
  if (!legacy) throw new Error("Expected the initial SQLite checkpoint.")
  expect(legacy).toMatchObject({
    digest: first.repeatableReviewSnapshotDigest,
    snapshotId: collection.snapshotId,
  })
  expect(new Date(legacy.capturedAt)).toEqual(new Date(collection.capturedAt))
  await expect(
    prisma.decisionReviewSnapshot.findUnique({ where: { repositoryId: repository.id } }),
  ).resolves.toBeNull()
  await withdrawTraining(root, repository.id, grant.id)
  await prisma.prototype.update({ where: { id: prototype.id }, data: { name: "Account" } })
  return { root, repository, prototype, request, first, collection, path }
}

/** Invalid legacy files cause older preflights to fail instead of reusing a snapshot. */
function readableLegacySnapshot(contents: string) {
  try {
    const parsed = z
      .object({ digest: z.string(), snapshotId: z.uuid(), capturedAt: z.iso.datetime() })
      .strict()
      .safeParse(JSON.parse(contents))
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

describe("createHubDecisionTasksetSource() training exports", () => {
  it("retries PostgreSQL exports and imports a returned snapshot as new", async () => {
    const root = await workspace()
    const databaseUrl = await learningDatabase(root)
    const { repository, prototype } = await reviewedRepository()
    const grant = await addGrant(root, repository.id, ["review", "training"], databaseUrl)
    const request = { repositoryId: repository.id, actorMembershipId: randomUUID() }
    const directory = join(root, ".replica", "learning", "repositories", repository.id)

    const first = await source(root, databaseUrl).exportTrainingEvidence(request)
    const retry = await source(root, databaseUrl).exportTrainingEvidence(request)
    expect(retry).toEqual(first)
    expect(first.consentGrantId).toBe(grant.id)
    expect(exported(first.bytes).episodes[0]?.timeline[0]?.payload?.body).toBe(
      "Keep the field label visible.",
    )
    expect(exported(first.bytes).collections).toHaveLength(1)

    await prisma.prototype.update({ where: { id: prototype.id }, data: { name: "Account" } })
    const changed = await source(root, databaseUrl).exportTrainingEvidence(request)
    await prisma.prototype.update({ where: { id: prototype.id }, data: { name: "Checkout" } })
    const returned = await source(root, databaseUrl).exportTrainingEvidence(request)
    const returnedRetry = await source(root, databaseUrl).exportTrainingEvidence(request)

    expect(returned.repeatableReviewSnapshotDigest).toBe(first.repeatableReviewSnapshotDigest)
    expect(returned.digest).not.toBe(first.digest)
    expect(exported(changed.bytes).collections).toHaveLength(2)
    expect(exported(returned.bytes).collections).toHaveLength(3)
    expect(exported(returned.bytes).collections[2]?.snapshotId).not.toBe(
      exported(first.bytes).collections[0]?.snapshotId,
    )
    expect(returnedRetry).toEqual(returned)
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" })
  }, 60_000)

  it("does not overwrite an unchanged successor after the execution lock is lost", async () => {
    const root = await workspace()
    const databaseUrl = await learningDatabase(root)
    const { repository, prototype } = await reviewedRepository()
    await addGrant(root, repository.id, ["review"], databaseUrl)
    const request = { repositoryId: repository.id, actorMembershipId: randomUUID() }
    const first = await source(root, databaseUrl).exportTrainingEvidence(request)
    const checkpoint = await prisma.decisionReviewSnapshot.findUniqueOrThrow({
      where: { repositoryId: repository.id },
      select: { digest: true, snapshotId: true, capturedAt: true },
    })
    await prisma.prototype.update({ where: { id: prototype.id }, data: { name: "Account" } })

    const gate = new pg.Client({ connectionString: getDatabaseUrl() })
    await gate.connect()
    const trigger = `checkpoint_gate_${randomUUID().replaceAll("-", "")}`
    let gateHeld = false
    let stale: Promise<unknown> | null = null
    try {
      // Pause the write while its connection still owns the execution lock.
      await gate.query(`
        CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM pg_advisory_xact_lock(1919242348, 201);
          RETURN NULL;
        END $$;
        CREATE TRIGGER "${trigger}" BEFORE UPDATE ON decision_review_snapshots
        FOR EACH STATEMENT EXECUTE FUNCTION "${trigger}"();
      `)
      await gate.query("SELECT pg_advisory_lock(1919242348, 201)")
      gateHeld = true
      stale = source(root, databaseUrl).exportTrainingEvidence(request)
      void stale.catch(() => {})

      let blockedPid = 0
      await vi.waitFor(
        async () => {
          const waiting = await gate.query<{ pid: number }>(`
            SELECT waiting.pid
            FROM pg_locks AS waiting
            JOIN pg_locks AS execution ON execution.pid = waiting.pid
            WHERE waiting.locktype = 'advisory' AND waiting.classid = 1919242348
              AND waiting.objid = 201 AND NOT waiting.granted
              AND execution.locktype = 'advisory' AND execution.classid = 1919242348
              AND execution.objid = 2 AND execution.granted
              AND waiting.database = (SELECT oid FROM pg_database WHERE datname = current_database())
          `)
          expect(waiting.rows).toHaveLength(1)
          blockedPid = waiting.rows[0]!.pid
        },
        { timeout: 10_000 },
      )
      const terminated = await gate.query<{ terminated: boolean }>(
        "SELECT pg_terminate_backend($1) AS terminated",
        [blockedPid],
      )
      expect(terminated.rows).toEqual([{ terminated: true }])
      await expect(stale).rejects.toThrow()

      await prisma.prototype.update({ where: { id: prototype.id }, data: { name: "Checkout" } })
      await gate.query("SELECT pg_advisory_unlock(1919242348, 201)")
      gateHeld = false
      const successor = await source(root, databaseUrl).exportTrainingEvidence(request)
      expect(successor.repeatableReviewSnapshotDigest).toBe(first.repeatableReviewSnapshotDigest)
      await expect(
        prisma.decisionReviewSnapshot.findUniqueOrThrow({
          where: { repositoryId: repository.id },
          select: { digest: true, snapshotId: true, capturedAt: true },
        }),
      ).resolves.toEqual(checkpoint)
      expect(await source(root, databaseUrl).exportTrainingEvidence(request)).toEqual(successor)
    } finally {
      if (gateHeld) await gate.query("SELECT pg_advisory_unlock(1919242348, 201)")
      if (stale) await stale.catch(() => {})
      await gate.query(
        `DROP TRIGGER IF EXISTS "${trigger}" ON decision_review_snapshots; DROP FUNCTION IF EXISTS "${trigger}"()`,
      )
      await gate.end()
    }
  }, 60_000)

  it("imports a returned snapshot after a change without training consent", async () => {
    const root = await workspace()
    const databaseUrl = await learningDatabase(root)
    const { repository, prototype } = await reviewedRepository()
    const grant = await addGrant(root, repository.id, ["review", "training"], databaseUrl)
    const request = { repositoryId: repository.id, actorMembershipId: randomUUID() }
    const first = await source(root, databaseUrl).exportTrainingEvidence(request)

    await runLearningCommand(
      [
        "grants",
        "withdraw",
        grant.id,
        "--purpose",
        "training",
        "--by",
        "human:reviewer",
        ...storeArguments(root, repository.id),
      ],
      { cliPath, learningDatabaseUrl: databaseUrl },
    )
    await prisma.prototype.update({ where: { id: prototype.id }, data: { name: "Account" } })
    const withheld = await source(root, databaseUrl).exportTrainingEvidence(request)
    const status = await runLearningCommand(["status", ...storeArguments(root, repository.id)], {
      cliPath,
      learningDatabaseUrl: databaseUrl,
    })
    expect(withheld.consentGrantId).toBeNull()
    expect(withheld.bytes).toHaveLength(0)
    expect(withheld.repeatableReviewSnapshotDigest).not.toBe(first.repeatableReviewSnapshotDigest)
    expect(status).toMatchObject({ counts: { completeCollections: 1 } })

    await addGrant(root, repository.id, ["training"], databaseUrl)
    await prisma.prototype.update({ where: { id: prototype.id }, data: { name: "Checkout" } })
    const returned = await source(root, databaseUrl).exportTrainingEvidence(request)
    const retry = await source(root, databaseUrl).exportTrainingEvidence(request)

    expect(returned.repeatableReviewSnapshotDigest).toBe(first.repeatableReviewSnapshotDigest)
    expect(exported(returned.bytes).collections).toHaveLength(2)
    expect(exported(returned.bytes).collections[1]?.snapshotId).not.toBe(
      exported(first.bytes).collections[0]?.snapshotId,
    )
    expect(retry).toEqual(returned)
  }, 60_000)

  it("retries the same export after an offline SQLite migration", async () => {
    const root = await workspace()
    const databaseUrl = await learningDatabase(root)
    const { repository } = await reviewedRepository()
    await addGrant(root, repository.id, ["review", "training"])
    const request = { repositoryId: repository.id, actorMembershipId: randomUUID() }
    const directory = join(root, ".replica", "learning", "repositories", repository.id)
    const original = await source(root).exportTrainingEvidence(request)
    const originalBundle = exported(original.bytes)
    const [collection] = originalBundle.collections
    expect(collection).toBeDefined()
    const legacy = readableLegacySnapshot(
      await readFile(join(directory, "decision-review-snapshot.json"), "utf8"),
    )
    if (!legacy) throw new Error("Expected the initial SQLite checkpoint.")
    expect(legacy).toMatchObject({
      digest: original.repeatableReviewSnapshotDigest,
      snapshotId: collection!.snapshotId,
    })
    expect(new Date(legacy.capturedAt)).toEqual(new Date(collection!.capturedAt))
    await expect(
      prisma.decisionReviewSnapshot.findUnique({ where: { repositoryId: repository.id } }),
    ).resolves.toBeNull()
    await importSqlite(root, repository.id, databaseUrl)

    const retained = await source(root, databaseUrl).exportTrainingEvidence(request)
    await rm(directory, { recursive: true, force: true })
    const unmounted = await source(root, databaseUrl).exportTrainingEvidence(request)
    const migratedBundle = exported(retained.bytes)
    expect(migratedBundle.collections).toEqual(originalBundle.collections)
    expect(migratedBundle.manifest.records).toEqual(originalBundle.manifest.records)
    expect(migratedBundle.grants).toEqual(originalBundle.grants)
    expect(migratedBundle.episodes).toEqual(originalBundle.episodes)
    expect(migratedBundle.memories).toEqual(originalBundle.memories)
    expect(unmounted).toEqual(retained)
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" })
  }, 60_000)

  it("preserves a no-consent snapshot from the SQLite file during cutover", async () => {
    const root = await workspace()
    const databaseUrl = await learningDatabase(root)
    const { repository, prototype } = await reviewedRepository()
    const grant = await addGrant(root, repository.id, ["review", "training"])
    const request = { repositoryId: repository.id, actorMembershipId: randomUUID() }
    const directory = join(root, ".replica", "learning", "repositories", repository.id)
    const first = await source(root).exportTrainingEvidence(request)

    await runLearningCommand(
      [
        "grants",
        "withdraw",
        grant.id,
        "--purpose",
        "training",
        "--by",
        "human:reviewer",
        ...storeArguments(root, repository.id),
      ],
      { cliPath },
    )
    await prisma.prototype.update({ where: { id: prototype.id }, data: { name: "Account" } })
    const withheld = await source(root).exportTrainingEvidence(request)
    expect(withheld.bytes).toHaveLength(0)
    const legacySnapshot = readableLegacySnapshot(
      await readFile(join(directory, "decision-review-snapshot.json"), "utf8"),
    )
    expect(legacySnapshot).toMatchObject({ digest: withheld.repeatableReviewSnapshotDigest })
    if (!legacySnapshot) throw new Error("Expected the no-consent SQLite checkpoint.")
    await expect(
      prisma.decisionReviewSnapshot.findUnique({ where: { repositoryId: repository.id } }),
    ).resolves.toBeNull()
    await importSqlite(root, repository.id, databaseUrl)

    const migrated = await source(root, databaseUrl).exportTrainingEvidence(request)
    expect(migrated.consentGrantId).toBeNull()
    expect(migrated.bytes).toHaveLength(0)
    expect(migrated.repeatableReviewSnapshotDigest).toBe(withheld.repeatableReviewSnapshotDigest)
    expect(
      await prisma.decisionReviewSnapshot.findUniqueOrThrow({
        where: { repositoryId: repository.id },
      }),
    ).toMatchObject({
      ...legacySnapshot,
      capturedAt: new Date(legacySnapshot.capturedAt),
    })
    await rm(directory, { recursive: true, force: true })

    await addGrant(root, repository.id, ["training"], databaseUrl)
    await prisma.prototype.update({ where: { id: prototype.id }, data: { name: "Checkout" } })
    const returned = await source(root, databaseUrl).exportTrainingEvidence(request)
    const retry = await source(root, databaseUrl).exportTrainingEvidence(request)
    expect(returned.repeatableReviewSnapshotDigest).toBe(first.repeatableReviewSnapshotDigest)
    expect(exported(returned.bytes).collections).toHaveLength(2)
    expect(exported(returned.bytes).collections[1]?.snapshotId).not.toBe(
      exported(first.bytes).collections[0]?.snapshotId,
    )
    expect(retry).toEqual(returned)
  }, 60_000)

  it("does not reuse A after an older SQLite writer observes B without consent", async () => {
    const { root, repository, prototype, request, first, collection, path } =
      await sqliteWithLegacySnapshot()
    const snapshot = await captureRepositoryReviewSnapshot(prisma, repository.id)
    const changed = createHubReviewCollection(snapshot, "https://hub.example.test", repositoryScope)
    expect(changed.digest).not.toBe(first.repeatableReviewSnapshotDigest)
    await writeFile(
      path,
      JSON.stringify({
        digest: changed.digest,
        snapshotId: snapshot.snapshotId,
        capturedAt: snapshot.capturedAt.toISOString(),
      }),
      { mode: 0o600 },
    )
    await expect(
      prisma.decisionReviewSnapshot.findUnique({ where: { repositoryId: repository.id } }),
    ).resolves.toBeNull()

    await addGrant(root, repository.id, ["training"])
    await prisma.prototype.update({ where: { id: prototype.id }, data: { name: "Checkout" } })
    const returned = await source(root).exportTrainingEvidence(request)
    expect(returned.repeatableReviewSnapshotDigest).toBe(first.repeatableReviewSnapshotDigest)
    expect(exported(returned.bytes).collections).toHaveLength(2)
    expect(exported(returned.bytes).collections[1]?.snapshotId).not.toBe(collection.snapshotId)
    expect(await source(root).exportTrainingEvidence(request)).toEqual(returned)
    await expect(
      prisma.decisionReviewSnapshot.findUnique({ where: { repositoryId: repository.id } }),
    ).resolves.toBeNull()
  }, 60_000)

  it("updates the SQLite checkpoint when training consent is off", async () => {
    const { root, repository, prototype, request, first, collection, path } =
      await sqliteWithLegacySnapshot()
    const withheld = await source(root).exportTrainingEvidence(request)
    expect(withheld.consentGrantId).toBeNull()
    expect(withheld.bytes).toHaveLength(0)
    expect(withheld.repeatableReviewSnapshotDigest).not.toBe(first.repeatableReviewSnapshotDigest)

    const legacy = readableLegacySnapshot(await readFile(path, "utf8"))
    expect(legacy).toMatchObject({ digest: withheld.repeatableReviewSnapshotDigest })
    expect(legacy?.snapshotId).not.toBe(collection.snapshotId)
    await expect(
      prisma.decisionReviewSnapshot.findUnique({ where: { repositoryId: repository.id } }),
    ).resolves.toBeNull()

    await addGrant(root, repository.id, ["training"])
    await prisma.prototype.update({ where: { id: prototype.id }, data: { name: "Checkout" } })
    const returned = await source(root).exportTrainingEvidence(request)
    expect(exported(returned.bytes).collections).toHaveLength(2)
    expect(exported(returned.bytes).collections[1]?.snapshotId).not.toBe(collection.snapshotId)
    expect(await source(root).exportTrainingEvidence(request)).toEqual(returned)
  }, 60_000)

  it("does not import evidence without training consent", async () => {
    const root = await workspace()
    const databaseUrl = await learningDatabase(root)
    const { repository } = await reviewedRepository()
    await addGrant(root, repository.id, ["review"], databaseUrl)
    const request = { repositoryId: repository.id, actorMembershipId: randomUUID() }

    const result = await source(root, databaseUrl).exportTrainingEvidence(request)
    const status = await runLearningCommand(["status", ...storeArguments(root, repository.id)], {
      cliPath,
      learningDatabaseUrl: databaseUrl,
    })
    expect(result.consentGrantId).toBeNull()
    expect(result.bytes).toHaveLength(0)
    expect(status).toMatchObject({
      counts: { episodes: 0, events: 0, completeCollections: 0, incompleteCollections: 0 },
    })
    await expect(
      access(join(root, ".replica", "learning", "repositories", repository.id)),
    ).rejects.toMatchObject({ code: "ENOENT" })
  }, 60_000)
})
