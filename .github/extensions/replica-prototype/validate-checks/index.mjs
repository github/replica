import { lstat, realpath } from "node:fs/promises"
import path from "node:path"

import { ChecksConfigError, validateChecksConfig } from "../checks-config/index.mjs"
import { readChecksFile, validateChecksConfigFiles } from "../checks-config/files.mjs"
import { runCommand } from "../run-command/index.mjs"
import { plainText } from "../validate-controls/index.mjs"

const FILE = ".replica/checks.json"

export async function validateChecks(repositoryPath) {
  if (!repositoryPath) throw new Error("This session has no working directory.")
  const checkout = await runCommand("git", ["rev-parse", "--show-toplevel"], repositoryPath)
  if (!checkout.ok) throw new Error(`Could not locate the checks checkout: ${checkout.error}`)
  const root = await realpath(checkout.stdout.trim())
  try {
    await lstat(path.join(root, FILE))
  } catch (error) {
    if (error.code === "ENOENT") return { status: "missing", file: FILE, issues: [] }
    throw error
  }
  try {
    const source = await readChecksFile(root, FILE, 8 * 1024 * 1024)
    let document
    try {
      document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source))
    } catch {
      throw new ChecksConfigError("Checks configuration must be valid UTF-8 JSON.")
    }
    await validateChecksConfigFiles(validateChecksConfig(document), root)
  } catch (error) {
    if (!(error instanceof ChecksConfigError) && !["ENOENT", "ELOOP"].includes(error.code))
      throw error
    const issues =
      error instanceof ChecksConfigError
        ? error.issues
        : [
            {
              path: "/",
              message: "Checks configuration disappeared while reading it or is a symbolic link.",
            },
          ]
    return {
      status: "invalid",
      file: FILE,
      issues: issues.map((issue) => ({
        path: plainText(issue.path, 256) || "/",
        message: plainText(issue.message, 500),
      })),
    }
  }
  return { status: "valid", file: FILE, issues: [] }
}
