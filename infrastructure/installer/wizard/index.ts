import { configureAzure } from "../../azure/install/configure/index.ts"
import { join } from "node:path"
import { installAzure } from "../../azure/install/index.ts"
import { saveConfig } from "../config/index.ts"
import type { DeploymentConfig, RunCommand, WizardUI } from "../types.ts"
import type { WizardSession } from "../session/index.ts"

export async function runWizard({
  ui,
  run,
  path,
  directory,
  existing,
  configureOnly = false,
  session: originalSession,
}: {
  ui: WizardUI
  run: RunCommand
  path: string
  directory: string
  existing?: DeploymentConfig
  configureOnly?: boolean
  session?: WizardSession
}): Promise<string> {
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
  ui.welcome?.(true)
  if (session?.draft || session?.problem) {
    const draft = session.draft
    if (session.problem) {
      if (ui.notice) ui.notice("error", session.problem)
      else ui.status(session.problem)
    }
    const message = draft
      ? `An unfinished setup was saved ${draft.updatedAt}.\nInstallation: ${draft.answers.name ?? "not named"}; last stage: ${draft.phase}.\nTarget: Azure / ${draft.answers.tenantId ?? "tenant not selected"} / ${draft.answers.subscriptionId ?? "subscription not selected"} / ${draft.answers.location ?? "region not selected"}.\nResume setup?`
      : "The saved session needs attention. Choose how to continue."
    const choice = await ui.select(message, [
      ...(draft ? [{ label: "Resume setup", value: "resume" }] : []),
      { label: "Start over (local draft only)", value: "start-over" },
      { label: "Exit and keep the draft", value: "exit" },
    ])
    if (choice === "exit") throw new Error("Setup stopped. The saved draft was preserved.")
    if (choice === "start-over") {
      if (
        !(await ui.confirm(
          "Discard this local draft? Cloud resources and installation/release locks will not be changed.",
        ))
      ) {
        throw new Error("Setup stopped. The saved draft was preserved.")
      }
      await session.restart()
    } else if (choice !== "resume" || !draft)
      throw new Error("Choose a supported session recovery action.")
    if (session.draft?.deploymentStarted) {
      const warning =
        "This setup was interrupted during deployment. A saved stage does not prove that the operation completed. After revalidating the target, the wizard can inspect retained installation/release locks and guide recovery with fresh consent. It never automatically clears a lock or replays ambiguous database provisioning."
      if (ui.notice) ui.notice("warning", warning)
      else ui.status(warning)
      await ui.wait(
        "Continue to revalidate your configuration. Retained locks will offer recovery checks before proceeding; deployment and lock recovery still require fresh approval.",
      )
    }
  }
  await ui.phase?.("cloud")
  const cloud = session?.draft?.answers.cloud ?? (await ui.cloud())
  if (cloud !== "azure") throw new Error("This cloud is not available yet.")
  await session?.answer("cloud", cloud)
  const config = await configureAzure(ui, run, existing, session)
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
  await checkpoint(() => saveConfig(path, config))
  ui.status(`Saved non-secret configuration to ${path}`)
  if (configureOnly) {
    await session?.complete()
    ui.complete?.()
    return `Configuration saved to ${path}. No Azure resources were changed.`
  }
  const url = await installAzure(config, {
    directory: join(directory, config.name),
    run,
    ui,
    async saveNpmRegistry(registry) {
      await session?.answer("useProxy", true)
      await session?.answer("npmRegistry", registry)
      await checkpoint(() => saveConfig(path, { ...config, npmRegistry: registry }))
      config.npmRegistry = registry
    },
  })
  await session?.complete()
  ui.complete?.()
  return `Hub is ready at ${url}. Readiness does not provide sign-in or authorization.`
}
