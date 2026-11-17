import { writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import type { AzureInstallation } from "../types.ts"
import { CommandExecutionError } from "../../../installer/command/index.ts"
import { recoverLease } from "./recover/index.ts"
import { leaseOwnership } from "./ownership/index.ts"
import { readBlobLease } from "./read/index.ts"
import { staleLeaseError } from "./stale/index.ts"

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
  const ownership = await leaseOwnership(context, account, container, blob)
  let result: string | undefined
  if (ownership.lease) {
    const metadata = await readBlobLease(context, account, container, blob)
    if (
      metadata &&
      typeof metadata === "object" &&
      "status" in metadata &&
      metadata.status === "locked"
    ) {
      if (
        !("state" in metadata) ||
        metadata.state !== "leased" ||
        !("duration" in metadata) ||
        metadata.duration !== "infinite"
      )
        throw new Error(
          "The recorded deployment lease is finite, changing, or unknown. Recovery stopped.",
        )
      // Renewal with the exact secret identity proves ownership without breaking another lease.
      try {
        await azure("storage", "blob", "lease", "renew", ...args, "--lease-id", ownership.lease)
        result = JSON.stringify(ownership.lease)
      } catch (error) {
        if (!staleLeaseError(error)) throw error
        ui.notice?.(
          "warning",
          `Saved ownership of the lease at ${account}/${container}/${blob} is out of date; this installer no longer holds it. The lease was not changed. Continuing with guarded lock recovery.`,
        )
      }
    }
  }
  const proposed = ownership.lease ?? randomUUID()
  while (result === undefined) {
    await recoverLease(context, account, container, blob)
    await ownership.save(proposed)
    try {
      result = await azure(
        "storage",
        "blob",
        "lease",
        "acquire",
        ...args,
        "--lease-duration",
        "-1",
        "--proposed-lease-id",
        proposed,
      )
      break
    } catch (error) {
      if (
        (error instanceof CommandExecutionError && error.aborted) ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        throw error
      ui.notice?.(
        "error",
        `Could not acquire the lease at ${account}/${container}/${blob}. No lease was broken by this acquisition attempt. Check access and whether another deployment or retained lease owns it; follow the installation recovery guide before retrying.\n${error instanceof Error ? error.message : "Lease acquisition failed."}`,
      )
      if (!ui.select) throw error
      const choice = await ui.select("The deployment lock could not be acquired.", [
        { label: "Recheck and retry lock acquisition", value: "retry" },
        { label: "Exit and keep saved progress", value: "exit" },
      ])
      if (choice === "exit") throw error
      if (choice !== "retry") throw new Error("Choose a supported lock recovery action.")
    }
  }
  const lease: unknown = JSON.parse(result)
  if (typeof lease !== "string" || !lease)
    throw new Error("Azure did not return an installation lease.")
  if (lease !== proposed)
    throw new Error("Azure returned a different lease identity. Ownership was not verified.")
  let released = false
  return {
    get held() {
      return !released
    },
    async verify() {
      if (released) throw new Error("The owned lease is no longer held.")
      await azure("storage", "blob", "lease", "renew", ...args, "--lease-id", lease)
    },
    async deleteBlob(remove: (args: string[]) => Promise<unknown> = (args) => azure(...args)) {
      if (released) throw new Error("The owned lease is no longer held.")
      await remove([
        "storage",
        "blob",
        "delete",
        "--account-name",
        account,
        "--container-name",
        container,
        "--name",
        blob,
        "--auth-mode",
        "login",
        "--lease-id",
        lease,
      ])
      released = true
    },
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
