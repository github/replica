import { chmod, rm } from "node:fs/promises"
import path from "node:path"

export async function recoverPrototypeCheck(record, directory) {
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
  const owned = path.join(directory, record.runId)
  await chmod(path.join(owned, "snapshot"), 0o755).catch((error) => {
    if (error.code !== "ENOENT") throw error
  })
  await rm(owned, { recursive: true, force: true })
}
