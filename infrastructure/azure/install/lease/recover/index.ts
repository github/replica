import { CommandExecutionError } from "../../../../installer/command/index.ts"
import type { AzureInstallation, RecoveryInspection } from "../../types.ts"
import { installationNames } from "../../settings.ts"
import { inspectRecovery } from "../inspect/index.ts"
import { stopHub } from "../../../stop-hub/index.ts"

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
  let hub: RecoveryInspection["hub"]
  let hubStopped = false
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
    hub = undefined
    feedback = {
      level: "error",
      message: `Recovery could not be verified for ${coordinates}. ${error instanceof Error ? error.message : "Inspection failed."}\nDo not assume the lock was cleared. Recheck its current state before continuing.`,
    }
    notice(feedback.level, feedback.message)
    return feedback.message
  }
  while (true) {
    let lease: Record<string, unknown>
    try {
      lease = await readLease()
    } catch (error) {
      const message = report(error)
      const choice = await select.call(ui, message, [
        { label: "Recheck the lock", value: "retry" },
        { label: "Exit and keep saved progress", value: "exit" },
      ])
      if (choice === "exit") throw error
      if (choice !== "retry") throw new Error("Choose a supported lock recovery action.")
      continue
    }
    if (unlocked(lease)) return
    const explanation =
      (hubStopped
        ? "Hub shutdown completed earlier in this recovery attempt. Hub can remain offline until a release succeeds; recovery does not restart it.\n\n"
        : "") +
      (feedback?.message ??
        (retained(lease)
          ? "Another deployment or an interrupted run may own this lock; age alone does not make it safe to clear.\nTo clear it and continue, the wizard checks safety first, then asks for confirmation. Resources and saved progress are kept."
          : "This lease is finite, changing, or unknown. Recovery is not available; wait for its owner to finish or review its state before rechecking."))
    notice(
      feedback?.level ?? "warning",
      `Deployment lock: ${coordinates}\nSubscription: ${config.azure.subscriptionId}${reviewing ? "" : `\n${explanation}`}`,
    )
    feedback = undefined
    const choice = await select.call(
      ui,
      reviewing
        ? `Deployment lock recovery did not complete.\n\n${explanation}\n\n${hub ? "Choose controlled Hub shutdown, recheck safety, or exit and keep saved progress." : "Resolve the reported issue before rechecking, or exit and keep saved progress."}`
        : "How would you like to handle the deployment lock?",
      [
        {
          label:
            reviewing && retained(lease)
              ? "Recheck safety before clearing the lock"
              : "Recheck without clearing the lock",
          value: "retry",
        },
        ...(retained(lease) && !reviewing
          ? [{ label: "Clear lock and continue (after safety checks)", value: "recover" }]
          : []),
        ...(retained(lease) && hub
          ? [{ label: "Stop Hub for recovery and continue", value: "stop-hub" }]
          : []),
        { label: "Exit and keep saved progress", value: "exit" },
      ],
    )
    if (choice === "exit")
      throw new Error(
        reviewing
          ? `Setup stopped. Saved progress was preserved.\n\n${explanation}`
          : "Setup stopped. Saved progress and deployment locks were preserved.",
      )
    if (choice === "retry" && !(reviewing && retained(lease))) continue
    if (
      !["recover", "retry", "stop-hub"].includes(choice) ||
      !retained(lease) ||
      (choice === "recover" && reviewing) ||
      (choice === "stop-hub" && !hub)
    )
      throw new Error("Choose a supported lock recovery action.")
    const requestedHub = choice === "stop-hub" ? hub : undefined
    hub = undefined
    reviewing = true
    try {
      let inspection = await inspectRecovery(context, releaseAccount)
      if (requestedHub) {
        hub = inspection.hub
        if (inspection.hub?.id.toLowerCase() !== requestedHub.id.toLowerCase()) {
          feedback = {
            level: "warning",
            message: `Hub shutdown was not started. Recovery conditions changed.\n\n${inspection.blockers.join("\n\n") || "Hub no longer requires shutdown. Recheck lock recovery."}`,
          }
          continue
        }
        if (
          !(await ui.confirm(
            `Authorize downtime for Hub ${inspection.hub.name} in resource group ${config.azure.resourceGroup}, subscription ${config.azure.subscriptionId}?\nVerified app: ${inspection.hub.id}\nDeactivate its active revisions and wait for every old replica to stop. No app or database will be deleted, and no setup/provisioning job will be cancelled.\nConfirm that all previous installer, Terraform, and release processes have stopped, including other terminals, machines, and CI. Also confirm that old provisioning/setup/migration database sessions have ended and that partial migrations, database ownership, and temporary provisioning grants have been reviewed.\nThe lock at ${coordinates} will remain retained until a separate clearing confirmation. Hub may remain stopped if later recovery fails or is cancelled.`,
          ))
        ) {
          feedback = {
            level: "warning",
            message:
              "Hub shutdown was not authorized. The wizard did not stop Hub or clear the lock.",
          }
          continue
        }
        const fresh = await inspectRecovery(context, releaseAccount)
        const current = await readLease()
        hub = fresh.hub
        if (unlocked(current)) return
        if (
          !retained(current) ||
          fresh.hub?.id.toLowerCase() !== requestedHub.id.toLowerCase() ||
          fresh.evidence !== inspection.evidence ||
          fresh.databaseReview !== inspection.databaseReview
        ) {
          feedback = {
            level: "warning",
            message: `Hub shutdown was not started. The lease or recovery conditions changed during consent.\n\n${fresh.blockers.join("\n\n")}`,
          }
          continue
        }
        hub = undefined
        ui.status("Deactivating verified Hub revisions and waiting up to five minutes for replicas")
        try {
          await stopHub({
            name: requestedHub.name,
            resourceGroup: config.azure.resourceGroup,
            command: async (...args) => {
              const output = await azure(...args)
              try {
                return JSON.parse(output)
              } catch {
                throw new Error(
                  "Azure returned invalid shutdown metadata. Shutdown was not verified.",
                )
              }
            },
          })
        } catch (error) {
          const message = report(error)
          feedback = {
            level: "error",
            message: `Hub shutdown did not complete. Hub may be partially or fully stopped. No lock-clearing command was issued; inspect the current state before retrying.\n\n${message}`,
          }
          notice(feedback.level, feedback.message)
          continue
        }
        notice(
          "warning",
          "Hub replicas have stopped. The deployment lock remains retained pending fresh recovery checks and separate clearing approval.",
        )
        hubStopped = true
        inspection = await inspectRecovery(context, releaseAccount)
      }
      if (inspection.blockers.length) {
        hub = inspection.hub
        feedback = {
          level: "warning",
          message: `The deployment lock was not cleared.\n\n${inspection.blockers.join("\n\n")}`,
        }
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
      if (
        fresh.blockers.length ||
        fresh.evidence !== inspection.evidence ||
        fresh.databaseReview !== inspection.databaseReview
      ) {
        hub = fresh.hub
        feedback = {
          level: "warning",
          message: `The deployment lock was not cleared.\n\n${
            fresh.blockers.join("\n\n") ||
            "The installation changed during review. Review it again."
          }`,
        }
        continue
      }
      if (unlocked(current)) return
      if (!retained(current)) {
        feedback = {
          level: "warning",
          message:
            "The lease changed during review. The wizard did not clear it. Recheck before taking any action.",
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
