import { configureAzure } from "../../azure/install/configure/index.ts"
import { assertDraftMatchesConfig, loadConfig, parseConfig, saveConfig } from "../config/index.ts"
import { installAzure } from "../../azure/install/index.ts"
import type { DeploymentConfig, RunCommand, WizardUI } from "../types.ts"
import type { WizardSession } from "../session/index.ts"
import { formatDeploymentSummary } from "../deployment-summary/index.ts"
import { createPostgresAvailability } from "../../azure/install/postgres-availability/index.ts"

export async function runWizard({
  ui,
  run,
  path,
  directory,
  existing,
  configureOnly = false,
  session: originalSession,
  entryAction = originalSession?.draft ? "resume" : existing ? "update" : "create",
  signal,
}: {
  ui: WizardUI
  run: RunCommand
  path: string
  directory: string
  existing?: DeploymentConfig
  configureOnly?: boolean
  session?: WizardSession
  entryAction?: "create" | "update" | "resume"
  signal?: AbortSignal
}): Promise<string> {
  signal?.throwIfAborted()
  if (existing) existing = parseConfig(existing)
  if (originalSession?.problem) throw new Error(originalSession.problem)
  if (existing) assertDraftMatchesConfig(existing, originalSession?.draft)
  if (
    (entryAction === "create" && (existing || originalSession?.draft)) ||
    (entryAction === "update" && (!existing || originalSession?.draft)) ||
    (entryAction === "resume" && !originalSession?.draft)
  )
    throw new Error(
      "Selected setup does not match the entry action. Configuration and draft were preserved.",
    )
  const checkpoint = async <T>(action: () => Promise<T>): Promise<T> => {
    while (true) {
      try {
        return await action()
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          ["EACCES", "EPERM", "ENOSPC", "EROFS", "EIO"].includes(String(error.code))
        ))
          throw error
        await ui.wait(
          `Could not save local setup progress (${String(error.code)}). Check disk space and permissions for ${path}. Your answers remain in memory and the previous draft is preserved. Repair the problem, then retry; no further cloud changes will start while saving is blocked.`,
        )
      }
    }
  }
  const session: WizardSession | undefined = originalSession && {
    get path() {
      return originalSession.path
    },
    get draft() {
      return originalSession.draft
    },
    get problem() {
      return originalSession.problem
    },
    answer: (key, value) => checkpoint(() => originalSession.answer(key, value)),
    clear: (keys) => checkpoint(() => originalSession.clear(keys)),
    phase: (phase) => checkpoint(() => originalSession.phase(phase)),
    restart: () => checkpoint(() => originalSession.restart()),
    complete: () => checkpoint(() => originalSession.complete()),
    close: () => originalSession.close(),
  }
  const terminal = ui
  ui = {
    ...terminal,
    phase: async (phase) => {
      await session?.phase(phase)
      await terminal.phase?.(phase)
    },
  }
  if (entryAction === "resume" && session?.draft?.deploymentStarted) {
    if (!existing)
      throw new Error(
        "Restore the saved configuration before resuming an interrupted deployment. The draft was preserved.",
      )
    const warning =
      "This setup was interrupted during deployment. A saved stage does not prove that the operation completed. After revalidating the target, the wizard can inspect retained installation/release locks and guide recovery with fresh consent. It never automatically clears a lock or replays ambiguous database provisioning."
    if (ui.notice) ui.notice("warning", warning)
    else ui.status(warning)
  }
  await ui.phase?.("cloud")
  const cloud = existing?.cloud ?? session?.draft?.answers.cloud ?? (await ui.cloud())
  if (cloud !== "azure") throw new Error("This cloud is not available yet.")
  await session?.answer("cloud", cloud)
  const availability = createPostgresAvailability(run)
  const config = await configureAzure(ui, run, existing, session, availability)
  signal?.throwIfAborted()
  if (
    existing &&
    (existing.name !== config.name ||
      existing.owner !== config.owner ||
      (["subscriptionId", "tenantId", "location", "resourceGroup"] as const).some(
        (key) => existing.azure[key] !== config.azure[key],
      ))
  ) {
    throw new Error(
      "The saved installation target or owner changed. Use a new --config file for another installation; existing configuration was not overwritten.",
    )
  }
  await ui.phase?.("review")
  const save = async (next: DeploymentConfig, previous?: DeploymentConfig) =>
    checkpoint(async () => {
      if (previous && JSON.stringify(await loadConfig(path)) !== JSON.stringify(previous))
        throw new Error(
          "The saved configuration changed during setup. It was not overwritten; restart to review it.",
        )
      await saveConfig(path, next, { exclusive: !previous })
    })
  await save(config, existing)
  ui.status(`Saved non-secret configuration to ${path}`)
  if (configureOnly) {
    await session?.complete()
    ui.complete?.()
    return `Configuration saved to ${path}. No Azure resources were changed.`
  }
  const result = await installAzure(config, {
    directory,
    run,
    ui,
    availability,
    ...(signal && { signal }),
    async saveNpmRegistry(registry) {
      await session?.answer("useProxy", true)
      await session?.answer("npmRegistry", registry)
      await save({ ...config, npmRegistry: registry }, config)
      config.npmRegistry = registry
    },
  })
  await session?.complete()
  ui.complete?.()
  return formatDeploymentSummary(result, path)
}
