import { createHash } from "node:crypto"
import { homedir } from "node:os"
import path from "node:path"

import { createPrivateStore } from "../private-store/index.mjs"

type PreferenceTarget = { repository: unknown; branch: unknown }
export type PublishPreferences = ReturnType<typeof createPublishPreferences>

export function createPublishPreferences(
  directory = path.join(
    process.env.COPILOT_HOME || path.join(homedir(), ".copilot"),
    "extensions",
    "replica-prototype",
    "artifacts",
    "publish-preferences",
  ),
) {
  const store = createPrivateStore(directory)
  function name({ repository, branch }: PreferenceTarget) {
    if (typeof repository !== "string" || !repository)
      throw new Error("A verified repository is required for publishing preferences.")
    if (typeof branch !== "string" || !branch)
      throw new Error("A verified branch is required for publishing preferences.")
    return `${createHash("sha256")
      .update(JSON.stringify([repository.toLowerCase(), branch]))
      .digest("hex")}.json`
  }
  return {
    async read(target: PreferenceTarget) {
      const value = await store.read(name(target))
      if (value === null) return false
      if (typeof value !== "boolean") throw new Error("Invalid saved publishing preference.")
      return value
    },
    async write(target: PreferenceTarget, remember: boolean) {
      if (typeof remember !== "boolean") throw new Error("Invalid publishing preference.")
      await store.write(name(target), remember)
    },
  }
}
