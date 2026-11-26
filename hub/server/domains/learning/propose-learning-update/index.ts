import { z } from "zod"

import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { formatAiCredits } from "../../../utils/format-ai-credits/index.ts"

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
const proposedSchema = spentSchema.extend({
  state: z.enum(["insufficient_evidence", "up_to_date", "no_change", "proposed"]),
})

type Request = { id: string; repositoryId: string; memoryId: string; revision: number }

/**
 * Checks one flagged learning for a suggested update and records what the check cost,
 * even when it fails, so spending is never undercounted. Returns "paused" when Copilot or
 * the budget is unavailable, so the flag waits for the next day.
 */
export async function proposeLearningUpdate(
  request: Request,
  dependencies: {
    closeAbandoned(finishedAt: Date): Promise<unknown>
    credential(): Promise<{ githubToken?: string } | null>
    deleteRequest(request: Request): Promise<unknown>
    finish(
      runId: string,
      input: { aiCredits: string; copilotRequests: number; finishedAt: Date } & (
        { state: "SUCCEEDED"; result: string } | { state: "FAILED"; failureCode: string }
      ),
    ): Promise<unknown>
    isEnabled(repositoryId: string): Promise<boolean>
    now(): Date
    prepare(repositoryId: string): Promise<string[]>
    runCommand(
      arguments_: string[],
      options: { githubToken?: string; signal: AbortSignal; timeoutMs?: number },
    ): Promise<unknown>
    start(input: { repositoryId: string; memoryId: string }): Promise<{ id: string }>
    withinBudget(): Promise<boolean>
    withLock<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>
  },
): Promise<"done" | "paused"> {
  // The ID is passed to the package as an argument, so it must never read as an option.
  if (request.memoryId.startsWith("-")) {
    await dependencies.deleteRequest(request)
    return "done"
  }
  // Installation tokens expire within an hour, so each check asks for a fresh one.
  const credential = await dependencies.credential()
  if (!credential) return "paused"
  const store = await dependencies.prepare(request.repositoryId)
  const outcome = await dependencies.withLock(async (signal) => {
    // Runs are only written under this lock, so any still running were abandoned.
    await dependencies.closeAbandoned(dependencies.now())
    // Checked under the lock, so turning evaluations off or removing the repository stops
    // the check, and a score running at the same time can't overspend the budget.
    if (!(await dependencies.isEnabled(request.repositoryId))) return "disabled"
    if (!(await dependencies.withinBudget())) return "paused"
    const run = await dependencies.start(request)
    try {
      const proposed = proposedSchema.parse(
        await dependencies.runCommand(["propose-update", request.memoryId, ...store], {
          ...credential,
          signal,
          timeoutMs: 10 * 60 * 1000,
        }),
      )
      await dependencies.finish(run.id, {
        state: "SUCCEEDED",
        result: proposed.state,
        aiCredits: formatAiCredits(proposed.usage.nanoAiu),
        copilotRequests: proposed.usage.requests,
        finishedAt: dependencies.now(),
      })
      return "done"
    } catch (error) {
      if (!(error instanceof LearningCommandError) || error.code === "cancelled") throw error
      const spent = spentSchema.safeParse(error.result)
      await dependencies.finish(run.id, {
        state: "FAILED",
        failureCode: error.code.slice(0, 60),
        aiCredits: spent.success ? formatAiCredits(spent.data.usage.nanoAiu) : "0",
        copilotRequests: spent.success ? spent.data.usage.requests : 0,
        finishedAt: dependencies.now(),
      })
      // An outage says nothing about the learning, so its flag waits for Copilot.
      return error.code === "unavailable" || error.code === "unauthorized" ? "paused" : "done"
    }
  })
  if (outcome === "paused") return "paused"
  // Turning evaluations off means nothing more is suggested, so the flag is dropped too.
  await dependencies.deleteRequest(request)
  return "done"
}
