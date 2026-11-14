import { resolve, dirname } from "node:path"
import { parseArgs, styleText } from "node:util"

import { installAzure } from "../azure/install/index.ts"
import { removeAzureDeployment } from "../azure/remove/index.ts"
import { azurePreflight } from "../azure/install/preflight/index.ts"
import { CommandExecutionError, runCommand } from "./command/index.ts"
import { retryReadOnly } from "./command/retry-read-only/index.ts"
import { tailLines } from "./command/tail-lines/index.ts"
import { loadConfig } from "./config/index.ts"
import { createTerminalUI } from "./terminal/index.tsx"
import type { DeploymentConfig, InstallerUI, RunCommand } from "./types.ts"
import { runWizard } from "./wizard/index.ts"
import { openSession, type WizardSession } from "./session/index.ts"
import { startInstallerTelemetry } from "./telemetry/index.ts"
import { formatDeploymentSummary } from "./deployment-summary/index.ts"
import { selectInstallerEntry, validateInstallerEntry, type InstallerEntry } from "./entry/index.ts"

const { values } = parseArgs({
  options: {
    config: { type: "string" },
    "configure-only": { type: "boolean" },
    "non-interactive": { type: "boolean" },
    "approve-deployment": { type: "boolean" },
    "no-fullscreen": { type: "boolean" },
    help: { type: "boolean" },
  },
})
if (values.help) {
  console.log(
    "Usage: npm run setup:server -- [--config FILE] [--configure-only] [--no-fullscreen]\nStart by choosing Create, Update, Remove an installation (destructive), Resume (when available), or Exit before local writes or Azure calls.\nConfig paths are relative to infrastructure/ when using the root shortcut.\nCreate keeps previous files and uses a fresh path; --config FILE uses that path only when unused.\nUpdate/Resume and removal can select local configurations or explicit config-file paths.\nRemoval selects one installation, requires irreversible confirmation and its exact deployment name, creates no backups, and retains local files.\nAfter successful removal, review the result and press Enter to return to the menu. Another removal requires fresh selection and consent.\nRemoval is interactive only and unavailable with --configure-only; --approve-deployment never authorizes deletion.\nInteractive setup progress is saved in a private companion draft; restart to resume setup.\nAutomation: --config FILE --non-interactive --approve-deployment\nApproval includes billable resources, role assignments, image publication, temporary provisioning cleanup, and a maintenance-window release.\nAutomation requires a clean source checkout and does not authorize removing state network restrictions; rerun interactively for separate consent.",
  )
} else {
  let removalCompleted = false
  while (true) {
    const abort = new AbortController()
    const execute: RunCommand = (executable, args, options) =>
      runCommand(executable, args, { ...options, signal: abort.signal })
    let path = resolve(values.config ?? resolve(import.meta.dirname, "../.local/installation.json"))
    let terminal: ReturnType<typeof createTerminalUI> | undefined
    let session: WizardSession | undefined
    let telemetry: Awaited<ReturnType<typeof startInstallerTelemetry>> | undefined
    let failure: unknown
    let interrupted = false
    let message: string | undefined
    let returnToMenu = false
    const interrupt = () => abort.abort()
    process.once("SIGINT", interrupt)
    process.once("SIGTERM", interrupt)
    try {
      let existing: DeploymentConfig | undefined
      let entry: InstallerEntry | undefined
      if (values["non-interactive"]) {
        if (!values.config || !values["approve-deployment"] || values["configure-only"])
          throw new Error(
            "Non-interactive deployment requires --config, --approve-deployment, and an existing complete configuration.",
          )
        existing = await loadConfig(path)
      } else {
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
          throw new Error(
            "Use a terminal for the wizard, or supply --non-interactive with explicit configuration and approval.",
          )
        }
        terminal = createTerminalUI(abort, {
          fullscreen: !values["no-fullscreen"],
          configureOnly: values["configure-only"],
        })
        entry = await selectInstallerEntry(terminal, {
          directory: resolve(import.meta.dirname, "../.local"),
          configPath: values.config,
          configureOnly: values["configure-only"],
        })
        if (entry) {
          if (entry.action === "remove" && values["configure-only"])
            throw new Error("Configuration-only mode cannot remove deployments.")
          path = entry.path
          if (entry.action !== "remove") {
            existing = entry.existing
            session = await openSession(path, { fresh: entry.action === "create" })
            await validateInstallerEntry(entry, session)
          }
        } else
          message = removalCompleted
            ? "Setup exited."
            : "Setup exited. No local files or Azure resources were changed."
      }
      if (values["non-interactive"] || entry) {
        telemetry = await startInstallerTelemetry(path)
        const observed = retryReadOnly(telemetry.command(execute))
        const run: RunCommand = async (executable, args, options) => {
          try {
            return await observed(executable, args, options)
          } catch (error) {
            if (error instanceof CommandExecutionError && !error.aborted)
              terminal?.notice?.("error", error.message)
            throw error
          }
        }
        if (values["non-interactive"]) {
          if (!existing) throw new Error("An existing complete configuration is required.")
          const ui: InstallerUI = telemetry.observe({
            status: (value) => console.log(value),
            confirm: async () => true,
            wait: async (value) => {
              throw new Error(value)
            },
          })
          await ui.phase?.("checks")
          await azurePreflight(run, ui)
          message = formatDeploymentSummary(
            await installAzure(existing, {
              directory: dirname(path),
              run,
              ui,
              signal: abort.signal,
            }),
            path,
          )
        } else {
          if (!terminal || !entry) throw new Error("Select a setup action before continuing.")
          const ui = telemetry.observe(terminal)
          if (entry.action === "remove") {
            message = await removeAzureDeployment(entry.target, { run, ui, signal: abort.signal })
            removalCompleted = true
            returnToMenu = true
            await ui.wait(`${message}\n\nReturn to the main menu to choose another action.`)
          } else {
            message = await runWizard({
              ui,
              run,
              path,
              directory: dirname(path),
              existing,
              configureOnly: values["configure-only"],
              session,
              entryAction: entry.action,
              signal: abort.signal,
            })
          }
        }
      }
    } catch (error) {
      failure = error
      interrupted =
        abort.signal.aborted &&
        abort.signal.reason instanceof DOMException &&
        abort.signal.reason.name === "AbortError"
      abort.abort()
    } finally {
      try {
        await terminal?.close()
      } catch (error) {
        failure ??= error
        console.error("Terminal cleanup failed. Restore your terminal before retrying setup.")
      }
      try {
        await session?.close()
      } catch (error) {
        failure ??= error
        console.error(
          "Local session writer cleanup failed. Review the local writer record before retrying.",
        )
      }
      process.removeListener("SIGINT", interrupt)
      process.removeListener("SIGTERM", interrupt)
      try {
        await telemetry?.close(failure)
      } catch (error) {
        failure ??= error
        console.error(
          "Could not finish saving installer diagnostics. The local log may be incomplete.",
        )
      }
    }
    if (failure) {
      if (returnToMenu && message) console.log(message)
      const failureMessage =
        failure instanceof SyntaxError
          ? "Setup received invalid JSON data. Review the failed operation locally before retrying; data was not printed."
          : failure instanceof Error
            ? failure.message
            : "Installation failed."
      console.error(styleText("red", `Error: ${failureMessage}`, { stream: process.stderr }))
      const notice = terminal?.summary()
      if (notice && notice !== failureMessage) console.error(notice)
      const details =
        failure instanceof CommandExecutionError && !failure.aborted ? failure.details() : undefined
      if (details) console.error(`Command details (last lines):\n${tailLines(details)}`)
      if (session?.draft || session?.problem)
        console.error(
          `Session preserved at ${session.path}. Restart setup to resume. Review retained cloud leases before retrying an interrupted deployment.`,
        )
      process.exitCode = interrupted ? 130 : 1
    } else {
      console.log(message)
    }
    if (telemetry) console.error(`Setup diagnostics: ${telemetry.path}`)
    if (failure || !returnToMenu) break
  }
}
