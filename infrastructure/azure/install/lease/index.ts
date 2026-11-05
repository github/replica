import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { AzureInstallation } from "../types.ts"

export async function acquireLease(
  context: AzureInstallation,
  account: string,
  container: string,
  blob: string,
  create = false,
) {
  const { azure, directory, ui } = context
  const args = [
    "--account-name",
    account,
    "--container-name",
    container,
    "--blob-name",
    blob,
    "--auth-mode",
    "login",
  ]
  if (create) {
    const exists = JSON.parse(
      await azure(
        "storage",
        "blob",
        "exists",
        "--account-name",
        account,
        "--container-name",
        container,
        "--name",
        blob,
        "--auth-mode",
        "login",
      ),
    ) as { exists: boolean }
    if (!exists.exists) {
      const path = join(directory, "installation-lock.txt")
      await writeFile(path, "Replica installation lock. Do not remove during installation.\n", {
        mode: 0o600,
      })
      await azure(
        "storage",
        "blob",
        "upload",
        "--account-name",
        account,
        "--container-name",
        container,
        "--name",
        blob,
        "--file",
        path,
        "--overwrite",
        "false",
        "--auth-mode",
        "login",
      )
    }
  }
  const lease = JSON.parse(
    await azure("storage", "blob", "lease", "acquire", ...args, "--lease-duration", "-1"),
  ) as unknown
  if (typeof lease !== "string" || !lease)
    throw new Error("Azure did not return an installation lease.")
  let released = false
  return {
    async release() {
      await azure("storage", "blob", "lease", "release", ...args, "--lease-id", lease)
      released = true
    },
    reportRetained() {
      if (!released) {
        ui.status(
          `Lock retained at ${account}/${container}/${blob}. Before an operator breaks this lease, verify all installer processes, setup/provisioning executions, and database sessions have stopped. See the recovery guide.`,
        )
      }
    },
  }
}
