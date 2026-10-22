import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"

import { normalizeHubOrigin } from "../normalize-hub-origin/index.mjs"
import { createPrivateStore } from "../private-store/index.mjs"

export function createHubOriginStore(options = {}) {
  const directory = options.directory || path.join(os.homedir(), ".config", "replica", "canvas")
  const store = createPrivateStore(directory)

  function file(repository) {
    const key = createHash("sha256").update(repository).digest("hex")
    return `${key}.origin.json`
  }

  return {
    async read(repository) {
      if (!repository) return null
      const selection = await store.read(file(repository))
      if (!selection) return null
      if (
        !selection ||
        typeof selection !== "object" ||
        selection.repository !== repository ||
        typeof selection.origin !== "string"
      ) {
        throw new Error("Invalid stored canvas Hub selection.")
      }
      return normalizeHubOrigin(selection.origin, "Stored Hub URL")
    },
    async save(repository, value, { ifAbsent = false } = {}) {
      const origin = normalizeHubOrigin(value, "Hub URL")
      return store.lock(file(repository), async () => {
        const current = ifAbsent ? await this.read(repository) : null
        if (current) return current
        await store.write(file(repository), { repository, origin })
        return origin
      })
    },
  }
}
