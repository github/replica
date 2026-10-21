import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { runCommand } from "../run-command/index.mjs"
export async function captureReviewRevision(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "replica-review-"))
  const env = { ...process.env, GIT_INDEX_FILE: path.join(directory, "index") }
  const config = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"]
  async function git(args, optional = false) {
    const result = await runCommand("git", [...config, ...args], context.repositoryPath, { env })
    if (!result.ok && !(optional && result.exitCode === 1))
      throw new Error(`Could not capture the local review revision: ${result.error}`)
    if (typeof result.stdout !== "string")
      throw new Error("Git did not return output while capturing the local review revision.")
    return { ...result, stdout: result.stdout }
  }
  try {
    // Snapshotting must not execute repository-defined clean filters or filter processes.
    const filters = await git(
      ["config", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|process|required)$"],
      true,
    )
    for (const key of filters.stdout.trim().split("\n").filter(Boolean)) {
      config.push("-c", `${key}=${key.endsWith(".required") ? "false" : ""}`)
    }
    const head = (await git(["rev-parse", "HEAD"])).stdout.trim()
    const branch = (await git(["branch", "--show-current"])).stdout.trim()
    const headTree = (await git(["rev-parse", "HEAD^{tree}"])).stdout.trim()
    if (!/^[0-9a-f]{40}$/.test(head) || !branch)
      throw new Error("Open a committed, named branch before commenting.")
    await git(["read-tree", head])
    const files = (
      await git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    ).stdout
      .split("\0")
      .filter(Boolean)
    for (let offset = 0; offset < files.length; offset += 100) {
      const attributes = (
        await git([
          "--literal-pathspecs",
          "check-attr",
          "-z",
          "filter",
          "--",
          ...files.slice(offset, offset + 100),
        ])
      ).stdout.split("\0")
      for (let index = 2; index < attributes.length; index += 3) {
        if (!["unspecified", "unset"].includes(attributes[index] ?? ""))
          throw new Error("Local review revisions do not support Git clean filters.")
      }
    }
    const submodules = await git([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--ignore-submodules=none",
      "--name-only",
      "-z",
      "--diff-filter=M",
      head,
      "--",
    ])
    const changedPaths = new Set(submodules.stdout.split("\0"))
    const entries = (await git(["ls-files", "--stage", "-z"])).stdout
    if (
      entries
        .split("\0")
        .some(
          (entry) =>
            entry.startsWith("160000 ") && changedPaths.has(entry.slice(entry.indexOf("\t") + 1)),
        )
    )
      throw new Error("Commit or discard submodule changes before commenting on this preview.")
    await git(["add", "--all", "--", "."])
    const treeSha = (await git(["write-tree"])).stdout.trim()
    const currentHead = (await git(["rev-parse", "HEAD"])).stdout.trim()
    const currentBranch = (await git(["branch", "--show-current"])).stdout.trim()
    const remaining = await git(
      ["diff", "--no-ext-diff", "--no-textconv", "--quiet", "--ignore-submodules=none"],
      true,
    )
    const untracked = (await git(["ls-files", "--others", "--exclude-standard"])).stdout
    if (currentHead !== head || currentBranch !== branch || !remaining.ok || untracked)
      throw new Error("The checkout changed while capturing this review revision. Try again.")
    if (!/^[0-9a-f]{40}$/.test(treeSha))
      throw new Error("Could not verify the local review source tree.")
    return { treeSha, commitSha: head, clean: treeSha === headTree }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
