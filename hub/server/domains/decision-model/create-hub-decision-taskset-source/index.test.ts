import { createHash } from "node:crypto"
import { mkdir, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { describe, expect, it, vi } from "vitest"

import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types"
import { createHubReviewCollection } from "../../learning/create-hub-review-collection"
import { prepareLearningStore } from "../../learning/prepare-learning-store"
import { captureRepositoryReviewSnapshot } from "../../review-comments/capture-repository-review-snapshot"
import { runLearningCommand } from "../../../integrations/learning/run-learning-command"
import { withLearningExecutionLock } from "../../../integrations/postgres/with-learning-execution-lock"
import { listDecisionTrainingBuilds } from "../../../repositories/decision-training-builds/list-decision-training-builds"
import { findDecisionEvaluationBuild } from "../../../repositories/decision-training-builds/find-decision-evaluation-build"
import { listDecisionWithdrawalSources } from "../../../repositories/decision-training-jobs/list-decision-withdrawal-sources"
import { createHubDecisionTasksetSource } from "."

vi.mock("../../learning/create-hub-review-collection", () => ({
  createHubReviewCollection: vi.fn(),
}))
vi.mock("../../learning/prepare-learning-store", () => ({
  prepareLearningStore: vi.fn(),
}))
vi.mock("../../review-comments/capture-repository-review-snapshot", () => ({
  captureRepositoryReviewSnapshot: vi.fn(),
}))
vi.mock("../../../integrations/learning/run-learning-command", () => ({
  runLearningCommand: vi.fn(),
}))
vi.mock("../../../integrations/postgres/with-learning-execution-lock", () => ({
  withLearningExecutionLock: vi.fn(),
}))
vi.mock("../../../repositories/decision-training-builds/list-decision-training-builds", () => ({
  listDecisionTrainingBuilds: vi.fn(),
}))
vi.mock("../../../repositories/decision-training-builds/find-decision-evaluation-build", () => ({
  findDecisionEvaluationBuild: vi.fn(),
}))
vi.mock("../../../repositories/decision-training-jobs/list-decision-withdrawal-sources", () => ({
  listDecisionWithdrawalSources: vi.fn(),
}))

const repositoryId = "11111111-1111-4111-8111-111111111111"
const prototypeId = "22222222-2222-4222-8222-222222222222"
const buildId = "33333333-3333-4333-8333-333333333333"

function createPng(width = 1440, height = 900) {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.write("IHDR", 12, "ascii")
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return Uint8Array.from(bytes)
}

const png = createPng()

function digest(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function storage(
  reads: Record<string, Uint8Array | "not-found" | "unavailable">,
): ArtifactStorage & { readMock: ReturnType<typeof vi.fn> } {
  const readMock = vi.fn((key: string) => {
    const result = reads[key]
    return Promise.resolve(
      result instanceof Uint8Array
        ? { status: "ok" as const, bytes: result }
        : { status: result ?? ("not-found" as const) },
    )
  })
  return {
    isReady: vi.fn().mockResolvedValue(true),
    read: readMock,
    readMock,
    write: vi.fn(),
    delete: vi.fn(),
  }
}

function hubSource(artifactStorage: ArtifactStorage) {
  return createHubDecisionTasksetSource({
    applicationRoot: process.cwd(),
    artifactStorage,
    cliPath: "/replica-learning.mjs",
    database: {} as never,
    databaseUrl: "postgresql://test",
    hubOrigin: "https://hub.example.test",
    learningRoot: "server/domains/decision-model/create-hub-decision-taskset-source/.learning",
    staticDirectories: [],
    stabilizeSnapshot: vi.fn().mockResolvedValue({
      snapshotId: "55555555-5555-4555-8555-555555555555",
      capturedAt: new Date("2026-01-05T00:00:00.000Z"),
    }),
  })
}

function source(artifactStorage: ArtifactStorage) {
  return hubSource(artifactStorage).tasksetSource
}

function artifact(kind: "manifest" | "screenshot", path: string, key: string, bytes: Uint8Array) {
  return { kind, path, storageKey: key, byteLength: bytes.byteLength }
}

function repository(artifacts: ReturnType<typeof artifact>[]) {
  return {
    id: repositoryId,
    prototypes: [
      {
        id: prototypeId,
        builds: [
          {
            id: buildId,
            number: 7,
            createdAt: new Date("2026-01-03T00:00:00.000Z"),
            workflowCreatedAt: new Date("2026-01-02T00:00:00.000Z"),
            finishedAt: new Date("2026-01-04T00:00:00.000Z"),
            artifacts,
          },
        ],
      },
    ],
  }
}

function decodeArchive(bytes: Uint8Array) {
  return JSON.parse(new TextDecoder().decode(bytes)) as {
    schemaVersion: string
    builds: { builds: Array<{ screenshots: Array<Record<string, unknown>> }> }
    files: Array<Record<string, unknown>>
    issues: { code: string }[]
  }
}

describe("createHubDecisionTasksetSource()", () => {
  it("reads active training consent and NOUL learning questions for the requesting member", async () => {
    const learningId = "mem_111111111111111111111111"
    vi.mocked(prepareLearningStore).mockResolvedValue({
      directory: "/private/learning/repository",
      repositoryScope: `github.com/repositories/${repositoryId}`,
    })
    vi.mocked(runLearningCommand).mockImplementation((arguments_) => {
      if (arguments_[0] === "grants") {
        return Promise.resolve([
          {
            grant: { id: "expired-training", sources: ["hub_review_comments"] },
            activePurposes: ["training"],
            expired: true,
          },
          {
            grant: { id: "active-training", sources: ["manual"] },
            activePurposes: ["training"],
            expired: false,
          },
        ])
      }
      return Promise.resolve({
        questions: {
          [learningId]: {
            type: "noul",
            instructions: "Does the candidate follow this learning?",
            learning_text: "Use the approved account heading.",
            criteria: { true: "Follows", false: "Breaks" },
          },
          "choice-question": {
            type: "choice",
            instructions: "Choose the strongest option.",
            criteria: { first: "First", second: "Second" },
          },
          "score-question": {
            type: "score",
            instructions: "Score the result.",
            criteria: ["Poor", "Strong"],
          },
        },
      })
    })

    const result = await hubSource(storage({})).readAgentLearningAuthority({
      repositoryId,
      actorMembershipId: "44444444-4444-4444-8444-444444444444",
    })

    expect(result).toEqual({
      consentGranted: true,
      questionDigest: digest(
        new TextEncoder().encode(
          `{"${learningId}":{"learning_text":"Use the approved account heading."}}`,
        ),
      ),
      questions: {
        [learningId]: { learning_text: "Use the approved account heading." },
      },
    })
    expect(runLearningCommand).toHaveBeenCalledWith(
      expect.arrayContaining([
        "decision",
        "questions",
        "--by",
        "human:44444444-4444-4444-8444-444444444444",
      ]),
      expect.anything(),
    )
  })

  it("continues withdrawal discovery after one repository store fails", async () => {
    vi.mocked(listDecisionWithdrawalSources).mockResolvedValue([
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", decisionTrainingJobs: [], accessGrants: [] },
      {
        id: repositoryId,
        decisionTrainingJobs: [
          {
            consentGrantId: "grant-training",
            trainingExportId: "export-1",
            evidenceDigest: `sha256:${"e".repeat(64)}`,
            tasksetDigest: `sha256:${"t".repeat(64)}`,
            requestedByMembershipId: "44444444-4444-4444-8444-444444444444",
            requestedByMembership: {
              user: { profile: { login: "mona" } },
            },
          },
        ],
        accessGrants: [
          {
            membershipId: "99999999-9999-4999-8999-999999999999",
            membership: { user: { profile: { login: "active-admin" } } },
          },
        ],
      },
    ] as never)
    vi.mocked(prepareLearningStore)
      .mockRejectedValueOnce(new Error("damaged store"))
      .mockResolvedValueOnce({
        directory: "/private/learning/repository",
        repositoryScope: `github.com/repositories/${repositoryId}`,
      })
    vi.mocked(runLearningCommand).mockResolvedValue([
      {
        id: "withdrawal-1",
        grantId: "grant-secondary",
        purposes: ["training"],
        withdrawnBy: { id: "github:mona" },
      },
    ])

    await expect(source(storage({})).listTrainingWithdrawals()).resolves.toHaveLength(1)
  })

  it("maps training grant withdrawals to idempotent runtime deletion selectors", async () => {
    vi.mocked(listDecisionWithdrawalSources).mockResolvedValue([
      {
        id: repositoryId,
        decisionTrainingJobs: [
          {
            consentGrantId: "grant-training",
            trainingExportId: "export-1",
            evidenceDigest: `sha256:${"e".repeat(64)}`,
            tasksetDigest: `sha256:${"t".repeat(64)}`,
            requestedByMembershipId: "44444444-4444-4444-8444-444444444444",
            requestedByMembership: {
              user: { profile: { login: "mona" } },
            },
          },
        ],
        accessGrants: [
          {
            membershipId: "99999999-9999-4999-8999-999999999999",
            membership: { user: { profile: { login: "other-admin" } } },
          },
        ],
      },
    ] as never)
    vi.mocked(prepareLearningStore).mockResolvedValue({
      directory: "/private/learning/repository",
      repositoryScope: `github.com/repositories/${repositoryId}`,
    })
    vi.mocked(runLearningCommand).mockResolvedValue([
      {
        id: "withdrawal-1",
        grantId: "grant-secondary",
        purposes: ["training"],
        withdrawnBy: { id: "github:mona" },
        reason: "The repository administrator withdrew training consent.",
      },
    ])

    await expect(source(storage({})).listTrainingWithdrawals()).resolves.toEqual([
      {
        repositoryId,
        actorMembershipId: "99999999-9999-4999-8999-999999999999",
        actorLogin: "mona",
        selectors: { grantId: "grant-secondary" },
        reason: "The repository administrator withdrew training consent.",
        idempotencyKey: "withdrawal:withdrawal-1:grant",
      },
    ])
  })

  it("reports deterministic eligible evidence, task, split, and label counts", async () => {
    vi.mocked(withLearningExecutionLock).mockImplementation(({ run }) =>
      run(new AbortController().signal, {
        runWithoutRepositoryAuthorityLock: (operation) => operation(),
      }),
    )
    vi.mocked(prepareLearningStore).mockResolvedValue({
      directory: "/private/learning/repository",
      repositoryScope: `github.com/repositories/${repositoryId}`,
    })
    vi.mocked(captureRepositoryReviewSnapshot).mockResolvedValue({
      repository: { id: repositoryId },
      threads: [],
    } as never)
    vi.mocked(createHubReviewCollection).mockReturnValue({
      collection: { schemaVersion: "replica.learning-collection/v1", records: [] },
      digest: `sha256:${"b".repeat(64)}`,
    } as never)
    vi.mocked(runLearningCommand).mockImplementation(async (arguments_) => {
      if (arguments_[0] === "grants") {
        return [
          {
            grant: { id: "grant-training", sources: ["hub_review_comments"] },
            activePurposes: ["training", "review"],
            expired: false,
          },
        ]
      }
      if (arguments_[0] === "import") return { complete: true, problems: [] }
      const output = arguments_[arguments_.indexOf("--out") + 1]!
      if (arguments_[0] === "export") {
        await writeFile(
          output,
          JSON.stringify({
            manifest: {
              id: "volatile",
              createdAt: "2026-01-05T00:00:00.000Z",
              digest: `sha256:${"a".repeat(64)}`,
              records: [],
              excluded: [{ reason: "event-redacted", count: 2 }],
            },
            grants: [],
            collections: [],
            episodes: [],
            memories: [],
          }),
        )
        return {}
      }
      await mkdir(join(output, "images"), { recursive: true })
      await writeFile(
        join(output, "taskset.json"),
        JSON.stringify({
          counts: { tasks: 10, train: 6, dev: 2, test: 2, follows: 7, breaks: 3 },
          skipped: {
            "status-ambiguous": 2,
            "learning-over-limit": 1,
            "screenshot-missing": 1,
          },
        }),
      )
      await writeFile(
        join(output, "tasks.jsonl"),
        `${JSON.stringify({
          questions: {
            mem_111111111111111111111111: { type: "noul" },
            mem_222222222222222222222222: { type: "noul" },
          },
        })}\n`,
      )
      return {}
    })
    const captures = {
      "root-desktop": createPng(),
      "root-desktop-dark": createPng(),
      "root-narrow": createPng(390, 844),
      "root-narrow-dark": createPng(390, 844),
    }
    const artifacts = [
      artifact("screenshot", "screenshots/desktop.png", "root-desktop", captures["root-desktop"]),
      artifact(
        "screenshot",
        "screenshots/desktop-dark.png",
        "root-desktop-dark",
        captures["root-desktop-dark"],
      ),
      artifact("screenshot", "screenshots/narrow.png", "root-narrow", captures["root-narrow"]),
      artifact(
        "screenshot",
        "screenshots/narrow-dark.png",
        "root-narrow-dark",
        captures["root-narrow-dark"],
      ),
    ]
    vi.mocked(listDecisionTrainingBuilds).mockResolvedValue(repository(artifacts))
    const decisionSource = hubSource(storage(captures))

    const first = await decisionSource.tasksetSource.preflight({
      repositoryId,
      actorMembershipId: "44444444-4444-4444-8444-444444444444",
    })
    const second = await decisionSource.tasksetSource.preflight({
      repositoryId,
      actorMembershipId: "44444444-4444-4444-8444-444444444444",
    })

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      state: "blocked",
      counts: {
        prototypes: 1,
        builds: 1,
        pages: 1,
        screenshots: 4,
        questions: 2,
        tasks: 10,
        train: 6,
        dev: 2,
        test: 2,
        follows: 7,
        breaks: 3,
      },
      reasons: [
        { code: "event-redacted", count: 2 },
        { code: "learning-over-limit", count: 1 },
        { code: "screenshot-missing", count: 1 },
        { code: "status-ambiguous", count: 2 },
      ],
    })
    expect(first.digests.reviewSnapshot).toBe(`sha256:${"b".repeat(64)}`)
    expect(first.digests.export).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(first.digests.buildSet).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(first.digests.questionSet).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(first.digests.taskset).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(
      vi
        .mocked(runLearningCommand)
        .mock.calls.map(([arguments_]) => arguments_)
        .filter(([command]) => command === "export"),
    ).toEqual([expect.arrayContaining(["--preview"]), expect.arrayContaining(["--preview"])])
    const importCall = vi
      .mocked(runLearningCommand)
      .mock.calls.map(([arguments_]) => arguments_)
      .find(([command]) => command === "import")!
    expect(importCall).toEqual(expect.arrayContaining(["--grant", "grant-training"]))
    expect(importCall).not.toContain("grant-a")
  })

  it("reports withheld, corrupt, and missing evidence without exposing evidence or another repository", async () => {
    const otherRepositoryId = "99999999-9999-4999-8999-999999999999"
    const privateEvidence = "Do not expose this private learning"
    vi.mocked(withLearningExecutionLock).mockImplementation(({ run }) =>
      run(new AbortController().signal, {
        runWithoutRepositoryAuthorityLock: (operation) => operation(),
      }),
    )
    vi.mocked(prepareLearningStore).mockResolvedValue({
      directory: "/private/learning/repository",
      repositoryScope: `github.com/repositories/${repositoryId}`,
    })
    vi.mocked(captureRepositoryReviewSnapshot).mockResolvedValue({
      repository: { id: repositoryId },
      threads: [],
    } as never)
    vi.mocked(createHubReviewCollection).mockReturnValue({
      collection: {
        schemaVersion: "replica.learning-collection/v1",
        records: [{ repositoryId: otherRepositoryId, content: privateEvidence }],
      },
      digest: `sha256:${"c".repeat(64)}`,
    } as never)
    vi.mocked(runLearningCommand).mockResolvedValue([])
    const artifacts = [
      artifact("screenshot", "screenshots/desktop.png", "corrupt", Uint8Array.of(1, 2, 3)),
      artifact("screenshot", "screenshots/narrow.png", "missing", png),
    ]
    vi.mocked(listDecisionTrainingBuilds).mockImplementation((_, requestedRepositoryId) => {
      expect(requestedRepositoryId).toBe(repositoryId)
      return Promise.resolve(repository(artifacts)) as never
    })

    const result = await hubSource(
      storage({ corrupt: Uint8Array.of(1, 2, 3), missing: "not-found" }),
    ).tasksetSource.preflight({
      repositoryId,
      actorMembershipId: "44444444-4444-4444-8444-444444444444",
    })

    expect(result).toMatchObject({
      state: "blocked",
      counts: {
        prototypes: 1,
        builds: 1,
        pages: 0,
        screenshots: 0,
        questions: 0,
        tasks: 0,
        train: 0,
        dev: 0,
        test: 0,
        follows: 0,
        breaks: 0,
      },
      reasons: [
        { code: "artifact-corrupt", count: 1 },
        { code: "artifact-missing", count: 1 },
        { code: "consent-withheld", count: 1 },
        { code: "screenshot-coverage-incomplete", count: 1 },
      ],
      digests: {
        export: null,
        reviewSnapshot: `sha256:${"c".repeat(64)}`,
        questionSet: null,
        taskset: null,
      },
    })
    expect(JSON.stringify(result)).not.toContain(privateEvidence)
    expect(JSON.stringify(result)).not.toContain(otherRepositoryId)
    expect(runLearningCommand).toHaveBeenCalledTimes(1)
    expect(runLearningCommand).toHaveBeenCalledWith(
      expect.arrayContaining(["--repository", `github.com/repositories/${repositoryId}`]),
      expect.anything(),
    )
  })

  it("exports repository-scoped learning evidence deterministically on retry", async () => {
    vi.mocked(withLearningExecutionLock).mockImplementation(({ run }) =>
      run(new AbortController().signal, {
        runWithoutRepositoryAuthorityLock: (operation) => operation(),
      }),
    )
    vi.mocked(prepareLearningStore).mockResolvedValue({
      directory: "/private/learning/repository",
      repositoryScope: `github.com/repositories/${repositoryId}`,
    })
    vi.mocked(captureRepositoryReviewSnapshot).mockResolvedValue({
      repository: { id: repositoryId },
      threads: [],
    } as never)
    vi.mocked(createHubReviewCollection).mockReturnValue({
      collection: { schemaVersion: "replica.learning-collection/v1", records: [] },
      digest: `sha256:${"b".repeat(64)}`,
    } as never)
    let exportNumber = 0
    vi.mocked(runLearningCommand).mockImplementation(async (arguments_) => {
      if (arguments_[0] === "grants") {
        return [
          {
            grant: { id: "grant-z", sources: ["hub_review_comments"] },
            activePurposes: ["training"],
            expired: false,
          },
          {
            grant: { id: "grant-a", sources: ["hub_review_comments"] },
            activePurposes: ["training"],
            expired: false,
          },
          {
            grant: { id: "grant-review", sources: ["hub_review_comments"] },
            activePurposes: ["review"],
            expired: false,
          },
        ]
      }
      if (arguments_[0] === "import") return { complete: true, problems: [] }
      const output = arguments_[arguments_.indexOf("--out") + 1]!
      exportNumber++
      await writeFile(
        output,
        JSON.stringify({
          manifest: {
            id: `volatile-${exportNumber}`,
            createdAt: `2026-01-0${exportNumber}T00:00:00.000Z`,
            digest: `sha256:${"a".repeat(64)}`,
            records: [],
          },
          grants: [{ id: "grant-a", createdAt: "2026-01-05T00:00:00.000Z" }],
          collections: [],
          episodes: [],
          memories: [],
        }),
      )
      return {}
    })
    const tasksetSource = source(storage({}))

    const first = await tasksetSource.exportTrainingEvidence({
      repositoryId,
      actorMembershipId: "44444444-4444-4444-8444-444444444444",
    })
    const second = await tasksetSource.exportTrainingEvidence({
      repositoryId,
      actorMembershipId: "44444444-4444-4444-8444-444444444444",
    })

    expect(first).toEqual(second)
    expect(first.consentGrantId).toBe("grant-a")
    expect(first.digest).toBe(digest(first.bytes))
    expect(captureRepositoryReviewSnapshot).toHaveBeenCalledTimes(2)
    expect(captureRepositoryReviewSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      repositoryId,
      expect.any(Date),
    )
    expect(
      vi
        .mocked(runLearningCommand)
        .mock.calls.map(([arguments_]) => arguments_)
        .filter(([command]) => command === "export"),
    ).toEqual([
      expect.arrayContaining([
        "--repository",
        `github.com/repositories/${repositoryId}`,
        "--purpose",
        "training",
      ]),
      expect.arrayContaining([
        "--repository",
        `github.com/repositories/${repositoryId}`,
        "--purpose",
        "training",
      ]),
    ])
    expect(
      vi
        .mocked(runLearningCommand)
        .mock.calls.map(([arguments_]) => arguments_)
        .filter(([command]) => command === "export"),
    ).toEqual([expect.arrayContaining(["--preview"]), expect.arrayContaining(["--preview"])])
  })

  it("maps root and template captures to exact routes, viewports, themes, media, and digests", async () => {
    const manifest = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        templates: [
          {
            id: "settings",
            name: "Settings",
            category: "Account",
            description: "Account settings",
            path: "/settings?tab=profile#name",
          },
        ],
      }),
    )
    const captures = [
      ["screenshots/templates/settings/narrow-dark.png", "settings-narrow-dark"],
      ["screenshots/narrow.png", "root-narrow"],
      ["screenshots/templates/settings/desktop-dark.png", "settings-desktop-dark"],
      ["screenshots/desktop-dark.png", "root-desktop-dark"],
      ["screenshots/templates/settings/narrow.png", "settings-narrow"],
      ["screenshots/desktop.png", "root-desktop"],
      ["screenshots/narrow-dark.png", "root-narrow-dark"],
      ["screenshots/templates/settings/desktop.png", "settings-desktop"],
    ] as const
    const captureBytes = Object.fromEntries(
      captures.map(([path, key]) => [
        key,
        path.includes("narrow") ? createPng(390, 844) : createPng(),
      ]),
    )
    const artifacts = [
      artifact("manifest", "templates.json", "manifest", manifest),
      ...captures.map(([path, key]) =>
        artifact("screenshot", path, key, captureBytes[key] as Uint8Array),
      ),
    ]
    vi.mocked(listDecisionTrainingBuilds).mockResolvedValue(repository(artifacts))
    const tasksetSource = source(
      storage({
        manifest,
        ...captureBytes,
      }),
    )

    const first = await tasksetSource.readBuildArtifacts(repositoryId)
    const second = await tasksetSource.readBuildArtifacts(repositoryId)
    const archive = decodeArchive(first.bytes)

    expect(first).toEqual(second)
    expect(first.complete).toBe(true)
    expect(archive.issues).toEqual([])
    expect(archive.builds.builds[0]?.screenshots).toEqual([
      expect.objectContaining({
        route: "/",
        size: "desktop",
        theme: "light",
        viewport: { width: 1440, height: 900 },
        mediaType: "image/png",
        digest: digest(png),
      }),
      expect.objectContaining({
        route: "/",
        size: "desktop",
        theme: "dark",
        viewport: { width: 1440, height: 900 },
      }),
      expect.objectContaining({
        route: "/",
        size: "narrow",
        theme: "light",
        viewport: { width: 390, height: 844 },
      }),
      expect.objectContaining({
        route: "/",
        size: "narrow",
        theme: "dark",
        viewport: { width: 390, height: 844 },
      }),
      expect.objectContaining({
        route: "/settings?tab=profile#name",
        size: "desktop",
        theme: "light",
        viewport: { width: 1440, height: 900 },
      }),
      expect.objectContaining({
        route: "/settings?tab=profile#name",
        size: "desktop",
        theme: "dark",
        viewport: { width: 1440, height: 900 },
      }),
      expect.objectContaining({
        route: "/settings?tab=profile#name",
        size: "narrow",
        theme: "light",
        viewport: { width: 390, height: 844 },
      }),
      expect.objectContaining({
        route: "/settings?tab=profile#name",
        size: "narrow",
        theme: "dark",
        viewport: { width: 390, height: 844 },
      }),
    ])
    expect(archive.files).toHaveLength(8)
    expect(archive.files[0]).toMatchObject({ mediaType: "image/png", digest: digest(png) })
  })

  it("uses one deterministic capture group when template aliases share a route", async () => {
    const manifest = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        templates: [
          { id: "alias-a", path: "/", name: "A", category: "Test", description: "A" },
          { id: "alias-b", path: "/", name: "B", category: "Test", description: "B" },
        ],
      }),
    )
    const paths = [
      "screenshots/desktop.png",
      "screenshots/desktop-dark.png",
      "screenshots/narrow.png",
      "screenshots/narrow-dark.png",
      ...["alias-a", "alias-b"].flatMap((id) => [
        `screenshots/templates/${id}/desktop.png`,
        `screenshots/templates/${id}/desktop-dark.png`,
        `screenshots/templates/${id}/narrow.png`,
        `screenshots/templates/${id}/narrow-dark.png`,
      ]),
    ]
    const reads: Record<string, Uint8Array> = { manifest }
    const artifacts = [artifact("manifest", "templates.json", "manifest", manifest)]
    for (const [index, path] of paths.entries()) {
      const bytes = path.includes("narrow") ? createPng(390, 844) : createPng()
      const key = `capture-${index}`
      reads[key] = bytes
      artifacts.push(artifact("screenshot", path, key, bytes))
    }
    vi.mocked(listDecisionTrainingBuilds).mockResolvedValue(repository(artifacts))

    const result = await source(storage(reads)).readBuildArtifacts(repositoryId)
    const archive = decodeArchive(result.bytes)

    expect(result.complete).toBe(true)
    expect(archive.builds.builds[0]?.screenshots).toHaveLength(4)
    expect(archive.files).toHaveLength(4)
  })

  it("prepares deterministic Build views with the learning IDs and text used at evaluation", async () => {
    const learningId = "mem_111111111111111111111111"
    const captures = {
      "root-narrow-dark": createPng(390, 844),
      "root-desktop": createPng(),
      "root-narrow": createPng(390, 844),
      "root-desktop-dark": createPng(),
    }
    const artifacts = [
      artifact(
        "screenshot",
        "screenshots/narrow-dark.png",
        "root-narrow-dark",
        captures["root-narrow-dark"],
      ),
      artifact("screenshot", "screenshots/desktop.png", "root-desktop", captures["root-desktop"]),
      artifact("screenshot", "screenshots/narrow.png", "root-narrow", captures["root-narrow"]),
      artifact(
        "screenshot",
        "screenshots/desktop-dark.png",
        "root-desktop-dark",
        captures["root-desktop-dark"],
      ),
    ]
    vi.mocked(findDecisionEvaluationBuild).mockResolvedValue({
      ...repository(artifacts).prototypes[0]!.builds[0]!,
      prototypeId,
    })
    vi.mocked(prepareLearningStore).mockResolvedValue({
      directory: "/private/learning/repository",
      repositoryScope: `github.com/repositories/${repositoryId}`,
    })
    vi.mocked(runLearningCommand).mockResolvedValue({
      questions: {
        [learningId]: {
          type: "noul",
          instructions: "Does the candidate follow this learning?",
          learning_text: "Use the approved account heading.",
          criteria: { true: "It follows.", false: "It breaks." },
        },
      },
      rules: [{ id: learningId, text: "Use the approved account heading." }],
    })

    const prepared = await hubSource(storage(captures)).prepareBuildEvaluation({
      repositoryId,
      buildId,
      actorMembershipId: "44444444-4444-4444-8444-444444444444",
    })

    expect(prepared.route).toBe("/")
    expect(prepared.views).toEqual([
      { viewport: "desktop", theme: "light" },
      { viewport: "desktop", theme: "dark" },
      { viewport: "narrow", theme: "light" },
      { viewport: "narrow", theme: "dark" },
    ])
    expect(prepared.state.imagesNote).not.toContain(prepared.route)
    expect(prepared.images).toHaveLength(4)
    expect(prepared.questionDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(prepared.screenshotSetDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(runLearningCommand).toHaveBeenCalledWith(
      expect.arrayContaining([
        "decision",
        "questions",
        "--by",
        "human:44444444-4444-4444-8444-444444444444",
      ]),
      expect.anything(),
    )
    expect(
      vi
        .mocked(runLearningCommand)
        .mock.calls.some(([arguments_]) => arguments_.includes("--preview")),
    ).toBe(false)
  })

  it("refuses a Build selection that changes while artifacts are being read", async () => {
    const artifacts = [artifact("screenshot", "screenshots/desktop.png", "capture", png)]
    vi.mocked(listDecisionTrainingBuilds)
      .mockResolvedValueOnce(repository(artifacts))
      .mockResolvedValueOnce({ id: repositoryId, prototypes: [] })

    await expect(
      source(storage({ capture: png })).readBuildArtifacts(repositoryId),
    ).rejects.toMatchObject({ code: "taskset_drift" })
  })

  it.each([
    ["missing", "not-found" as const, png.byteLength, "artifact-missing"],
    ["storage unavailable", "unavailable" as const, png.byteLength, "artifact-unavailable"],
    ["corrupt", Uint8Array.of(1, 2, 3), 3, "artifact-corrupt"],
  ])(
    "marks a %s screenshot set incomplete instead of producing a taskset",
    async (_, result, size, issue) => {
      const artifacts = [artifact("screenshot", "screenshots/desktop.png", "capture", png)]
      artifacts[0]!.byteLength = size
      vi.mocked(listDecisionTrainingBuilds).mockResolvedValue(repository(artifacts))
      const tasksetSource = source(storage({ capture: result }))

      const buildSet = await tasksetSource.readBuildArtifacts(repositoryId)

      expect(buildSet.complete).toBe(false)
      expect(
        decodeArchive(buildSet.bytes)
          .issues.map(({ code }) => code)
          .join(" "),
      ).toContain(issue)
      await expect(
        tasksetSource.createTaskset({
          trainingExport: new TextEncoder().encode("{}"),
          builds: buildSet.bytes,
        }),
      ).rejects.toMatchObject({ code: "taskset_drift" })
      expect(runLearningCommand).not.toHaveBeenCalled()
    },
  )

  it("enforces aggregate byte bounds before taskset creation", async () => {
    const oversized = artifact("screenshot", "screenshots/desktop.png", "oversized", png)
    oversized.byteLength = 256 * 1024 * 1024 + 1
    vi.mocked(listDecisionTrainingBuilds).mockResolvedValue(repository([oversized]))
    const oversizedStorage = storage({})
    await expect(source(oversizedStorage).readBuildArtifacts(repositoryId)).rejects.toMatchObject({
      code: "taskset_drift",
    })
    expect(oversizedStorage.readMock).not.toHaveBeenCalled()
  })

  it("creates the host-neutral taskset deterministically and removes private staging on success", async () => {
    const temporaryDirectories: string[] = []
    vi.mocked(runLearningCommand).mockImplementation(async (arguments_) => {
      const output = arguments_[arguments_.indexOf("--out") + 1]!
      temporaryDirectories.push(dirname(output))
      await mkdir(join(output, "images"), { recursive: true })
      await writeFile(
        join(output, "taskset.json"),
        JSON.stringify({
          exportId: "export-1",
          scope: { repository: "team/repository" },
          provenance: {
            exportDigest: `sha256:${"a".repeat(64)}`,
            purposes: ["training"],
            grantIds: ["grant-1"],
            reviewDigests: [`sha256:${"b".repeat(64)}`],
            evidenceDigests: [`sha256:${"c".repeat(64)}`],
          },
          retention: { mode: "delete_on_withdrawal" },
          counts: { tasks: 1 },
          skipped: {},
          createdAt: arguments_[arguments_.indexOf("--created-at") + 1],
        }),
      )
      await writeFile(
        join(output, "tasks.jsonl"),
        `${JSON.stringify({ questions: { learning: { prompt: "Does it follow the rule?" } } })}\n`,
      )
      await writeFile(join(output, "images", "candidate.png"), png)
      return {}
    })
    const tasksetSource = source(storage({}))
    const trainingExport = new TextEncoder().encode(
      JSON.stringify({
        manifest: {
          id: "export-1",
          createdAt: "2026-01-05T00:00:00.000Z",
          digest: `sha256:${"a".repeat(64)}`,
          records: [],
        },
      }),
    )
    const builds = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: "replica.decision-build-set-archive/v1",
        builds: { schemaVersion: "replica.decision-builds/v1", source: {}, builds: [] },
        files: [],
        issues: [],
      }),
    )

    const first = await tasksetSource.createTaskset({ trainingExport, builds })
    const second = await tasksetSource.createTaskset({ trainingExport, builds })

    expect(first).toEqual(second)
    expect(first.tasksetDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(runLearningCommand).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining(["decision", "taskset", "--export", "--builds", "--out"]),
      expect.objectContaining({ timeoutMs: 300_000 }),
    )
    for (const directory of temporaryDirectories) {
      await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" })
    }
    expect(first.upload.schemaVersion).toBe("replica.decision-taskset-upload/v1")
    expect(first.upload.manifest).toMatchObject({
      exportId: "export-1",
      scope: { repository: "team/repository" },
      provenance: {
        exportDigest: `sha256:${"a".repeat(64)}`,
        purposes: ["training"],
        grantIds: ["grant-1"],
        reviewDigests: [`sha256:${"b".repeat(64)}`],
        evidenceDigests: [`sha256:${"c".repeat(64)}`],
      },
      retention: { mode: "delete_on_withdrawal" },
      createdAt: "2026-01-05T00:00:00.000Z",
    })
    expect(first.upload.tasks).toHaveLength(1)
    expect(first.upload.images).toHaveLength(1)
  })

  it("removes private staging when taskset creation fails", async () => {
    let temporaryDirectory = ""
    vi.mocked(runLearningCommand).mockImplementation(async (arguments_) => {
      temporaryDirectory = dirname(arguments_[arguments_.indexOf("--out") + 1]!)
      expect((await stat(temporaryDirectory)).mode & 0o777).toBe(0o700)
      throw new Error("runtime failed")
    })
    const tasksetSource = source(storage({}))
    const builds = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: "replica.decision-build-set-archive/v1",
        builds: {},
        files: [],
        issues: [],
      }),
    )

    await expect(
      tasksetSource.createTaskset({
        trainingExport: new TextEncoder().encode(
          JSON.stringify({
            manifest: {
              id: "export-1",
              createdAt: "2026-01-05T00:00:00.000Z",
              digest: `sha256:${"a".repeat(64)}`,
              records: [],
            },
          }),
        ),
        builds,
      }),
    ).rejects.toThrow("runtime failed")

    expect(temporaryDirectory).not.toBe("")
    await expect(stat(temporaryDirectory)).rejects.toMatchObject({ code: "ENOENT" })
  })
})
