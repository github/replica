import { resolve, dirname, join } from "node:path"
import { parseArgs, styleText } from "node:util"

import { installAzure } from "../azure/install/index.ts"
import { azurePreflight } from "../azure/install/preflight/index.ts"
import { CommandExecutionError, runCommand } from "./command/index.ts"
import { loadConfig } from "./config/index.ts"
import { createTerminalUI } from "./terminal/index.tsx"
import type { DeploymentConfig, InstallerUI, RunCommand } from "./types.ts"
import { runWizard } from "./wizard/index.ts"
import { openSession, type WizardSession } from "./session/index.ts"
import { startInstallerTelemetry } from "./telemetry/index.ts"

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
    "Usage: npm run setup:server -- [--config FILE] [--configure-only] [--no-fullscreen]\nConfig paths are relative to infrastructure/ when using the root shortcut.\nInteractive progress is saved in a private companion draft; restart to resume.\nAutomation: --config FILE --non-interactive --approve-deployment\nApproval includes billable resources, role assignments, image publication, temporary provisioning cleanup, and a maintenance-window release.",
  )
} else {
  const abort = new AbortController()
  const execute: RunCommand = (executable, args, options) =>
    runCommand(executable, args, { ...options, signal: abort.signal })
  const path = resolve(values.config ?? resolve(import.meta.dirname, "../.local/installation.json"))
  let terminal: ReturnType<typeof createTerminalUI> | undefined
  let session: WizardSession | undefined
  let telemetry: Awaited<ReturnType<typeof startInstallerTelemetry>> | undefined
  let failure: unknown
  let interrupted = false
  let message: string | undefined
  const interrupt = () => abort.abort()
  process.once("SIGINT", interrupt)
  process.once("SIGTERM", interrupt)
  try {
    telemetry = await startInstallerTelemetry(path)
    const observed = telemetry.command(execute)
    const run: RunCommand = async (executable, args, options) => {
      try {
        return await observed(executable, args, options)
      } catch (error) {
        if (error instanceof CommandExecutionError && !error.aborted)
          terminal?.notice?.("error", error.message)
        throw error
      }
    }
    let existing: DeploymentConfig | undefined
    try {
      existing = await loadConfig(path)
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    }
    if (values["non-interactive"]) {
      if (
        !existing ||
        !values.config ||
        !values["approve-deployment"] ||
        values["configure-only"]
      ) {
        throw new Error(
          "Non-interactive deployment requires --config, --approve-deployment, and an existing complete configuration.",
        )
      }
      const ui: InstallerUI = telemetry.observe({
        status: (value) => console.log(value),
        confirm: async () => true,
        wait: async (value) => {
          throw new Error(value)
        },
      })
      await ui.phase?.("checks")
      await azurePreflight(run, ui)
      message = await installAzure(existing, {
        directory: join(dirname(path), existing.name),
        run,
        ui,
      })
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
      const ui = telemetry.observe(terminal)
      session = await openSession(path)
      message = await runWizard({
        ui,
        run,
        path,
        directory: dirname(path),
        existing,
        configureOnly: values["configure-only"],
        session,
      })
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
    console.error(
      styleText(
        "red",
        `Error: ${failure instanceof Error ? failure.message : "Installation failed."}`,
        { stream: process.stderr },
      ),
    )
    const notice = terminal?.summary()
    if (notice) console.error(notice)
    if (session?.draft || session?.problem)
      console.error(
        `Session preserved at ${session.path}. Restart setup to resume. Review retained cloud leases before retrying an interrupted deployment.`,
      )
    process.exitCode = interrupted ? 130 : 1
  } else {
    console.log(message)
  }
  if (telemetry) console.error(`Setup diagnostics: ${telemetry.path}`)
}
