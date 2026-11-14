import { createHash, randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import type { InstallerUI, RunCommand } from "../installer/types.ts"
import { CommandExecutionError } from "../installer/command/index.ts"
import { promptForRecovery } from "../installer/prompt-for-recovery/index.ts"
import { privateDirectory } from "../installer/private-files/index.ts"
import { applyOutcomes, type ApplyOutcome } from "./apply-outcomes/index.ts"

export type PlannedCreate = { address: string; type?: string; after?: unknown }

const uncertainKinds = new Set<ApplyOutcome["kind"]>([
  "ambiguous-write",
  "conflict",
  "state-not-saved",
])

function describeOutcome({ address, kind }: ApplyOutcome) {
  const subject = address ?? "Terraform"
  switch (kind) {
    case "ambiguous-write":
      return `${subject}: the request was sent but its response was lost. Azure may have completed it.`
    case "conflict":
      return `${subject}: Azure reports that it already exists but Terraform state does not record it.`
    case "state-not-saved":
      return "Terraform could not save state. Completed changes may be missing from saved state."
    case "connectivity":
      return `${subject}: a network or name-resolution failure. This is not a permission denial.`
    case "permission":
      return `${subject}: access was denied.`
    default:
      return `${subject}: unrecognized error.`
  }
}

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
  findUntracked,
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
  // Read-only lookup of an existing cloud resource that a create-only change would duplicate.
  findUntracked?(change: PlannedCreate): Promise<string | undefined>
}) {
  const command = (args: string[]) => {
    signal?.throwIfAborted()
    return run("terraform", [`-chdir=${directory}`, ...args], {
      env: { ...env, TF_DATA_DIR: dataDirectory },
      ...(signal && { signal }),
    })
  }
  const listState = async () => (await command(["state", "list"])).split("\n").filter(Boolean)
  const stateEvidence = async (addresses: string[]) => {
    try {
      const saved = new Set(await listState())
      return [
        `Saved Terraform state records ${saved.size} resources.`,
        ...addresses.map(
          (address) => `${address} is ${saved.has(address) ? "" : "not "}recorded in saved state.`,
        ),
      ].join("\n")
    } catch (error) {
      if (signal?.aborted) throw error
      return "Saved Terraform state could not be read now; this does not mean saved state was lost."
    }
  }
  return {
    async init(backend: string) {
      await privateDirectory(dataDirectory)
      while (true) {
        try {
          await command(["init", "-input=false", "-lock-timeout=60s", `-backend-config=${backend}`])
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
    state: listState,
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
      const uncertainAddresses = new Set<string>()
      const rejectUntracked = async (
        lookup: NonNullable<typeof findUntracked>,
        changes: {
          address: string
          type?: string
          change: { actions: string[]; after?: unknown }
        }[],
      ) => {
        const found: { address: string; id: string }[] = []
        for (const { address, type, change } of changes) {
          if (change.actions.length !== 1 || change.actions[0] !== "create") continue
          try {
            const id = await lookup({ address, type, after: change.after })
            if (id) found.push({ address, id })
          } catch (error) {
            if (signal?.aborted) throw error
            if (!uncertainAddresses.has(address)) {
              ui.status(
                `Could not check whether ${address} already exists; Terraform reports a conflict if it does.`,
              )
              continue
            }
            const message = `Terraform plan blocked: ${address} had an uncertain apply result and Azure could not be checked for it. Nothing from this plan was applied; saved progress and leases are kept. Retry when Azure is reachable.`
            ui.notice?.("error", message)
            throw new Error(message)
          }
        }
        if (!found.length) return
        const inputVariables = Object.keys(env)
          .filter((name) => name.startsWith("TF_VAR_"))
          .sort()
        const message = [
          "Terraform plan blocked: Azure already has resources that saved Terraform state does not record.",
          ...found.map(({ address, id }) => `${address}: ${id}`),
          "A previous apply probably completed these writes after their responses were lost. Nothing from this plan was applied, nothing was imported, and saved progress and leases are kept.",
          `To recover: exit the wizard and keep the lease; make sure no other installer or release is running; save an owner-only backup of state with terraform state pull, because state contains secrets; confirm each listed ID is the exact resource this installation intended. Then run these from ${directory} with TF_DATA_DIR=${dataDirectory}, which keeps the same backend and workspace${inputVariables.length ? `, and set ${inputVariables.join(", ")} to the values this installation uses` : ""}:`,
          ...found.map(
            ({ address, id }) =>
              `terraform import -input=false -var-file=${variables} -lock-timeout=60s '${address}' '${id}'`,
          ),
          "Run the wizard again and confirm the fresh plan has no deletions or replacements. Do not delete the existing resources to make the plan pass.",
        ].join("\n")
        ui.notice?.("error", message)
        throw new Error(message)
      }
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
              type?: string
              change: {
                actions: string[]
                replace_paths?: (string | number)[][]
                after?: unknown
              }
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
          if (!destroy && findUntracked) await rejectUntracked(findUntracked, changes)
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
        const outcomes = failedOperation === "apply" ? applyOutcomes(failure.details()) : []
        const uncertain = outcomes.filter(({ kind }) => uncertainKinds.has(kind))
        for (const { address } of uncertain) if (address) uncertainAddresses.add(address)
        if (
          preapproved &&
          !requiresConfirmation &&
          !automaticRetryUsed &&
          failedOperation === "apply" &&
          approvedPlan &&
          !uncertain.length &&
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
        const diagnosis = outcomes.some(({ kind }) => kind !== "unknown")
          ? [
              ...outcomes.map(describeOutcome),
              ...(uncertain.length
                ? [
                    await stateEvidence(
                      uncertain.flatMap(({ address }) => (address ? [address] : [])),
                    ),
                    `Do not recreate these resources blindly.${findUntracked ? " Replanning checks supported resources against Azure and blocks before applying if one already exists outside saved state." : ""}`,
                  ]
                : []),
            ].join("\n") + "\n"
          : ""
        if (diagnosis && !ui.select) ui.status(diagnosis.trimEnd())
        await promptForRecovery(ui, {
          error: failure,
          question: "How would you like to recover this Terraform step?",
          message: `${diagnosis}${
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
