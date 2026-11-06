import { randomUUID } from "node:crypto"
import { open, readFile, unlink } from "node:fs/promises"
import { hostname } from "node:os"

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code
}

export async function lockSession(path: string): Promise<() => Promise<void>> {
  const owner = { id: randomUUID(), pid: process.pid, host: hostname() }
  const busy = () =>
    new Error(
      `Another setup session owns ${path}. Close that session before retrying. Do not remove Azure installation or release locks.`,
    )
  const create = async (target: string) => {
    const file = await open(target, "wx", 0o600)
    try {
      await file.writeFile(JSON.stringify(owner))
      await file.sync()
    } finally {
      await file.close()
    }
  }
  try {
    await create(path)
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error
    const recovery = `${path}.recovery`
    try {
      await create(recovery)
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error
      throw new Error(
        `Local session recovery is already in progress: ${recovery}. Verify its owning process has exited before reviewing this local file; cloud leases are separate.`,
      )
    }
    try {
      let previous: unknown
      try {
        previous = JSON.parse(await readFile(path, "utf8"))
      } catch (error) {
        if (hasCode(error, "ENOENT")) {
          await create(path)
          previous = owner
        } else if (error instanceof SyntaxError) {
          throw new Error(
            `The local writer record ${path} is unreadable. Review it before retrying; it was not removed.`,
          )
        } else throw error
      }
      if (
        typeof previous !== "object" ||
        previous === null ||
        !("pid" in previous) ||
        !Number.isSafeInteger(previous.pid) ||
        Number(previous.pid) <= 0 ||
        !("host" in previous) ||
        previous.host !== owner.host
      )
        throw busy()
      if (!("id" in previous) || previous.id !== owner.id) {
        try {
          process.kill(Number(previous.pid), 0)
          throw busy()
        } catch (error) {
          if (!hasCode(error, "ESRCH")) throw error
        }
        await unlink(path)
        await create(path)
      }
    } finally {
      await unlink(recovery)
    }
  }
  return async () => {
    const current: unknown = JSON.parse(await readFile(path, "utf8"))
    if (
      typeof current !== "object" ||
      current === null ||
      !("id" in current) ||
      current.id !== owner.id
    ) {
      throw new Error(
        `Local session ownership changed: ${path}. The writer record was not removed.`,
      )
    }
    await unlink(path)
  }
}
