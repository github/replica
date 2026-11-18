import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, opendir, readFile, rm, stat, writeFile } from "node:fs/promises"
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
import type { PreparedBuildEvaluation } from "../types.ts"

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
  })
  .loose()
const tasksetManifestSchema = z
  .object({
    counts: z.object({ tasks: z.number().int().nonnegative() }).loose(),
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
  issues: string[]
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

async function archiveDirectory(directory: string) {
  const files: { path: string; digest: string; bytes: string }[] = []
  let totalBytes = 0
  async function visit(current: string, parent = ""): Promise<void> {
    const entries = []
    const handle = await opendir(current)
    for await (const entry of handle) entries.push(entry)
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const relative = parent ? `${parent}/${entry.name}` : entry.name
      const absolute = join(current, entry.name)
      const details = await stat(absolute)
      if (details.isDirectory()) {
        await visit(absolute, relative)
      } else if (details.isFile()) {
        if (files.length >= maximumTasksetFiles) {
          throw new DecisionModelError(
            409,
            "taskset_drift",
            "The decision taskset has too many files.",
          )
        }
        const bytes = await readFile(absolute)
        totalBytes += bytes.byteLength
        if (totalBytes > maximumTasksetBytes) {
          throw new DecisionModelError(409, "taskset_drift", "The decision taskset is too large.")
        }
        files.push({ path: relative, digest: sha256(bytes), bytes: bytes.toString("base64") })
      } else {
        throw new DecisionModelError(
          409,
          "taskset_drift",
          "The decision taskset contains an unsupported file.",
        )
      }
    }
  }
  await visit(directory)
  return new TextEncoder().encode(
    canonicalJson({ schemaVersion: "replica.decision-taskset-archive/v1", files }),
  )
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
    const issues: string[] = []
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
            issues.push(`Build ${build.id} manifest is corrupt.`)
          } else {
            issues.push(`Build ${build.id} manifest is ${result.status}.`)
          }
        }
        let templates: Map<string, string>
        try {
          templates = parseTemplates(manifestBytes)
        } catch {
          templates = new Map()
          issues.push(`Build ${build.id} manifest is corrupt.`)
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
            issues.push(`Build ${build.id} has an unmapped screenshot ${artifact.path}.`)
            continue
          }
          const result = await options.artifactStorage.read(artifact.storageKey)
          if (result.status !== "ok") {
            issues.push(`Build ${build.id} screenshot ${artifact.path} is ${result.status}.`)
            continue
          }
          if (
            result.bytes.byteLength !== artifact.byteLength ||
            !validPngDimensions(result.bytes, descriptor.viewport)
          ) {
            issues.push(`Build ${build.id} screenshot ${artifact.path} is corrupt.`)
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
            issues.push(`Build ${build.id} route ${route} has incomplete screenshot coverage.`)
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
      issues: [...new Set(issues)].sort(),
    }
  }

  return {
    tasksetSource: {
      async exportTrainingEvidence({ repositoryId, actorMembershipId }) {
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
              `The Build screenshot set is incomplete: ${bundle.issues.join(" ")}`,
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
          const firstTask = JSON.parse(
            (await readFile(join(output, "tasks.jsonl"), "utf8")).split("\n")[0]!,
          ) as { questions: unknown }
          const archive = await archiveDirectory(output)
          return {
            archive,
            questionDigest: digestJson(firstTask.questions),
            tasksetDigest: sha256(archive),
          }
        } finally {
          await rm(temporary, { recursive: true, force: true })
        }
      },
    },
    async prepareBuildEvaluation({ repositoryId, buildId }) {
      const buildSet = await readBuildSet(repositoryId, buildId)
      if (buildSet.issues.length) {
        throw new DecisionModelError(
          409,
          "taskset_drift",
          `The Build screenshot set is incomplete: ${buildSet.issues.join(" ")}`,
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
      const files = new Map(buildSet.files.map((file) => [file.path, file]))
      const orderedFiles = build.screenshots.map((screenshot) => files.get(screenshot.path)!)
      return {
        state: {
          imagesNote: build.screenshots
            .map(
              (screenshot, index) =>
                `Image ${index + 1} is route ${JSON.stringify(screenshot.route)} at ${screenshot.viewport.width} by ${screenshot.viewport.height} or taller in ${screenshot.theme} theme.`,
            )
            .join(" "),
        },
        images: orderedFiles.map((file) => `data:${file.mediaType};base64,${file.bytes}`),
        questions: questions.questions,
        questionDigest: digestJson(questions.questions),
        screenshotSetDigest: digestJson({
          build,
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
