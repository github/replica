import { spawn } from "node:child_process"
import { readErrorCode } from "../read-error-code/index.mjs"
// Agent skill directories hold local tooling, not prototype source, so they never make a
// prototype checkout "changed". Every other path counts because it cannot be classified safely.
export const LOCAL_SKILL_DIRECTORIES = [".github/skills/", ".agents/skills/", ".claude/skills/"]
export const MAX_LISTED_CHANGES = 20
export async function readWorkingTreeChanges(repositoryPath, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    const changes = createChangeCollector()
    const child = spawn("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd: repositoryPath,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let timedOut = false
    let stderr = ""
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => changes.add(chunk))
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-16_384)
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      resolve({
        state: "unavailable",
        error: readErrorCode(error) === "ENOENT" ? "git is not installed." : error.message,
      })
    })
    child.on("close", (code, signal) => {
      clearTimeout(timer)
      if (timedOut) {
        resolve({
          state: "unavailable",
          error:
            "Checking local changes took too long. Retry the check or publish the committed version only.",
        })
      } else if (code !== 0) {
        resolve({
          state: "unavailable",
          error: stderr.trim() || `Git status failed (${signal ?? code}).`,
        })
      } else {
        resolve(changes.finish())
      }
    })
  })
}
export function classifyWorkingTreeChanges(porcelain) {
  const changes = createChangeCollector()
  changes.add(porcelain)
  return changes.finish()
}
function createChangeCollector() {
  const files = { paths: [], total: 0 }
  const localSkills = { paths: [], total: 0 }
  let pending = ""
  let renamedPath = null
  function record(paths) {
    const list = paths.every(isLocalSkillPath) ? localSkills : files
    list.total++
    if (list.paths.length < MAX_LISTED_CHANGES) list.paths.push(paths[0])
  }
  function consume(entry) {
    if (renamedPath !== null) {
      record([renamedPath, entry])
      renamedPath = null
      return
    }
    if (entry.length < 4) return
    const path = entry.slice(3)
    if (/[RC]/.test(entry.slice(0, 2))) renamedPath = path
    else record([path])
  }
  return {
    add(chunk) {
      pending += chunk
      let separator
      let start = 0
      while ((separator = pending.indexOf("\0", start)) !== -1) {
        consume(pending.slice(start, separator))
        start = separator + 1
      }
      pending = pending.slice(start)
    },
    finish() {
      if (pending) consume(pending)
      if (renamedPath !== null) record([renamedPath, ""])
      return { state: files.total ? "changed" : "clean", files, localSkills }
    },
  }
}
function isLocalSkillPath(path) {
  return LOCAL_SKILL_DIRECTORIES.some((directory) => path.startsWith(directory))
}
