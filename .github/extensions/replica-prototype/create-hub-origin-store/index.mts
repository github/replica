import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"

import { normalizeHubOrigin } from "../normalize-hub-origin/index.mjs"
import { createPrivateStore } from "../private-store/index.mjs"

export type HubOriginStoreOptions = { directory?: string }

export function createHubOriginStore(options: HubOriginStoreOptions = {}) {
  const directory = options.directory || path.join(os.homedir(), ".config", "replica", "canvas")
  const store = createPrivateStore(directory)

  function file(repository: string) {
    const key = createHash("sha256").update(repository).digest("hex")
    return `${key}.origin.json`
  }

  return {
    async read(repository: string | null | undefined) {
      if (!repository) return null
      const selection = await store.read(file(repository))
      if (!selection) return null
      if (
        !selection ||
        typeof selection !== "object" ||
        !("repository" in selection) ||
        selection.repository !== repository ||
        !("origin" in selection) ||
        typeof selection.origin !== "string"
      ) {
        throw new Error("Invalid stored canvas Hub selection.")
      }
      return normalizeHubOrigin(selection.origin, "Stored Hub URL")
    },
    async save(repository: string, value: string, { ifAbsent = false } = {}): Promise<string> {
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
