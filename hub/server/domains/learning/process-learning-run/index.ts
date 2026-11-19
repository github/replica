import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { z } from "zod"

import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"

const grantListSchema = z.array(
  z
    .object({
      grant: z
        .object({
          id: z.string().min(1),
          sources: z.array(z.string()),
          grantedBy: z.object({ kind: z.string(), id: z.string().min(1) }).loose(),
        })
        .loose(),
      activePurposes: z.array(z.string()),
      expired: z.boolean(),
    })
    .loose(),
)
const addedGrantSchema = z.object({ id: z.string().min(1) }).loose()
const importSchema = z
  .object({
    complete: z.boolean(),
    problems: z.array(z.string()),
  })
  .loose()
const labelSchema = z
  .object({
    considered: z.number().int().nonnegative(),
    labeled: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    usage: z
      .object({
        requests: z.number().int().nonnegative(),
        nanoAiu: z.number().int().nonnegative(),
      })
      .loose(),
  })
  .loose()
const consolidateSchema = z
  .object({
    status: z.string(),
    proposals: z.array(z.object({ updatedAt: z.string().optional() }).loose()),
    overBudget: z.number().int().nonnegative().optional(),
  })
  .loose()

function credits(nanoAiu: number) {
  const padded = nanoAiu.toString().padStart(10, "0")
  return `${padded.slice(0, -9)}.${padded.slice(-9)}`.replace(/\.?0+$/, "") || "0"
}

export async function processLearningRun(
  runId: string,
  dependencies: {
    expectedScheduled: boolean
    claim(runId: string, startedAt: Date, scheduled: boolean): Promise<boolean>
    capture(repositoryId: string): Promise<{
      collection: unknown
      digest: string
      capturedAt: Date
      reviewActivitySnapshot: Record<string, number>
    }>
    finish(
      runId: string,
      input:
        | {
            state: "SUCCEEDED"
            suggestions: number
            suggestionsRemaining: number
            finishedAt: Date
          }
        | {
            state: "FAILED"
            failureCode: string
            failureSummary: string
            finishedAt: Date
          },
    ): Promise<unknown>
    getRun(runId: string): Promise<{
      id: string
      repositoryId: string
      snapshotDigest: string
      startedAt: Date | null
      state: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED"
      scheduled: boolean
      requestedBy: { profile: { login: string | null } | null } | null
      requestedByMembershipId: string | null
    } | null>
    now(): Date
    hasPendingUserRun(): Promise<boolean>
    isRepositoryAvailable(repositoryId: string): Promise<boolean>
    prepare(repositoryId: string): Promise<{ directory: string; repositoryScope: string }>
    authorizeRepositoryAdministration(membershipId: string, repositoryId: string): Promise<boolean>
    refuseCredential?(): Promise<void>
    runCommand(
      arguments_: string[],
      options?: { githubToken?: string; timeoutMs?: number; signal?: AbortSignal },
    ): Promise<unknown>
    credential(): Promise<{ githubToken?: string } | null>
    updateProgress(
      runId: string,
      input: {
        commentsConsidered: number
        commentsLabeled: number
        commentsRemaining: number
        copilotRequests: number
        aiCredits: string
      },
    ): Promise<unknown>
    withLock<T>(
      run: (
        signal: AbortSignal,
        controls: {
          runWithoutRepositoryAuthorityLock: <Result>(
            operation: () => Promise<Result>,
          ) => Promise<Result>
        },
      ) => Promise<T>,
    ): Promise<T>
  },
) {
  const run = await dependencies.getRun(runId)
  if (!run || !["QUEUED", "RUNNING"].includes(run.state)) return
  if (run.scheduled !== dependencies.expectedScheduled) return
  function authorizeRepositoryAdministration(membershipId: string, repositoryId: string) {
    return runWithBoundedRetries(
      () => dependencies.authorizeRepositoryAdministration(membershipId, repositoryId),
      (error) => classifyPrismaTransactionError(error) === "retryable",
    )
  }
  try {
    await dependencies.withLock(async (signal, { runWithoutRepositoryAuthorityLock }) => {
      if (dependencies.expectedScheduled && (await dependencies.hasPendingUserRun())) {
        throw new Error("User-requested learning work is waiting.")
      }
      if (
        run.state === "QUEUED" &&
        !(await dependencies.claim(runId, dependencies.now(), dependencies.expectedScheduled))
      ) {
        return
      }
      const current = await dependencies.getRun(runId)
      if (!current) throw new Error("The claimed learning run disappeared.")
      if (current.state !== "RUNNING") return
      let actor: string | null = null
      if (!current.scheduled) {
        const requester = current.requestedBy?.profile?.login
        if (
          !requester ||
          !current.requestedByMembershipId ||
          !(await authorizeRepositoryAdministration(
            current.requestedByMembershipId,
            current.repositoryId,
          ))
        ) {
          throw new LearningCommandError(
            "not_authorized",
            "The person who requested this run is no longer a repository administrator.",
          )
        }
        actor = `human:${requester}`
      }
      const snapshot = await dependencies.capture(current.repositoryId)
      if (snapshot.digest !== current.snapshotDigest) {
        throw new LearningCommandError(
          "snapshot_changed",
          "Repository review comments changed before this learning run started. Request another run.",
        )
      }
      const store = await dependencies.prepare(current.repositoryId)
      const common = ["--dir", store.directory, "--repository", store.repositoryScope]
      const grants = grantListSchema.parse(
        await dependencies.runCommand(["grants", "list", ...common], { signal }),
      )
      const sourceGrants = grants.filter((entry) =>
        entry.grant.sources.includes("hub_review_comments"),
      )
      const humanSourceGrants = sourceGrants.filter(
        (entry) => entry.grant.grantedBy.kind === "human",
      )
      let grantIds = humanSourceGrants
        .filter(
          (entry) =>
            !entry.expired &&
            entry.activePurposes.includes("review") &&
            entry.activePurposes.includes("instruction"),
        )
        .map((entry) => entry.grant.id)
      if (grantIds.length === 0) {
        if (humanSourceGrants.length > 0) {
          throw new LearningCommandError(
            "grant_inactive",
            "Consent to use this repository's review comments ended.",
          )
        }
        if (current.scheduled) {
          throw new LearningCommandError(
            "grant_required",
            "A repository administrator must request the first learning run.",
          )
        }
        const grant = addedGrantSchema.parse(
          await dependencies.runCommand(
            [
              "grants",
              "add",
              "--purpose",
              "review",
              "--purpose",
              "instruction",
              "--source",
              "hub_review_comments",
              "--basis",
              "A repository administrator explicitly requested this learning run.",
              "--by",
              actor!,
              ...common,
            ],
            { signal },
          ),
        )
        grantIds = [grant.id]
      }

      const temporary = await mkdtemp(resolve(tmpdir(), "replica-learning-run-"))
      try {
        const collectionPath = resolve(temporary, "review-collection.json")
        await writeFile(collectionPath, JSON.stringify(snapshot.collection), { mode: 0o600 })
        const imported = importSchema.parse(
          await dependencies.runCommand(
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
            { signal },
          ),
        )
        if (!imported.complete) {
          throw new LearningCommandError(
            "incomplete_collection",
            `The repository review snapshot is incomplete: ${imported.problems.join(" ")}`,
          )
        }
      } finally {
        await rm(temporary, { recursive: true })
      }

      const credential = await dependencies.credential()
      if (!credential) {
        throw new LearningCommandError("copilot_not_connected", "Copilot is not connected.")
      }
      let labeled: z.infer<typeof labelSchema>
      try {
        labeled = labelSchema.parse(
          await runWithoutRepositoryAuthorityLock(() =>
            dependencies.runCommand(
              [
                "label",
                "--since",
                new Date(snapshot.capturedAt.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(),
                "--limit",
                "400",
                "--max-requests",
                "10",
                ...common,
              ],
              { ...credential, signal, timeoutMs: 30 * 60 * 1000 },
            ),
          ),
        )
      } catch (error) {
        if (error instanceof LearningCommandError && error.result) {
          const partial = labelSchema.safeParse(error.result)
          if (partial.success) {
            await dependencies.updateProgress(runId, {
              commentsConsidered: partial.data.considered,
              commentsLabeled: partial.data.labeled,
              commentsRemaining: partial.data.remaining,
              copilotRequests: partial.data.usage.requests,
              aiCredits: credits(partial.data.usage.nanoAiu),
            })
          }
        }
        throw error
      }
      await dependencies.updateProgress(runId, {
        commentsConsidered: labeled.considered,
        commentsLabeled: labeled.labeled,
        commentsRemaining: labeled.remaining,
        copilotRequests: labeled.usage.requests,
        aiCredits: credits(labeled.usage.nanoAiu),
      })
      if (
        current.scheduled
          ? !(await dependencies.isRepositoryAvailable(current.repositoryId))
          : !current.requestedByMembershipId ||
            !(await authorizeRepositoryAdministration(
              current.requestedByMembershipId,
              current.repositoryId,
            ))
      ) {
        throw new LearningCommandError(
          "not_authorized",
          current.scheduled
            ? "The repository is no longer available for automatic learning."
            : "The person who requested this run is no longer a repository administrator.",
        )
      }
      const consolidated = consolidateSchema.parse(
        await dependencies.runCommand(
          [
            "consolidate",
            "--from",
            new Date(snapshot.capturedAt.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(),
            "--to",
            snapshot.capturedAt.toISOString(),
            "--actor",
            "system:replica-hub",
            "--max",
            "10",
            ...common,
          ],
          { signal },
        ),
      )
      if (consolidated.status !== "complete") {
        throw new LearningCommandError(
          "incomplete_collection",
          "The learning store did not collect the complete review window.",
        )
      }
      await dependencies.finish(runId, {
        state: "SUCCEEDED",
        suggestions: consolidated.proposals.filter((proposal) => {
          if (!proposal.updatedAt || !current.startedAt) return false
          const updatedAt = Date.parse(proposal.updatedAt)
          return Number.isFinite(updatedAt) && updatedAt >= current.startedAt.getTime()
        }).length,
        suggestionsRemaining: consolidated.overBudget ?? 0,
        finishedAt: dependencies.now(),
      })
    })
  } catch (error) {
    if (
      error instanceof Error &&
      [
        "Another learning operation is still running.",
        "User-requested learning work is waiting.",
      ].includes(error.message)
    ) {
      return "deferred" as const
    }
    const current = await dependencies.getRun(runId)
    if (current?.state === "QUEUED") throw error
    if (
      error instanceof LearningCommandError &&
      ["unauthorized", "installation_revoked", "permission_denied"].includes(error.code)
    ) {
      await dependencies.refuseCredential?.()
    }
    const code = error instanceof LearningCommandError ? error.code : "failed"
    const message =
      error instanceof LearningCommandError ? error.message : "Hub could not finish this run."
    await dependencies.finish(runId, {
      state: "FAILED",
      failureCode: code.slice(0, 60),
      failureSummary: message.slice(0, 1_000),
      finishedAt: dependencies.now(),
    })
  }
}
