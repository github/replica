import { execFile } from "node:child_process"
import { readFile, readdir, realpath } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { requiredPathArgument } from "../required-path-argument/index.mjs"

const run = promisify(execFile)
const unsafeCheckout =
  "Checkout must not contain Git authentication settings or Git metadata outside the workspace. " +
  "Use actions/checkout with persist-credentials: false, including nested checkouts and submodules."

/** Rejects persisted Git authentication before repository-controlled scripts run. */
export async function validateCheckout(root: string): Promise<void> {
  root = await realpath(root)
  const pending = [{ directory: root, metadata: false }]
  const visited = new Set()

  for (let current = pending.pop(); current; current = pending.pop()) {
    const { directory, metadata } = current
    const identity = `${metadata}:${directory}`

    if (visited.has(identity)) continue
    visited.add(identity)

    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const location = path.join(directory, entry.name)
      const gitMetadata = metadata || entry.name === ".git"
      const config = metadata && ["config", "config.worktree"].includes(entry.name)

      if ((entry.name === ".git" && entry.isFile()) || (metadata && entry.name === "commondir")) {
        if (!entry.isFile()) throw new Error(unsafeCheckout)
        const content = await readFile(location, "utf8")
        const reference =
          entry.name === ".git" ? /^gitdir: (.+)\r?\n?$/.exec(content)?.[1] : content.trimEnd()

        if (!reference) throw new Error(unsafeCheckout)
        let target

        try {
          target = await realpath(path.resolve(directory, reference))
        } catch {
          throw new Error("Cannot resolve checkout Git metadata. " + unsafeCheckout)
        }

        const relative = path.relative(root, target)
        if (
          relative === ".." ||
          relative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative)
        ) {
          throw new Error(unsafeCheckout)
        }

        pending.push({ directory: target, metadata: true })
        continue
      }

      if (
        (entry.name === ".git" && !entry.isDirectory()) ||
        (metadata && entry.isSymbolicLink()) ||
        (config && !entry.isFile())
      ) {
        throw new Error(unsafeCheckout)
      }

      if (entry.isDirectory()) {
        pending.push({ directory: location, metadata: gitMetadata })
      } else if (config) {
        let output

        try {
          const result = await run("git", [
            "config",
            "--file",
            location,
            "--no-includes",
            "--null",
            "--list",
          ])
          output = result.stdout
        } catch {
          // Git's parser errors can contain credentials from the config file.
          throw new Error("Cannot safely read checkout Git configuration. " + unsafeCheckout)
        }

        for (const setting of output.split("\0").filter(Boolean)) {
          const separator = setting.indexOf("\n")
          const key = (separator < 0 ? setting : setting.slice(0, separator)).toLowerCase()

          if (
            key.startsWith("credential.") ||
            /^http\.(.*\.)?(extraheader|cookiefile)$/.test(key) ||
            /^core\.(sshcommand|askpass)$/.test(key) ||
            key === "include.path" ||
            /^includeif\..*\.path$/.test(key) ||
            /[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/i.test(setting)
          ) {
            throw new Error(unsafeCheckout)
          }
        }
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await validateCheckout(requiredPathArgument("root"))
  console.log("Checkout contains no persisted Git authentication settings.")
}
