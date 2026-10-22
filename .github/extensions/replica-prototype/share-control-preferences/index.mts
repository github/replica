import { createHash } from "node:crypto"
import { homedir } from "node:os"
import path from "node:path"

import { createPrivateStore } from "../private-store/index.mjs"

export type ShareControlPreferences = ReturnType<typeof createShareControlPreferences>

export function createShareControlPreferences(
  directory = path.join(
    process.env.COPILOT_HOME || path.join(homedir(), ".copilot"),
    "extensions",
    "replica-prototype",
    "artifacts",
    "share-control-settings",
  ),
) {
  const store = createPrivateStore(directory)
  function name(identity: string) {
    return `${createHash("sha256").update(identity).digest("hex")}.json`
  }
  return {
    async read(identity: string) {
      const included = await store.read(name(identity))
      if (included === null) return false
      if (typeof included !== "boolean") throw new Error("Invalid saved share preference.")
      return included
    },
    async write(identity: string, included: unknown) {
      if (typeof included !== "boolean") throw new Error("Invalid share preference.")
      await store.write(name(identity), included)
    },
  }
}
