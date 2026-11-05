import { CommandExecutionError } from "../../../../installer/command/index.ts"
import type { AzureInstallation } from "../../types.ts"
import { installationNames } from "../../settings.ts"
import { inspectRecovery } from "../inspect/index.ts"

const unlocked = (lease: Record<string, unknown>) =>
  lease.status === "unlocked" && ["available", "broken", "expired"].includes(String(lease.state))
const retained = (lease: Record<string, unknown>) =>
  lease.status === "locked" && lease.state === "leased" && lease.duration === "infinite"

export async function recoverLease(
  context: AzureInstallation,
  account: string,
  container: string,
  blob: string,
) {
  const { azure, ui, config } = context
  const select = ui.select
  if (!select) return
  const installation =
    account === installationNames(config).stateAccount &&
    container === "terraform" &&
    blob === `${config.name}/installer.lock`
  const release = container === "releases" && blob === "deployment.lock"
  if (!installation && !release)
    throw new Error(
      "Wizard recovery supports only this installation's operational locks, never Terraform state or other blobs.",
    )
  const coordinates = `${account}/${container}/${blob}`
  const releaseAccount = release ? account : undefined
  const args = ["--account-name", account, "--container-name", container]
  let feedback: { level: "warning" | "error"; message: string } | undefined
  let reviewing = false
  async function readLease(): Promise<Record<string, unknown>> {
    const value: unknown = JSON.parse(
      await azure(
        "storage",
        "blob",
        "show",
        ...args,
        "--name",
        blob,
        "--auth-mode",
        "login",
        "--query",
        "properties.lease",
      ),
    )
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("Azure did not return lease metadata. No lock was cleared.")
    return value as Record<string, unknown>
  }
  function notice(level: "warning" | "error" | "success", message: string) {
    if (ui.notice) ui.notice(level, message)
    else ui.status(message)
  }
  function report(error: unknown) {
    if (
      (error instanceof CommandExecutionError && error.aborted) ||
      (error instanceof DOMException && error.name === "AbortError")
    )
      throw error
    feedback = {
      level: "error",
      message: `Recovery could not be verified for ${coordinates}. ${error instanceof Error ? error.message : "Inspection failed."}\nDo not assume the lock was cleared. Recheck its current state before continuing.`,
    }
    notice(feedback.level, feedback.message)
  }
  while (true) {
    let lease: Record<string, unknown>
    try {
      lease = await readLease()
    } catch (error) {
      report(error)
      const choice = await select.call(ui, `Could not inspect ${coordinates}.`, [
        { label: "Recheck the lock", value: "retry" },
        { label: "Exit and keep saved progress", value: "exit" },
      ])
      if (choice === "exit") throw error
      if (choice !== "retry") throw new Error("Choose a supported lock recovery action.")
      continue
    }
    if (unlocked(lease)) return
    notice(
      feedback?.level ?? "warning",
      `Deployment lock: ${coordinates}\nSubscription: ${config.azure.subscriptionId}\n${feedback?.message ?? (retained(lease) ? "Another deployment or an interrupted run may own this lock; age alone does not make it safe to clear.\nTo clear it and continue, the wizard checks safety first, then asks for confirmation. Resources and saved progress are kept." : "This lease is finite, changing, or unknown. Recovery is not available; wait for its owner to finish or review its state before rechecking.")}`,
    )
    feedback = undefined
    const choice = await select.call(ui, "How would you like to handle the deployment lock?", [
      {
        label:
          reviewing && retained(lease)
            ? "Recheck blockers before clearing the lock"
            : "Recheck without clearing the lock",
        value: "retry",
      },
      ...(retained(lease)
        ? [{ label: "Clear lock and continue (after safety checks)", value: "recover" }]
        : []),
      { label: "Exit and keep saved progress", value: "exit" },
    ])
    if (choice === "exit")
      throw new Error("Setup stopped. Saved progress and deployment locks were preserved.")
    if (choice === "retry" && !(reviewing && retained(lease))) continue
    if ((choice !== "recover" && choice !== "retry") || !retained(lease))
      throw new Error("Choose a supported lock recovery action.")
    reviewing = true
    try {
      const inspection = await inspectRecovery(context, releaseAccount)
      if (inspection.blockers.length) {
        feedback = { level: "warning", message: inspection.blockers.join("\n\n") }
        continue
      }
      notice(
        "warning",
        `Azure checks found no locked Terraform state, active job executions, or running Hub revisions/replicas. Azure cannot prove that a deployment process on another machine has stopped${inspection.databaseReview ? " or that old database sessions have ended" : ""}.`,
      )
      if (
        !(await ui.confirm(
          `Confirm that all previous installer, Terraform, and release processes have stopped, including other terminals, machines, and CI.${inspection.databaseReview ? " Also confirm that old provisioning/setup/migration database sessions have ended and that partial migrations, database ownership, and temporary provisioning grants have been reviewed using the installation recovery guide." : ""}\nClear only the deployment lock at ${coordinates} in subscription ${config.azure.subscriptionId}? Resources and saved progress will be kept. This does not repair or replay database work.`,
        ))
      ) {
        feedback = {
          level: "warning",
          message: "Recovery was not authorized. The lock and saved progress are unchanged.",
        }
        continue
      }
      const fresh = await inspectRecovery(context, releaseAccount)
      const current = await readLease()
      if (fresh.blockers.length || fresh.databaseReview !== inspection.databaseReview) {
        feedback = {
          level: "warning",
          message:
            fresh.blockers.join("\n\n") ||
            "The installation changed during review. Review it again.",
        }
        continue
      }
      if (unlocked(current)) return
      if (!retained(current)) {
        feedback = {
          level: "warning",
          message: "The lease changed during review. Recheck before taking any action.",
        }
        continue
      }
      await azure(
        "storage",
        "blob",
        "lease",
        "break",
        ...args,
        "--blob-name",
        blob,
        "--auth-mode",
        "login",
        "--lease-break-period",
        "0",
      )
      if (!unlocked(await readLease()))
        throw new Error("Azure has not confirmed that the selected lock is unlocked.")
      notice("success", `Cleared the deployment lock at ${coordinates}. Continuing with setup.`)
      return
    } catch (error) {
      report(error)
    }
  }
}
