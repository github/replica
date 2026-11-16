import { execFile } from "node:child_process"
import { access, readdir, realpath } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import type { LocalBranchHead, LocalRepository, LocalRepositoryDiscovery } from "./types.ts"

const execute = promisify(execFile)
const commitShaPattern = /^([0-9a-f]{40}|[0-9a-f]{64})$/

async function git(repositoryPath: string, arguments_: string[]) {
  const { stdout } = await execute("git", ["-C", repositoryPath, ...arguments_], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  })
  return stdout.trim()
}

async function readRepository(repositoryPath: string, name: string): Promise<LocalRepository> {
  const canonicalPath = await realpath(repositoryPath)
  const topLevel = await realpath(await git(canonicalPath, ["rev-parse", "--show-toplevel"]))
  if (topLevel !== canonicalPath) throw new Error("The child path is not a repository root.")

  const output = await git(canonicalPath, [
    "for-each-ref",
    "--format=%(refname:short)%00%(objectname)%00%(authorname)%00%(authoremail)%00%(authordate:iso-strict)",
    "refs/heads",
  ])
  const branches: LocalBranchHead[] = output
    ? output.split("\n").map((line) => {
        const [branchName, commitSha, authorName, authorEmail, authoredAt] = line.split("\0")
        if (
          !branchName ||
          !commitSha ||
          !commitShaPattern.test(commitSha) ||
          !authoredAt ||
          Number.isNaN(Date.parse(authoredAt))
        ) {
          throw new Error("Git returned an invalid branch head.")
        }
        return {
          name: branchName,
          commitSha,
          authorName: authorName || null,
          authorEmail: authorEmail?.replace(/^<|>$/g, "") || null,
          authoredAt: new Date(authoredAt),
        }
      })
    : []
  if (branches.length === 0) throw new Error("The repository has no committed branches.")

  const configuredDefault = (
    await git(canonicalPath, [
      "symbolic-ref",
      "--quiet",
      "--short",
      "refs/remotes/origin/HEAD",
    ]).catch(() => "")
  ).replace(/^origin\//, "")
  const currentBranch = await git(canonicalPath, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  ]).catch(() => "")
  const branchNames = new Set(branches.map((branch) => branch.name))
  const defaultBranch =
    [configuredDefault, "main", "master", currentBranch].find((candidate) =>
      branchNames.has(candidate),
    ) ?? branches[0]!.name

  return { path: canonicalPath, name, defaultBranch, branches }
}

export async function discoverLocalRepositories(root: string): Promise<LocalRepositoryDiscovery> {
  if (!path.isAbsolute(root)) throw new Error("The local prototype root must be absolute.")
  const canonicalRoot = await realpath(root)
  const entries = await readdir(canonicalRoot, { withFileTypes: true })
  const repositories: LocalRepository[] = []
  const failures: LocalRepositoryDiscovery["failures"] = []

  for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name))) {
    if (!entry.isDirectory()) continue
    const repositoryPath = path.join(canonicalRoot, entry.name)
    try {
      await access(path.join(repositoryPath, ".git"))
    } catch {
      continue
    }
    try {
      repositories.push(await readRepository(repositoryPath, entry.name))
    } catch (error) {
      failures.push({
        path: repositoryPath,
        errorType: error instanceof Error ? error.name : "UnknownError",
      })
    }
  }

  return { repositories, failures }
}
