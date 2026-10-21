import { spawn } from "node:child_process"
import { readErrorCode } from "../read-error-code/index.mjs"

type ChangeList = { paths: string[]; total: number }
export type WorkingTreeChanges =
  | { state: "unavailable"; error: string }
  | { state: "changed" | "clean"; files: ChangeList; localSkills: ChangeList; error?: undefined }

// Agent skill directories hold local tooling, not prototype source, so they never make a
// prototype checkout "changed". Every other path counts because it cannot be classified safely.
export const LOCAL_SKILL_DIRECTORIES = [".github/skills/", ".agents/skills/", ".claude/skills/"]
export const MAX_LISTED_CHANGES = 20

export async function readWorkingTreeChanges(
  repositoryPath: string,
  { timeoutMs = 10_000 } = {},
): Promise<WorkingTreeChanges> {
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
    child.stdout.on("data", (chunk: string) => changes.add(chunk))
    child.stderr.on("data", (chunk: string) => {
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

export function classifyWorkingTreeChanges(porcelain: string) {
  const changes = createChangeCollector()
  changes.add(porcelain)
  return changes.finish()
}

function createChangeCollector() {
  const files: ChangeList = { paths: [], total: 0 }
  const localSkills: ChangeList = { paths: [], total: 0 }
  let pending = ""
  let renamedPath: string | null = null

  function record(paths: [string, ...string[]]) {
    const list = paths.every(isLocalSkillPath) ? localSkills : files
    list.total++
    if (list.paths.length < MAX_LISTED_CHANGES) list.paths.push(paths[0])
  }

  function consume(entry: string) {
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
    add(chunk: string) {
      pending += chunk
      let separator
      let start = 0
      while ((separator = pending.indexOf("\0", start)) !== -1) {
        consume(pending.slice(start, separator))
        start = separator + 1
      }
      pending = pending.slice(start)
    },
    finish(): Extract<WorkingTreeChanges, { state: "changed" | "clean" }> {
      if (pending) consume(pending)
      if (renamedPath !== null) record([renamedPath, ""])
      return { state: files.total ? "changed" : "clean", files, localSkills }
    },
  }
}

function isLocalSkillPath(path: string) {
  return LOCAL_SKILL_DIRECTORIES.some((directory) => path.startsWith(directory))
}
