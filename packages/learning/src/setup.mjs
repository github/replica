import { execFile } from "node:child_process"
import { constants, lstatSync } from "node:fs"
import { mkdir, open } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { isIgnoredByGit, prepareLocalLearningStore } from "./config.mjs"
import { LearningError } from "./errors.mjs"
import { NO_FOLLOW } from "./providers/files.mjs"

const SCRIPT = fileURLToPath(new URL("../bin/replica-learning.mjs", import.meta.url))
const ACTOR = /^agent:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const MCP_CONFIG = ".replica/learning-mcp.json"

/**
 * Sets up local learning mode in a prototype checkout, so a person can ask their agent
 * to do it. It keeps .replica/ out of Git and writes a private MCP config there. The
 * config holds this machine's paths, so it stays out of the shared .mcp.json.
 *
 * @param {{
 *   cwd: string,
 *   actor?: string,
 *   sdkInstalled?: () => Promise<boolean>,
 * }} options
 */
export async function setupLocalLearning({
  cwd,
  actor = "agent:copilot-cli",
  sdkInstalled = hasSdk,
}) {
  if (!ACTOR.test(actor))
    throw new LearningError("invalid_input", "--actor must look like agent:copilot-cli.")
  let root
  try {
    const { stdout } = await promisify(execFile)("git", ["-C", cwd, "rev-parse", "--show-toplevel"])
    root = stdout.trim()
  } catch {
    throw new LearningError(
      "invalid_input",
      `${cwd} is not a Git checkout. Run setup inside the prototype's checkout.`,
    )
  }
  if (!(await sdkInstalled()))
    throw new LearningError(
      "invalid_input",
      `The MCP server needs @modelcontextprotocol/sdk. Run npm ci in ${path.dirname(path.dirname(SCRIPT))}, then run setup again.`,
    )

  const steps = []
  // Ignoring a path doesn't stop Git committing files it already tracks there.
  const { stdout: tracked } = await promisify(execFile)("git", [
    "-C",
    root,
    "ls-files",
    "--",
    ".replica",
  ])
  if (tracked.trim())
    throw new LearningError(
      "invalid_input",
      "Git already tracks files in .replica/. Run git rm -r --cached .replica, commit that, then run setup again.",
    )
  const ignored = await isIgnoredByGit(root, ".replica", { directory: true })
  if (ignored === null)
    throw new LearningError("invalid_input", "Git could not say whether it ignores .replica/.")
  if (!ignored) {
    await appendToGitignore(root)
    if (!(await isIgnoredByGit(root, ".replica", { directory: true })))
      throw new LearningError(
        "invalid_input",
        "Git still commits .replica/ after adding it to .gitignore. Remove the rule that keeps it, then run setup again.",
      )
    steps.push("Added .replica/ to .gitignore so your chats are never committed.")
  }

  const directory = path.join(root, ".replica")
  await mkdir(directory, { mode: 0o700, recursive: true })
  // A cloned repository could commit a link here, so the config must be our own file.
  if (!lstatSync(directory).isDirectory())
    throw new LearningError("invalid_input", `${directory} is not a directory.`)
  const prepared = await prepareLocalLearningStore(root)
  if (prepared.localRepository)
    steps.push("Gave this checkout a local ID, because it has no GitHub repository.")
  if (prepared.jsonLines)
    steps.push("Chose JSON Lines storage, so local Hub can share it from a container.")
  const file = path.join(root, MCP_CONFIG)
  const config = {
    mcpServers: {
      "replica-learning": {
        type: "local",
        command: process.execPath,
        args: [SCRIPT, "mcp", "--actor", actor],
        cwd: root,
      },
    },
  }
  const handle = await open(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | NO_FOLLOW,
    0o600,
  )
  try {
    await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`)
  } finally {
    await handle.close()
  }
  steps.push(`Wrote ${MCP_CONFIG} for ${actor}.`)

  // Server instructions can't be allowed for one server, and the tool descriptions
  // already say when to call each tool, so the command trusts no other servers.
  const command = `copilot --additional-mcp-config @${MCP_CONFIG}`
  return { root, config: file, command, steps }
}

/**
 * Adds .replica/ to the checkout's own .gitignore. A cloned repository could commit
 * .gitignore as a link, so setup refuses anything but a plain file and never follows
 * a link while writing.
 */
async function appendToGitignore(root) {
  const gitignore = path.join(root, ".gitignore")
  const handle = await open(
    gitignore,
    constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | NO_FOLLOW,
    0o644,
  ).catch((error) => {
    if (error.code === "ELOOP" || error.code === "EISDIR")
      throw new LearningError("invalid_input", `${gitignore} is not a plain file.`)
    throw error
  })
  try {
    const stats = await handle.stat()
    if (!stats.isFile() || stats.nlink !== 1)
      throw new LearningError("invalid_input", `${gitignore} is not a plain file.`)
    const current = await handle.readFile("utf8")
    await handle.write(`${current && !current.endsWith("\n") ? "\n" : ""}.replica/\n`)
  } finally {
    await handle.close()
  }
}

async function hasSdk() {
  try {
    await import("@modelcontextprotocol/sdk/server/stdio.js")
    return true
  } catch {
    return false
  }
}
