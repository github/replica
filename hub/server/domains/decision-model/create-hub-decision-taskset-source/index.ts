import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { z } from "zod"

import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { runLearningCommand } from "../../../integrations/learning/run-learning-command/index.ts"
import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types.ts"
import { createHubReviewCollection } from "../../learning/create-hub-review-collection/index.ts"
import { prepareLearningStore } from "../../learning/prepare-learning-store/index.ts"
import { captureRepositoryReviewSnapshot } from "../../review-comments/capture-repository-review-snapshot/index.ts"
import { listDecisionTrainingBuilds } from "../../../repositories/decision-training-builds/list-decision-training-builds/index.ts"
import { withLearningExecutionLock } from "../../../integrations/postgres/with-learning-execution-lock/index.ts"
import { DecisionModelError } from "../errors.ts"
import type { DecisionTasksetPreparationSource } from "../prepare-decision-taskset/index.ts"
import type {
  DecisionTrainingPreflight,
  PreparedBuildEvaluation,
  PreparedDecisionTaskset,
} from "../types.ts"

const maximumPrototypes = 200
const maximumBuildsPerPrototype = 200
const maximumScreenshots = 4_000
const maximumBuildSetBytes = 256 * 1024 * 1024
const maximumTasksetFiles = 8_100
const maximumTasksetBytes = 256 * 1024 * 1024
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const incompleteEvidenceReasons = new Set([
  "build-unknown",
  "evidence-not-exported",
  "follows-history-incomplete",
  "renderings-incomplete",
  "route-unknown",
  "screenshot-missing",
  "thread-start-unavailable",
])

const grantListSchema = z.array(
  z
    .object({
      grant: z.object({ id: z.string().min(1), sources: z.array(z.string()) }).loose(),
      activePurposes: z.array(z.string()),
      expired: z.boolean(),
    })
    .loose(),
)
const importSchema = z.object({ complete: z.boolean(), problems: z.array(z.string()) }).loose()
const exportManifestSchema = z
  .object({
    id: z.string(),
    createdAt: z.string(),
    digest: z.string(),
    records: z.array(z.unknown()),
    excluded: z
      .array(
        z
          .object({
            reason: z.string().min(1).max(100),
            count: z.number().int().positive(),
          })
          .strict(),
      )
      .default([]),
  })
  .loose()
const tasksetManifestSchema = z
  .object({
    counts: z
      .object({
        tasks: z.number().int().nonnegative(),
        train: z.number().int().nonnegative().default(0),
        dev: z.number().int().nonnegative().default(0),
        test: z.number().int().nonnegative().default(0),
        follows: z.number().int().nonnegative().default(0),
        breaks: z.number().int().nonnegative().default(0),
      })
      .loose(),
    skipped: z.record(z.string(), z.number().int().nonnegative()),
  })
  .loose()

interface HubDecisionTasksetSourceOptions {
  applicationRoot?: string
  artifactStorage: ArtifactStorage
  cliPath: string
  database: PrismaClient
  databaseUrl: string
  hubOrigin: string
  learningRoot: string
  nodePath?: string
  staticDirectories: string[]
}

interface BuildSetArchive {
  schemaVersion: "replica.decision-build-set-archive/v1"
  builds: {
    schemaVersion: "replica.decision-builds/v1"
    source: { hubOrigin: string; repositoryId: string }
    builds: {
      id: string
      prototypeId: string
      number: number
      createdAt: string
      publishedAt: string
      screenshots: {
        route: string
        size: "desktop" | "narrow"
        theme: "light" | "dark"
        viewport: { width: number; height: number }
        path: string
        digest: string
        mediaType: "image/png"
      }[]
    }[]
  }
  files: {
    path: string
    digest: string
    mediaType: "image/png"
    bytes: string
  }[]
  issues: {
    code:
      | "artifact-corrupt"
      | "artifact-missing"
      | "artifact-too-large"
      | "artifact-unavailable"
      | "artifact-unmapped"
      | "screenshot-coverage-incomplete"
  }[]
}

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error("Decision taskset data must be JSON serializable.")
  return encoded
}

function digestJson(value: unknown): string {
  return sha256(canonicalJson(value))
}

function digestUuid(digest: string): string {
  const hex = digest.slice("sha256:".length)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function stableExport(bundle: Record<string, unknown>, snapshotDigest: string) {
  const manifest = exportManifestSchema.parse(bundle.manifest)
  const stableCreatedAt = latestRecordTimestamp(bundle) ?? "1970-01-01T00:00:00.000Z"
  const stableId = `export_${sha256(`${snapshotDigest}\0${canonicalJson(manifest.records)}`).slice(
    "sha256:".length,
    "sha256:".length + 24,
  )}`
  const unsealed = {
    ...manifest,
    id: stableId,
    createdAt: stableCreatedAt,
    destination: "private-runtime-transfer",
  }
  delete (unsealed as { digest?: string }).digest
  return {
    ...bundle,
    manifest: { ...unsealed, digest: digestJson(unsealed) },
  }
}

function latestRecordTimestamp(bundle: Record<string, unknown>): string | null {
  let latest: string | null = null
  for (const list of ["grants", "collections", "episodes", "memories"]) {
    const records = bundle[list]
    if (!Array.isArray(records)) continue
    for (const record of records) {
      if (!record || typeof record !== "object") continue
      for (const field of ["updatedAt", "createdAt", "capturedAt"]) {
        const value = (record as Record<string, unknown>)[field]
        if (typeof value === "string" && (latest === null || value > latest)) latest = value
      }
      const timeline = (record as Record<string, unknown>).timeline
      if (!Array.isArray(timeline)) continue
      for (const event of timeline) {
        const at =
          event && typeof event === "object" ? (event as Record<string, unknown>).at : undefined
        if (typeof at === "string" && (latest === null || at > latest)) latest = at
      }
    }
  }
  return latest
}

function screenshotDescriptor(path: string, templates: Map<string, string>) {
  const match =
    /^screenshots\/(?:(?:templates\/([a-z0-9]+(?:-[a-z0-9]+)*)\/)?(desktop|narrow)(-dark)?\.png)$/.exec(
      path,
    )
  if (!match) return null
  const templateId = match[1]
  const route = templateId ? templates.get(templateId) : "/"
  if (!route) return null
  const size = match[2] as "desktop" | "narrow"
  return {
    route,
    size,
    theme: match[3] ? ("dark" as const) : ("light" as const),
    viewport: size === "desktop" ? { width: 1440, height: 900 } : { width: 390, height: 844 },
  }
}

function parseTemplates(bytes: Uint8Array | null): Map<string, string> {
  if (!bytes) return new Map()
  const parsed = z
    .object({
      version: z.literal(1),
      templates: z
        .array(
          z
            .object({ id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), path: z.string() })
            .loose(),
        )
        .max(12),
    })
    .loose()
    .parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)))
  return new Map(parsed.templates.map((template) => [template.id, template.path]))
}

function validPngDimensions(
  bytes: Uint8Array,
  viewport: { width: number; height: number },
): boolean {
  const buffer = Buffer.from(bytes)
  return (
    buffer.byteLength >= 24 &&
    buffer.subarray(0, 8).equals(pngSignature) &&
    buffer.subarray(12, 16).toString("ascii") === "IHDR" &&
    buffer.readUInt32BE(16) === viewport.width &&
    buffer.readUInt32BE(20) >= viewport.height
  )
}

function snapshotTime(snapshot: Awaited<ReturnType<typeof captureRepositoryReviewSnapshot>>) {
  const times = snapshot.threads.flatMap((thread) => [
    thread.createdAt,
    thread.updatedAt,
    thread.root.createdAt,
    thread.root.updatedAt,
    ...thread.replies.flatMap((reply) => [reply.createdAt, reply.updatedAt]),
    ...thread.resolutionHistory.map((event) => event.occurredAt),
  ])
  return times.length
    ? new Date(Math.max(...times.map((value) => value.getTime())))
    : new Date("1970-01-01T00:00:00.000Z")
}

async function readTasksetUpload(directory: string): Promise<PreparedDecisionTaskset["upload"]> {
  const manifest = JSON.parse(await readFile(join(directory, "taskset.json"), "utf8")) as Record<
    string,
    unknown
  >
  const tasks = (await readFile(join(directory, "tasks.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  const imageNames = (await readdir(join(directory, "images"))).sort()
  if (imageNames.length + 2 > maximumTasksetFiles) {
    throw new DecisionModelError(409, "taskset_drift", "The decision taskset has too many files.")
  }
  let totalBytes =
    Buffer.byteLength(canonicalJson(manifest)) + Buffer.byteLength(canonicalJson(tasks))
  const images = []
  for (const name of imageNames) {
    const path = `images/${name}`
    const bytes = await readFile(join(directory, path))
    totalBytes += bytes.byteLength
    if (totalBytes > maximumTasksetBytes) {
      throw new DecisionModelError(409, "taskset_drift", "The decision taskset is too large.")
    }
    images.push({
      path,
      mediaType: name.endsWith(".webp")
        ? "image/webp"
        : name.endsWith(".jpg") || name.endsWith(".jpeg")
          ? "image/jpeg"
          : "image/png",
      digest: sha256(bytes),
      dataBase64: bytes.toString("base64"),
    })
  }
  return {
    schemaVersion: "replica.decision-taskset-upload/v1",
    manifest,
    tasks,
    images,
  }
}

function buildSelection(
  repository: NonNullable<Awaited<ReturnType<typeof listDecisionTrainingBuilds>>>,
) {
  return repository.prototypes.map((prototype) => ({
    id: prototype.id,
    builds: prototype.builds.map((build) => ({
      id: build.id,
      number: build.number,
      createdAt: build.createdAt.toISOString(),
      workflowCreatedAt: build.workflowCreatedAt?.toISOString() ?? null,
      finishedAt: build.finishedAt?.toISOString() ?? null,
      artifacts: build.artifacts,
    })),
  }))
}

export function createHubDecisionTasksetSource(options: HubDecisionTasksetSourceOptions): {
  tasksetSource: DecisionTasksetPreparationSource
  prepareBuildEvaluation(input: {
    repositoryId: string
    buildId: string
  }): Promise<PreparedBuildEvaluation>
} {
  const applicationRoot = options.applicationRoot ?? process.cwd()

  async function command(arguments_: string[], timeoutMs = 60_000, signal?: AbortSignal) {
    return runLearningCommand(arguments_, {
      cliPath: options.cliPath,
      nodePath: options.nodePath,
      signal,
      timeoutMs,
    })
  }

  async function learningStore(repositoryId: string) {
    return prepareLearningStore({
      applicationRoot,
      repositoryKey: repositoryId,
      repositoryScope: `github.com/repositories/${repositoryId}`,
      root: options.learningRoot,
      staticDirectories: options.staticDirectories,
    })
  }

  async function readBuildSet(
    repositoryId: string,
    onlyBuildId?: string,
  ): Promise<BuildSetArchive> {
    const repository = await listDecisionTrainingBuilds(options.database, repositoryId, {
      prototypes: maximumPrototypes,
      buildsPerPrototype: maximumBuildsPerPrototype,
    })
    if (!repository) {
      throw new DecisionModelError(404, "repository_not_found", "Repository not found.")
    }
    if (repository.prototypes.length > maximumPrototypes) {
      throw new DecisionModelError(
        409,
        "taskset_drift",
        "The repository has too many reviewed prototypes.",
      )
    }
    const files: BuildSetArchive["files"] = []
    const issues: BuildSetArchive["issues"] = []
    const builds = []
    let totalBytes = 0
    for (const prototype of repository.prototypes) {
      if (prototype.builds.length > maximumBuildsPerPrototype) {
        throw new DecisionModelError(
          409,
          "taskset_drift",
          "A prototype has too many published Builds.",
        )
      }
      const ordered = [...prototype.builds].sort(
        (left, right) =>
          (left.workflowCreatedAt ?? left.createdAt).getTime() -
            (right.workflowCreatedAt ?? right.createdAt).getTime() || left.number - right.number,
      )
      for (const build of ordered) {
        if (onlyBuildId && build.id !== onlyBuildId) continue
        const artifacts = [...build.artifacts].sort(
          (left, right) =>
            left.path.localeCompare(right.path) || left.storageKey.localeCompare(right.storageKey),
        )
        const manifest = artifacts.find((artifact) => artifact.kind === "manifest")
        let manifestBytes: Uint8Array | null = null
        if (manifest) {
          const result = await options.artifactStorage.read(manifest.storageKey)
          if (result.status === "ok" && result.bytes.byteLength === manifest.byteLength) {
            manifestBytes = result.bytes
          } else if (result.status === "ok") {
            issues.push({ code: "artifact-corrupt" })
          } else {
            issues.push({
              code:
                result.status === "not-found"
                  ? "artifact-missing"
                  : result.status === "too-large"
                    ? "artifact-too-large"
                    : "artifact-unavailable",
            })
          }
        }
        let templates: Map<string, string>
        try {
          templates = parseTemplates(manifestBytes)
        } catch {
          templates = new Map()
          issues.push({ code: "artifact-corrupt" })
        }
        const screenshots = []
        for (const artifact of artifacts.filter((item) => item.kind === "screenshot")) {
          if (files.length >= maximumScreenshots) {
            throw new DecisionModelError(
              409,
              "taskset_drift",
              "The Build set has too many screenshots.",
            )
          }
          if (artifact.byteLength > 32 * 1024 * 1024) {
            throw new DecisionModelError(
              409,
              "taskset_drift",
              "A Build screenshot exceeds the artifact size limit.",
            )
          }
          if (totalBytes + artifact.byteLength > maximumBuildSetBytes) {
            throw new DecisionModelError(
              409,
              "taskset_drift",
              "The Build screenshot set is too large.",
            )
          }
          const descriptor = screenshotDescriptor(artifact.path, templates)
          if (!descriptor) {
            issues.push({ code: "artifact-unmapped" })
            continue
          }
          const result = await options.artifactStorage.read(artifact.storageKey)
          if (result.status !== "ok") {
            issues.push({
              code:
                result.status === "not-found"
                  ? "artifact-missing"
                  : result.status === "too-large"
                    ? "artifact-too-large"
                    : "artifact-unavailable",
            })
            continue
          }
          if (
            result.bytes.byteLength !== artifact.byteLength ||
            !validPngDimensions(result.bytes, descriptor.viewport)
          ) {
            issues.push({ code: "artifact-corrupt" })
            continue
          }
          totalBytes += result.bytes.byteLength
          if (totalBytes > maximumBuildSetBytes) {
            throw new DecisionModelError(
              409,
              "taskset_drift",
              "The Build screenshot set is too large.",
            )
          }
          const imagePath = `images/${prototype.id}/${build.number}/${files.length}.png`
          const digest = sha256(result.bytes)
          files.push({
            path: imagePath,
            digest,
            mediaType: "image/png",
            bytes: Buffer.from(result.bytes).toString("base64"),
          })
          screenshots.push({
            ...descriptor,
            path: imagePath,
            digest,
            mediaType: "image/png" as const,
          })
        }
        screenshots.sort(
          (left, right) =>
            (left.route === right.route
              ? 0
              : left.route === "/"
                ? -1
                : right.route === "/"
                  ? 1
                  : left.route.localeCompare(right.route)) ||
            (left.size === right.size ? 0 : left.size === "desktop" ? -1 : 1) ||
            (left.theme === right.theme ? 0 : left.theme === "light" ? -1 : 1),
        )
        const routes = ["/", ...templates.values()]
        for (const route of routes) {
          const routeScreenshots = screenshots.filter((screenshot) => screenshot.route === route)
          if (
            routeScreenshots.length !== 4 ||
            new Set(routeScreenshots.map((screenshot) => `${screenshot.size}/${screenshot.theme}`))
              .size !== 4
          ) {
            issues.push({ code: "screenshot-coverage-incomplete" })
          }
        }
        builds.push({
          id: build.id,
          prototypeId: prototype.id,
          number: build.number,
          createdAt: (build.workflowCreatedAt ?? build.createdAt).toISOString(),
          publishedAt: build.finishedAt!.toISOString(),
          screenshots,
        })
      }
    }
    if (onlyBuildId && builds.length !== 1) {
      throw new DecisionModelError(404, "build_not_found", "Published Build not found.")
    }
    const currentRepository = await listDecisionTrainingBuilds(options.database, repositoryId, {
      prototypes: maximumPrototypes,
      buildsPerPrototype: maximumBuildsPerPrototype,
    })
    if (
      !currentRepository ||
      digestJson(buildSelection(repository)) !== digestJson(buildSelection(currentRepository))
    ) {
      throw new DecisionModelError(
        409,
        "taskset_drift",
        "Repository Build eligibility changed during taskset preparation.",
      )
    }
    return {
      schemaVersion: "replica.decision-build-set-archive/v1",
      builds: {
        schemaVersion: "replica.decision-builds/v1",
        source: { hubOrigin: options.hubOrigin, repositoryId },
        builds,
      },
      files,
      issues: issues.sort(({ code: left }, { code: right }) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    }
  }

  function buildCoverage(bundle: BuildSetArchive) {
    const prototypes = new Set(bundle.builds.builds.map((build) => build.prototypeId))
    const pages = new Set(
      bundle.builds.builds.flatMap((build) =>
        build.screenshots.map((screenshot) => `${build.id}\0${screenshot.route}`),
      ),
    )
    return {
      prototypes: prototypes.size,
      builds: bundle.builds.builds.length,
      pages: pages.size,
      screenshots: bundle.files.length,
    }
  }

  function reasonCounts(codes: string[]) {
    const counts = new Map<string, number>()
    for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1)
    return [...counts]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([code, count]) => ({ code, count }))
  }

  function exportReasons(bytes: Uint8Array) {
    if (!bytes.byteLength) return []
    const bundle = z
      .object({ manifest: exportManifestSchema })
      .loose()
      .parse(JSON.parse(new TextDecoder().decode(bytes)))
    return bundle.manifest.excluded.flatMap(({ reason, count }) =>
      Array.from({ length: count }, () => reason),
    )
  }

  function readPreparedTaskset(upload: PreparedDecisionTaskset["upload"]) {
    const manifest = tasksetManifestSchema.parse(upload.manifest)
    const firstTask = upload.tasks[0] as { questions?: Record<string, unknown> } | undefined
    return { manifest, questions: firstTask?.questions ?? {} }
  }

  let tasksetSource: DecisionTasksetPreparationSource
  return {
    tasksetSource: (tasksetSource = {
      async preflight({ repositoryId, actorMembershipId }): Promise<DecisionTrainingPreflight> {
        const [trainingExport, buildArtifacts] = await Promise.all([
          tasksetSource.exportTrainingEvidence({
            repositoryId,
            actorMembershipId,
            preview: true,
          }),
          tasksetSource.readBuildArtifacts(repositoryId),
        ])
        const buildBundle = JSON.parse(
          new TextDecoder().decode(buildArtifacts.bytes),
        ) as BuildSetArchive
        const coverage = buildCoverage(buildBundle)
        const reasons = [
          ...(trainingExport.consentGrantId ? [] : ["consent-withheld"]),
          ...exportReasons(trainingExport.bytes),
          ...buildBundle.issues.map(({ code }) => code),
        ]
        const emptyCounts = {
          ...coverage,
          questions: 0,
          samples: 0,
          tasks: 0,
          train: 0,
          dev: 0,
          test: 0,
          follows: 0,
          breaks: 0,
        }
        if (!trainingExport.consentGrantId || !buildArtifacts.complete) {
          const counted = reasonCounts(reasons)
          return {
            state: "blocked",
            counts: emptyCounts,
            warnings: counted.map(({ code, count }) => ({ code, count, message: code })),
            reasons: counted,
            digests: {
              export: trainingExport.consentGrantId ? trainingExport.digest : null,
              reviewSnapshot: trainingExport.repeatableReviewSnapshotDigest,
              buildSet: buildArtifacts.digest,
              questionSet: null,
              taskset: null,
            },
          }
        }
        try {
          const taskset = await tasksetSource.createTaskset({
            trainingExport: trainingExport.bytes,
            builds: buildArtifacts.bytes,
          })
          const prepared = readPreparedTaskset(taskset.upload)
          const skipped = [
            ...reasons,
            ...Object.entries(prepared.manifest.skipped).flatMap(([code, count]) =>
              Array.from({ length: count }, () => code),
            ),
          ]
          const counted = reasonCounts(skipped)
          return {
            state: skipped.some((code) => incompleteEvidenceReasons.has(code))
              ? "blocked"
              : "ready",
            counts: {
              ...coverage,
              questions: Object.keys(prepared.questions).length,
              samples: prepared.manifest.counts.tasks,
              ...prepared.manifest.counts,
            },
            warnings: counted.map(({ code, count }) => ({ code, count, message: code })),
            reasons: counted,
            digests: {
              export: trainingExport.digest,
              reviewSnapshot: trainingExport.repeatableReviewSnapshotDigest,
              buildSet: buildArtifacts.digest,
              questionSet: taskset.questionDigest,
              taskset: taskset.tasksetDigest,
            },
          }
        } catch (error) {
          if (!(error instanceof DecisionModelError) || error.code !== "taskset_drift") throw error
          const counted = reasonCounts([...reasons, "evidence-incomplete"])
          return {
            state: "blocked",
            counts: emptyCounts,
            warnings: counted.map(({ code, count }) => ({ code, count, message: code })),
            reasons: counted,
            digests: {
              export: trainingExport.digest,
              reviewSnapshot: trainingExport.repeatableReviewSnapshotDigest,
              buildSet: buildArtifacts.digest,
              questionSet: null,
              taskset: null,
            },
          }
        }
      },
      async exportTrainingEvidence({ repositoryId, actorMembershipId, preview = false }) {
        return withLearningExecutionLock({
          databaseUrl: options.databaseUrl,
          run: async (signal) => {
            const store = await learningStore(repositoryId)
            const common = ["--dir", store.directory, "--repository", store.repositoryScope]
            const grants = grantListSchema.parse(
              await command(["grants", "list", ...common], 60_000, signal),
            )
            const grantIds = grants
              .filter(
                ({ grant, activePurposes, expired }) =>
                  !expired &&
                  activePurposes.includes("training") &&
                  grant.sources.includes("hub_review_comments"),
              )
              .map(({ grant }) => grant.id)
              .sort()
            const snapshot = await captureRepositoryReviewSnapshot(
              options.database,
              repositoryId,
              new Date(),
            )
            const capturedAt = snapshotTime(snapshot)
            snapshot.capturedAt = capturedAt
            const initialReview = createHubReviewCollection(snapshot, options.hubOrigin)
            snapshot.snapshotId = digestUuid(initialReview.digest)
            const review = createHubReviewCollection(snapshot, options.hubOrigin)
            if (!grantIds.length) {
              return {
                bytes: new Uint8Array(),
                consentGrantId: null,
                digest: sha256(new Uint8Array()),
                repeatableReviewSnapshotDigest: review.digest,
              }
            }
            const temporary = await mkdtemp(join(tmpdir(), "replica-decision-export-"))
            await chmod(temporary, 0o700)
            try {
              signal.throwIfAborted()
              const collectionPath = join(temporary, "review.json")
              await writeFile(collectionPath, JSON.stringify(review.collection), { mode: 0o600 })
              const imported = importSchema.parse(
                await command(
                  [
                    "import",
                    "hub-comments",
                    collectionPath,
                    ...grantIds.flatMap((grantId) => ["--grant", grantId]),
                    "--actor",
                    "system:replica-hub",
                    "--redact-deleted",
                    ...common,
                  ],
                  60_000,
                  signal,
                ),
              )
              if (!imported.complete) {
                throw new DecisionModelError(
                  409,
                  "taskset_drift",
                  `The review evidence snapshot is incomplete: ${imported.problems.join(" ")}`,
                )
              }
              const exportPath = join(temporary, "training-export.json")
              await command(
                [
                  "export",
                  "--purpose",
                  "training",
                  "--by",
                  `human:${actorMembershipId}`,
                  ...(preview ? ["--preview"] : []),
                  "--out",
                  exportPath,
                  ...common,
                ],
                60_000,
                signal,
              )
              const bundle = JSON.parse(await readFile(exportPath, "utf8")) as Record<
                string,
                unknown
              >
              const stable = stableExport(bundle, review.digest)
              const bytes = new TextEncoder().encode(canonicalJson(stable))
              return {
                bytes,
                consentGrantId: grantIds[0]!,
                digest: sha256(bytes),
                repeatableReviewSnapshotDigest: review.digest,
              }
            } finally {
              await rm(temporary, { recursive: true, force: true })
            }
          },
        })
      },
      async readBuildArtifacts(repositoryId) {
        const archive = await readBuildSet(repositoryId)
        const bytes = new TextEncoder().encode(canonicalJson(archive))
        return { bytes, digest: sha256(bytes), complete: archive.issues.length === 0 }
      },
      async createTaskset({ trainingExport, builds }) {
        const temporary = await mkdtemp(join(tmpdir(), "replica-decision-taskset-"))
        await chmod(temporary, 0o700)
        try {
          const bundle = JSON.parse(new TextDecoder().decode(builds)) as BuildSetArchive
          if (bundle.issues.length) {
            throw new DecisionModelError(
              409,
              "taskset_drift",
              `The Build screenshot set is incomplete: ${bundle.issues
                .map(({ code }) => code)
                .join(", ")}.`,
            )
          }
          const exportPath = join(temporary, "training-export.json")
          const buildsPath = join(temporary, "builds.json")
          const output = join(temporary, "taskset")
          await writeFile(exportPath, trainingExport, { mode: 0o600 })
          for (const file of bundle.files) {
            const destination = resolve(temporary, file.path)
            if (!destination.startsWith(`${temporary}/`)) {
              throw new DecisionModelError(409, "taskset_drift", "A screenshot path is invalid.")
            }
            await mkdir(resolve(destination, ".."), { recursive: true, mode: 0o700 })
            const bytes = Buffer.from(file.bytes, "base64")
            if (sha256(bytes) !== file.digest) {
              throw new DecisionModelError(
                409,
                "taskset_drift",
                "A staged screenshot failed its digest check.",
              )
            }
            await writeFile(destination, bytes, { mode: 0o600 })
          }
          await writeFile(buildsPath, canonicalJson(bundle.builds), { mode: 0o600 })
          await command(
            [
              "decision",
              "taskset",
              "--export",
              exportPath,
              "--builds",
              buildsPath,
              "--out",
              output,
            ],
            5 * 60_000,
          )
          const tasksetPath = join(output, "taskset.json")
          const tasksetManifest = tasksetManifestSchema.parse(
            JSON.parse(await readFile(tasksetPath, "utf8")),
          )
          if (!tasksetManifest.counts.tasks) {
            throw new DecisionModelError(
              409,
              "taskset_drift",
              "The review evidence did not produce any decision tasks.",
            )
          }
          const incompleteEvidence = Object.entries(tasksetManifest.skipped).filter(
            ([reason, count]) => count > 0 && incompleteEvidenceReasons.has(reason),
          )
          if (incompleteEvidence.length) {
            throw new DecisionModelError(
              409,
              "taskset_drift",
              `The review evidence is incomplete: ${incompleteEvidence
                .map(([reason, count]) => `${count} ${reason}`)
                .join(", ")}.`,
            )
          }
          const normalized = {
            ...tasksetManifest,
            createdAt: exportManifestSchema.parse(
              (JSON.parse(new TextDecoder().decode(trainingExport)) as Record<string, unknown>)
                .manifest,
            ).createdAt,
          }
          await writeFile(tasksetPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 })
          const upload = await readTasksetUpload(output)
          const firstTask = upload.tasks[0] as { questions?: unknown } | undefined
          return {
            upload,
            questionDigest: digestJson(firstTask?.questions ?? {}),
            tasksetDigest: digestJson(upload),
          }
        } finally {
          await rm(temporary, { recursive: true, force: true })
        }
      },
    }),
    async prepareBuildEvaluation({ repositoryId, buildId }) {
      const buildSet = await readBuildSet(repositoryId, buildId)
      if (buildSet.issues.length) {
        throw new DecisionModelError(
          409,
          "taskset_drift",
          `The Build screenshot set is incomplete: ${buildSet.issues
            .map(({ code }) => code)
            .join(", ")}.`,
        )
      }
      const store = await learningStore(repositoryId)
      const questions = (await command([
        "decision",
        "questions",
        "--by",
        "human:replica-hub-decision-evaluation",
        "--preview",
        "--dir",
        store.directory,
        "--repository",
        store.repositoryScope,
      ])) as { questions: Record<string, unknown> }
      const build = buildSet.builds.builds[0]!
      const route = build.screenshots.some((screenshot) => screenshot.route === "/")
        ? "/"
        : build.screenshots[0]!.route
      const screenshots = build.screenshots.filter((screenshot) => screenshot.route === route)
      const files = new Map(buildSet.files.map((file) => [file.path, file]))
      const orderedFiles = screenshots.map((screenshot) => files.get(screenshot.path)!)
      return {
        state: {
          imagesNote: screenshots
            .map(
              (screenshot, index) =>
                `Image ${index + 1} is route ${JSON.stringify(screenshot.route)} at ${screenshot.viewport.width} by ${screenshot.viewport.height} or taller in ${screenshot.theme} theme.`,
            )
            .join(" "),
        },
        images: orderedFiles.map((file) => `data:${file.mediaType};base64,${file.bytes}`),
        questions: questions.questions,
        route,
        views: screenshots.map(({ size, theme }) => ({ viewport: size, theme })),
        questionDigest: digestJson(questions.questions),
        screenshotSetDigest: digestJson({
          build: { ...build, screenshots },
          files: orderedFiles.map(({ path, digest, mediaType }) => ({
            path,
            digest,
            mediaType,
          })),
        }),
      }
    },
  }
}
