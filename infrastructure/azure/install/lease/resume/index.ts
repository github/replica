import type { AzureInstallation } from "../../types.ts"
import { inspectRecovery } from "../inspect/index.ts"

export async function confirmLeaseResume(
  context: AzureInstallation,
  account: string,
  container: string,
  blob: string,
) {
  const { ui } = context
  const select = ui.select
  if (!select) return
  const coordinates = `${account}/${container}/${blob}`
  const releaseAccount = container === "releases" ? account : undefined
  const notice = (message: string) =>
    ui.notice ? ui.notice("warning", message) : ui.status(message)
  while (true) {
    const inspection = await inspectRecovery(context, releaseAccount)
    // Inspection returns a verified Hub only when its activity is the sole blocker; a running Hub is expected while resuming.
    const blockers = inspection.hub ? [] : inspection.blockers
    if (!blockers.length) {
      const database = inspection.databaseReview
      notice(
        `Resuming with this installer's saved lease at ${coordinates}. Azure checks found no locked Terraform state or active job executions. Azure cannot prove that the previous installer process, including one in another terminal, has stopped${database ? " or that old database sessions have ended" : ""}.`,
      )
      if (
        await ui.confirm(
          `Confirm that all previous installer, Terraform, and release processes for this installation have stopped, including other terminals, machines, and CI.${database ? " Also confirm that old provisioning/setup/migration database sessions have ended and that partial migrations have been reviewed using the installation recovery guide." : ""}\nResume with the saved lease at ${coordinates}?`,
        )
      )
        return
      throw new Error(
        `Resuming with the saved lease at ${coordinates} was not authorized. The lease remains recorded for this installation, and saved progress is unchanged.`,
      )
    }
    notice(
      `The saved lease at ${coordinates} is held, but previous installer work may still be running.\n\n${blockers.join("\n\n")}`,
    )
    const choice = await select("Setup cannot resume until previous work has stopped.", [
      { label: "Recheck", value: "recheck" },
      { label: "Exit and keep saved progress", value: "exit" },
    ])
    if (choice === "exit")
      throw new Error(
        `Setup exited before resuming with the saved lease at ${coordinates}. The lease remains recorded for this installation, and saved progress is unchanged.`,
      )
    if (choice !== "recheck") throw new Error("Choose a supported lock recovery action.")
  }
}
