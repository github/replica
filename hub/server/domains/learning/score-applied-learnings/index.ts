import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { z } from "zod"

import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { formatAiCredits } from "../../../utils/format-ai-credits/index.ts"

const screenshotSchema = z.object({ sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).loose()
const usageSchema = z
  .object({
    reports: z.array(
      z
        .object({
          used: z.array(
            z
              .object({
                // The ID is passed to the package as an argument, so it must never
                // read as an option.
                id: z
                  .string()
                  .min(1)
                  .max(255)
                  .refine((id) => !id.startsWith("-")),
                before: screenshotSchema.optional(),
                after: screenshotSchema.optional(),
              })
              .loose(),
          ),
        })
        .loose(),
    ),
  })
  .loose()
const spentSchema = z
  .object({
    usage: z
      .object({
        requests: z.number().int().nonnegative(),
        nanoAiu: z.number().int().nonnegative(),
      })
      .loose(),
  })
  .loose()
const refusedCodes = ["unauthorized", "installation_revoked", "permission_denied"]
const scoredSchema = spentSchema.extend({
  score: z.object({ id: z.string().min(1).max(255) }).loose(),
})

/**
 * Scores each learning agents said they applied in one built commit, one Copilot call at a
 * time, while the shared monthly budget lasts. Each attempt is recorded with what it cost,
 * even when it fails, so spending is never undercounted. Returns "paused" when Copilot or
 * the budget is unavailable, so the request is kept and tried again later, and "deferred"
 * when a person is waiting on a learning run, which goes first.
 */
export async function scoreAppliedLearnings(dependencies: {
  commitSha: string
  credential(): Promise<{ githubToken?: string } | null>
  deleteRequest(): Promise<unknown>
  finish(
    runId: string,
    input: { aiCredits: string; copilotRequests: number; finishedAt: Date } & (
      { state: "SUCCEEDED"; scoreId: string } | { state: "FAILED"; failureCode: string }
    ),
  ): Promise<unknown>
  hasPendingUserRun(): Promise<boolean>
  isEnabled(): Promise<boolean>
  now(): Date
  prepare(): Promise<string[]>
  readDiff(): Promise<string | null>
  readScreenshot(sha256: string): Promise<Uint8Array | null>
  refuseCredential(): Promise<unknown>
  runCommand(
    arguments_: string[],
    options: { githubToken?: string; signal: AbortSignal; timeoutMs?: number },
  ): Promise<unknown>
  start(usedLearningId: string): Promise<{ id: string; operationId: string; state: string }>
  withinBudget(): Promise<boolean>
  withLock<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>
}): Promise<"done" | "deferred" | "paused"> {
  // Turning evaluations off means nothing more is scored, so the request is dropped.
  if (!(await dependencies.isEnabled())) {
    await dependencies.deleteRequest()
    return "done"
  }
  if (!(await dependencies.withinBudget())) return "paused"
  const store = await dependencies.prepare()
  const { reports } = usageSchema.parse(
    await dependencies.withLock((signal) =>
      dependencies.runCommand(["usage", "--commit", dependencies.commitSha, ...store], {
        signal,
      }),
    ),
  )
  const temporary = await mkdtemp(resolve(tmpdir(), "replica-learning-score-"))
  try {
    let diffFile: string | null | undefined
    for (const [index, used] of reports.flatMap((report) => report.used).entries()) {
      const run = await dependencies.start(used.id)
      if (run.state !== "RUNNING") continue
      if (diffFile === undefined) {
        const diff = await dependencies.readDiff()
        diffFile = diff === null ? null : resolve(temporary, "commit.diff")
        if (diffFile) await writeFile(diffFile, diff!, { mode: 0o600 })
      }
      // A hosted store keeps no screenshot bytes, so Hub hands over the ones whose
      // consent still holds as files named by their digest.
      const screenshots = resolve(temporary, `screenshots-${index}`)
      let hasScreenshots = false
      for (const shot of [used.before, used.after]) {
        if (!shot) continue
        // Hub stores the digest without its "sha256:" label.
        const digest = shot.sha256.slice(7)
        const bytes = await dependencies.readScreenshot(digest)
        if (!bytes) continue
        await mkdir(screenshots, { recursive: true, mode: 0o700 })
        await writeFile(resolve(screenshots, `${digest}.png`), bytes, { mode: 0o600 })
        hasScreenshots = true
      }
      const outcome = await dependencies.withLock(async (signal) => {
        // Checked under the lock before each paid call, so turning evaluations off or
        // removing the repository stops scoring, and two jobs can't both spend the last
        // of the budget.
        if (await dependencies.hasPendingUserRun()) return "deferred"
        if (!(await dependencies.isEnabled())) return "disabled"
        if (!(await dependencies.withinBudget())) return "paused"
        try {
          // Installation tokens expire within an hour, so each score asks for a fresh one.
          const credential = await dependencies.credential()
          if (!credential) return "paused"
          const scored = scoredSchema.parse(
            await dependencies.runCommand(
              [
                "score",
                used.id,
                "--operation-id",
                run.operationId,
                ...(diffFile ? ["--diff-file", diffFile] : []),
                ...(hasScreenshots ? ["--screenshots", screenshots] : []),
                ...store,
              ],
              { ...credential, signal, timeoutMs: 10 * 60 * 1000 },
            ),
          )
          await dependencies.finish(run.id, {
            state: "SUCCEEDED",
            scoreId: scored.score.id,
            aiCredits: formatAiCredits(scored.usage.nanoAiu),
            copilotRequests: scored.usage.requests,
            finishedAt: dependencies.now(),
          })
          return "scored"
        } catch (error) {
          // An interrupted score stays running, so the next pass retries it with the same
          // operation ID and the store doesn't charge twice for a score it already saved.
          if (!(error instanceof LearningCommandError) || error.code === "cancelled") throw error
          // Copilot being down or refusing the credential says nothing about the learning,
          // so the score stays running and the rest of the commit waits for Copilot.
          if (refusedCodes.includes(error.code)) {
            await dependencies.refuseCredential()
            return "paused"
          }
          if (error.code === "unavailable") return "paused"
          const spent = spentSchema.safeParse(error.result)
          await dependencies.finish(run.id, {
            state: "FAILED",
            failureCode: error.code.slice(0, 60),
            aiCredits: spent.success ? formatAiCredits(spent.data.usage.nanoAiu) : "0",
            copilotRequests: spent.success ? spent.data.usage.requests : 0,
            finishedAt: dependencies.now(),
          })
          return "scored"
        }
      })
      if (outcome === "deferred" || outcome === "paused") return outcome
      if (outcome === "disabled") break
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  await dependencies.deleteRequest()
  return "done"
}
