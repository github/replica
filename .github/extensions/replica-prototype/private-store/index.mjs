import { randomBytes } from "node:crypto"
import { mkdir, readFile, rename, rm, rmdir, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { setTimeout } from "node:timers/promises"
import { readErrorCode } from "../read-error-code/index.mjs"
export function createPrivateStore(directory) {
  async function prepare() {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    if (((await stat(directory)).mode & 0o077) !== 0)
      throw new Error("Canvas credential directory is not private.")
  }
  async function read(name) {
    await prepare()
    try {
      const file = path.join(directory, name)
      if (((await stat(file)).mode & 0o077) !== 0)
        throw new Error("Canvas credential file is not private.")
      return JSON.parse(await readFile(file, "utf8"))
    } catch (error) {
      if (readErrorCode(error) === "ENOENT") return null
      throw error
    }
  }
  async function remove(name) {
    try {
      await unlink(path.join(directory, name))
    } catch (error) {
      if (readErrorCode(error) !== "ENOENT") throw error
    }
  }
  return {
    read,
    remove,
    async write(name, value) {
      await prepare()
      const temporary = `.${randomBytes(16).toString("hex")}.tmp`
      try {
        await writeFile(path.join(directory, temporary), JSON.stringify(value), {
          mode: 0o600,
          flag: "wx",
        })
        await rename(path.join(directory, temporary), path.join(directory, name))
      } finally {
        await remove(temporary)
      }
    },
    async lock(name, action) {
      await prepare()
      const lock = path.join(directory, `${name}.lock`)
      const deadline = Date.now() + 35_000
      while (true) {
        try {
          await mkdir(lock, { mode: 0o700 })
          break
        } catch (error) {
          if (readErrorCode(error) !== "EEXIST") throw error
        }
        await recoverLock(lock)
        if (Date.now() >= deadline)
          throw new Error("Another canvas is updating this connection. Try again shortly.")
        await setTimeout(50)
      }
      try {
        await writeFile(path.join(lock, "owner"), String(process.pid), {
          mode: 0o600,
        })
        return await action()
      } finally {
        await releaseLock(lock)
      }
    },
  }
}
async function releaseLock(lock) {
  try {
    await unlink(path.join(lock, "owner"))
  } catch (error) {
    if (readErrorCode(error) !== "ENOENT") throw error
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await rmdir(lock)
      return
    } catch (error) {
      if (readErrorCode(error) !== "ENOTEMPTY" || attempt >= 20) throw error
      await setTimeout(50)
    }
  }
}
async function recoverLock(lock) {
  try {
    const observed = await stat(lock)
    let abandoned
    try {
      const owner = Number(await readFile(path.join(lock, "owner"), "utf8"))
      if (!Number.isSafeInteger(owner) || owner <= 0) {
        abandoned = Date.now() - (await stat(path.join(lock, "owner"))).mtimeMs > 60_000
      } else {
        try {
          process.kill(owner, 0)
          abandoned = false
        } catch (error) {
          if (readErrorCode(error) !== "ESRCH") throw error
          abandoned = true
        }
      }
    } catch (error) {
      if (readErrorCode(error) !== "ENOENT") throw error
      abandoned = Date.now() - (await stat(lock)).mtimeMs > 60_000
    }
    if (!abandoned) return
    // Only one process can recover an abandoned lock; a live owner is never evicted.
    const reaper = path.join(lock, "reaper")
    try {
      await mkdir(reaper)
    } catch (error) {
      if (readErrorCode(error) !== "EEXIST") throw error
      if (Date.now() - (await stat(reaper)).mtimeMs > 60_000) await rmdir(reaper)
      return
    }
    if ((await stat(lock)).ino !== observed.ino) {
      await rmdir(path.join(lock, "reaper"))
      return
    }
    const retired = `${lock}.${randomBytes(16).toString("hex")}`
    await rename(lock, retired)
    await rm(retired, { recursive: true })
  } catch (error) {
    if (readErrorCode(error) !== "ENOENT" && readErrorCode(error) !== "EEXIST") throw error
  }
}
