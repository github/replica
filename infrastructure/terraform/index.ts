import { randomUUID } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"

import type { InstallerUI, RunCommand } from "../installer/types.ts"
import { CommandExecutionError } from "../installer/command/index.ts"
import { promptForRecovery } from "../installer/prompt-for-recovery/index.ts"

export function terraformModule({
  directory,
  dataDirectory,
  env,
  run,
  ui,
}: {
  directory: string
  dataDirectory: string
  env: NodeJS.ProcessEnv
  run: RunCommand
  ui: InstallerUI
}) {
  const command = (args: string[]) =>
    run("terraform", [`-chdir=${directory}`, ...args], {
      env: { ...env, TF_DATA_DIR: dataDirectory },
    })
  return {
    async init(backend: string) {
      await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
      await command(["init", "-input=false", `-backend-config=${backend}`])
    },
    async state(): Promise<string[]> {
      return (await command(["state", "list"])).split("\n").filter(Boolean)
    },
    async output<T>(name: string): Promise<T> {
      return JSON.parse(await command(["output", "-json", name])) as T
    },
    async apply(variables: string, { destroy = false } = {}) {
      while (true) {
        const path = join(dataDirectory, `${randomUUID()}.tfplan`)
        let failure: CommandExecutionError
        let commandFailure: unknown
        const execute = async (args: string[]) => {
          try {
            return await command(args)
          } catch (error) {
            commandFailure = error
            throw error
          }
        }
        try {
          await execute([
            "plan",
            "-input=false",
            "-lock-timeout=60s",
            `-var-file=${variables}`,
            `-out=${path}`,
            ...(destroy ? ["-destroy"] : []),
          ])
          const plan = JSON.parse(await execute(["show", "-json", path])) as {
            resource_changes?: { address: string; change: { actions: string[] } }[]
          }
          const changes = (plan.resource_changes ?? []).filter(({ change }) =>
            change.actions.some((action) => action !== "no-op" && action !== "read"),
          )
          if (!destroy && changes.some(({ change }) => change.actions.includes("delete"))) {
            throw new Error(
              "This installation plan deletes or replaces resources. Review recovery separately.",
            )
          }
          for (const change of changes)
            ui.status(`${change.change.actions.join("/")} ${change.address}`)
          if (changes.length)
            ui.notice?.(
              "warning",
              `Terraform changes:\n${changes.map(({ address, change }) => `${change.actions.join("/")} ${address}`).join("\n")}`,
            )
          if (
            changes.length &&
            !(await ui.confirm(
              destroy
                ? "Remove only the temporary database provisioning job, identity, and grants?"
                : "Apply these Terraform changes?",
            ))
          ) {
            throw new Error("Installation cancelled before Terraform apply.")
          }
          await execute(["apply", "-input=false", "-lock-timeout=60s", path])
          return
        } catch (error) {
          if (
            error !== commandFailure ||
            !(error instanceof CommandExecutionError) ||
            error.aborted ||
            destroy
          )
            throw error
          failure = error
        } finally {
          await rm(path, { force: true })
        }
        await promptForRecovery(ui, {
          error: failure,
          question: "How would you like to recover this Terraform step?",
          message:
            "Terraform may have applied some changes. Retry prepares a fresh plan for review; it does not restart setup.\nIf access was just granted, allow permission propagation and check data permissions, network rules, and policy before retrying.",
          actions: [{ label: "Replan and review this Terraform step", value: "retry" }],
          details:
            "A failed apply can leave resources recorded in Terraform state. Replanning checks current state before proposing remaining changes; it does not roll back earlier changes or replay database setup.\nFor Azure Storage 403 errors, resource-management access and Blob data access are separate. A newly created Blob data role can take time to authorize requests. Check the deployment identity's Blob data permissions and applicable network rules and policy; do not enable shared keys to bypass denied access.\nState locks, ownership checks, and deletion/replacement guards remain enforced. Cleanup/destroy failures require the existing recovery procedure rather than this retry menu.",
        })
        if (ui.notice) ui.notice("info", "Preparing a fresh Terraform plan for review.")
        else ui.status("Preparing a fresh Terraform plan for review.")
      }
    },
  }
}
