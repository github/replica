import { createHash } from "node:crypto"
import { homedir } from "node:os"
import path from "node:path"
import { createPrivateStore } from "../private-store/index.mjs"
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
  function name({ repository, branch }) {
    if (typeof repository !== "string" || !repository)
      throw new Error("A verified repository is required for publishing preferences.")
    if (typeof branch !== "string" || !branch)
      throw new Error("A verified branch is required for publishing preferences.")
    return `${createHash("sha256")
      .update(JSON.stringify([repository.toLowerCase(), branch]))
      .digest("hex")}.json`
  }
  return {
    async read(target) {
      const value = await store.read(name(target))
      if (value === null) return false
      if (typeof value !== "boolean") throw new Error("Invalid saved publishing preference.")
      return value
    },
    async write(target, remember) {
      if (typeof remember !== "boolean") throw new Error("Invalid publishing preference.")
      await store.write(name(target), remember)
    },
  }
}
