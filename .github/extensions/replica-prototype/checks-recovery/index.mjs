import { execFile } from "node:child_process"
import { chmod, rm } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execute = promisify(execFile)

export async function recoverPrototypeCheck(record, directory, run = execute) {
  if (
    !/^[a-f0-9-]{36}$/.test(record.runId) ||
    !Number.isSafeInteger(record.ownerPid) ||
    record.ownerPid <= 0 ||
    !["command", "agent"].includes(record.runner)
  )
    throw new Error("Saved check ownership is invalid. Reset saved results explicitly.")
  try {
    process.kill(record.ownerPid, 0)
    throw Object.assign(
      new Error("Checks are active in another provider. Use its canvas or close it first."),
      { code: "checks_owner_active" },
    )
  } catch (error) {
    if (error.code !== "ESRCH") throw error
  }
  if (record.runner === "command" && record.status === "running") {
    const container = `replica-check-${record.runId}`
    let label
    let exists = true
    try {
      const result = await run(
        "docker",
        ["inspect", "--format", '{{index .Config.Labels "replica.checks.run"}}', container],
        { timeout: 10000 },
      )
      label = result.stdout.trim()
    } catch (error) {
      if (!error.stderr?.includes("No such object") && !error.stderr?.includes("No such container"))
        throw error
      exists = false
    }
    if (exists) {
      if (label !== record.runId)
        throw new Error("The interrupted container's ownership does not match.")
      await run("docker", ["rm", "--force", container], { timeout: 10000 })
    }
  }
  const owned = path.join(directory, record.runId)
  await chmod(path.join(owned, "snapshot"), 0o755).catch((error) => {
    if (error.code !== "ENOENT") throw error
  })
  await rm(owned, { recursive: true, force: true })
}
