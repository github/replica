import { createHash, randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import type { InstallerUI, RunCommand } from "../installer/types.ts"
import { CommandExecutionError } from "../installer/command/index.ts"
import { promptForRecovery } from "../installer/prompt-for-recovery/index.ts"
import { privateDirectory } from "../installer/private-files/index.ts"

export function terraformModule({
  directory,
  dataDirectory,
  env,
  run,
  ui,
  preapproved = false,
  retryApply,
  signal,
  validatePlan,
}: {
  directory: string
  dataDirectory: string
  env: NodeJS.ProcessEnv
  run: RunCommand
  ui: InstallerUI
  preapproved?: boolean
  retryApply?(error: CommandExecutionError): boolean
  signal?: AbortSignal
  validatePlan?(value: unknown): void
}) {
  const command = (args: string[]) => {
    signal?.throwIfAborted()
    return run("terraform", [`-chdir=${directory}`, ...args], {
      env: { ...env, TF_DATA_DIR: dataDirectory },
      ...(signal && { signal }),
    })
  }
  return {
    async init(backend: string) {
      await privateDirectory(dataDirectory)
      while (true) {
        try {
          await command([
            "init",
            "-input=false",
            "-lock-timeout=60s",
            `-backend-config=${backend}`,
          ])
          return
        } catch (error) {
          if (!(error instanceof CommandExecutionError) || error.aborted) throw error
          await promptForRecovery(ui, {
            error,
            question: "How would you like to recover Terraform initialization?",
            message:
              "Review the full error details before retrying. Earlier installation steps may have created cloud resources; saved progress and leases are kept.",
            actions: [{ label: "Retry Terraform initialization only", value: "retry" }],
            details:
              "Check the reported backend access, network, or provider-download error. Retry uses the same module, backend, and environment without planning or applying resources, clearing leases, or restarting earlier installation steps.",
          })
        }
      }
    },
    async state(): Promise<string[]> {
      return (await command(["state", "list"])).split("\n").filter(Boolean)
    },
    async output<T>(name: string): Promise<T> {
      return JSON.parse(await command(["output", "-json", name])) as T
    },
    async apply(
      variables: string,
      {
        destroy = false,
        allowedDeletions,
      }: { destroy?: boolean; allowedDeletions?: readonly string[] } = {},
    ) {
      let requiresConfirmation = !preapproved
      let automaticRetryUsed = false
      let automaticRetryPending = false
      let approvedPlan: { signature: string; addresses: Set<string> } | undefined
      while (true) {
        const path = join(dataDirectory, `${randomUUID()}.tfplan`)
        let failure: CommandExecutionError
        let commandFailure: unknown
        let failedOperation: string | undefined
        const execute = async (args: string[]) => {
          try {
            return await command(args)
          } catch (error) {
            commandFailure = error
            failedOperation = args[0]
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
            variables?: Record<string, unknown>
            configuration?: Record<string, unknown>
            resource_changes?: {
              address: string
              change: { actions: string[]; replace_paths?: (string | number)[][] }
            }[]
          }
          validatePlan?.(plan)
          const changes = (plan.resource_changes ?? []).filter(({ change }) =>
            change.actions.some((action) => action !== "no-op" && action !== "read"),
          )
          const destructive = changes.filter(({ change }) => change.actions.includes("delete"))
          if (!destroy && destructive.length) {
            const details = destructive.map(({ address, change }) => {
              const paths = change.replace_paths?.map((path) => path.join("."))
              return `${change.actions.join("/")} ${address}${paths?.length ? ` (replacement attributes: ${paths.join(", ")})` : ""}`
            })
            const message = `Terraform plan blocked: it deletes or replaces existing resources.\n${details.join("\n")}\nNo changes from this plan were applied. Review the Terraform configuration and state before retrying.`
            ui.notice?.("error", message)
            throw new Error(message)
          }
          if (
            destroy &&
            preapproved &&
            changes.some(
              ({ address, change }) =>
                !allowedDeletions?.includes(address) ||
                change.actions.length !== 1 ||
                change.actions[0] !== "delete",
            )
          ) {
            const message =
              "Destroy plan contains resources or actions outside the approved removal scope. No cleanup changes were applied; review the plan and state."
            ui.notice?.("error", message)
            throw new Error(message)
          }
          const signature =
            plan.variables !== null &&
            typeof plan.variables === "object" &&
            !Array.isArray(plan.variables) &&
            plan.configuration !== null &&
            typeof plan.configuration === "object" &&
            !Array.isArray(plan.configuration)
              ? createHash("sha256")
                  .update(JSON.stringify([plan.variables, plan.configuration]))
                  .digest("hex")
              : undefined
          const previousPlan = approvedPlan
          if (
            automaticRetryPending &&
            (!previousPlan ||
              previousPlan.signature !== signature ||
              changes.some(({ address }) => !previousPlan.addresses.has(address)))
          )
            throw new Error(
              "The fresh Terraform plan changed inputs, configuration, or resource scope after the failed apply. No automatic retry changes were applied; review the configuration and restart with fresh deployment approval.",
            )
          automaticRetryPending = false
          for (const change of changes)
            ui.status(`${change.change.actions.join("/")} ${change.address}`)
          if (changes.length)
            ui.notice?.(
              "warning",
              `Terraform changes:\n${changes.map(({ address, change }) => `${change.actions.join("/")} ${address}`).join("\n")}`,
            )
          if (
            changes.length &&
            requiresConfirmation &&
            !(await ui.confirm(
              destroy
                ? "Remove only the temporary database provisioning job, identity, and grants?"
                : "Apply these Terraform changes?",
            ))
          ) {
            throw new Error("Installation cancelled before Terraform apply.")
          }
          if (!approvedPlan && signature)
            approvedPlan = { signature, addresses: new Set(changes.map(({ address }) => address)) }
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
        if (
          preapproved &&
          !requiresConfirmation &&
          !automaticRetryUsed &&
          failedOperation === "apply" &&
          approvedPlan &&
          retryApply?.(failure)
        ) {
          automaticRetryUsed = true
          automaticRetryPending = true
          const message =
            "Infrastructure apply failed with a recognized provisioning error. Waiting 15 seconds before one automatic fresh-plan retry of this step. The SKU and permissions are not changed; database jobs and earlier steps are not replayed."
          if (ui.notice) ui.notice("info", message)
          else ui.status(message)
          await delay(15_000, undefined, { signal })
          continue
        }
        await promptForRecovery(ui, {
          error: failure,
          question: "How would you like to recover this Terraform step?",
          message: `${
            failedOperation === "apply"
              ? "Terraform may have applied some changes."
              : "Terraform did not apply changes in this step."
          } Retry prepares a fresh plan for review; it does not restart setup.\nIf access was just granted, allow permission propagation and check data permissions, network rules, and policy before retrying.`,
          actions: [{ label: "Replan and review this Terraform step", value: "retry" }],
          details:
            "A failed apply can leave resources recorded in Terraform state. Replanning checks current state before proposing remaining changes; it does not roll back earlier changes or replay database setup.\nFor Azure Storage 403 errors, resource-management access and Blob data access are separate. A newly created Blob data role can take time to authorize requests. Check the deployment identity's Blob data permissions and applicable network rules and policy; do not enable shared keys to bypass denied access.\nState locks, ownership checks, and deletion/replacement guards remain enforced. Cleanup/destroy failures require the existing recovery procedure rather than this retry menu.",
        })
        requiresConfirmation = true
        if (ui.notice) ui.notice("info", "Preparing a fresh Terraform plan for review.")
        else ui.status("Preparing a fresh Terraform plan for review.")
      }
    },
  }
}
