import { createHash } from "node:crypto"
import { normalizeBranch, resolveRepository } from "../create-canvas-context/index.mjs"
import { runCommand } from "../run-command/index.mjs"
export async function capturePublishTarget(context) {
  const [head, branch, repository, origin, pushOrigin] = await Promise.all([
    runCommand("git", ["rev-parse", "HEAD"], context.repositoryPath),
    runCommand("git", ["branch", "--show-current"], context.repositoryPath),
    resolveRepository(context.target.repository, context.repositoryPath),
    runCommand("git", ["remote", "get-url", "--all", "origin"], context.repositoryPath),
    runCommand("git", ["remote", "get-url", "--push", "--all", "origin"], context.repositoryPath),
  ])
  if (!branch.ok || !branch.stdout.trim())
    throw new Error("Open a named branch before requesting publication.")
  const branchName = await normalizeBranch(
    branch.stdout.replace(/\r?\n$/, ""),
    context.repositoryPath,
  )
  if (!branchName) throw new Error("Open a named branch before requesting publication.")
  if (
    context.target.branch != null &&
    (await normalizeBranch(context.target.branch, context.repositoryPath)) !== branchName
  ) {
    throw new Error("The canvas branch no longer matches the current checkout. Refresh it first.")
  }
  const commitSha = head.ok && /^[0-9a-f]{40}$/.test(head.stdout.trim()) ? head.stdout.trim() : null
  if (!commitSha) throw new Error("The current checkout commit could not be verified.")
  return {
    repository,
    branch: branchName,
    commitSha,
    originFingerprint: origin.ok ? createHash("sha256").update(origin.stdout).digest("hex") : null,
    pushFingerprint: pushOrigin.ok
      ? createHash("sha256").update(pushOrigin.stdout).digest("hex")
      : null,
  }
}
export function sameCheckout(left, right) {
  return (
    left?.repository === right.repository &&
    left?.branch === right.branch &&
    left?.originFingerprint === right.originFingerprint &&
    left?.pushFingerprint === right.pushFingerprint
  )
}
export function samePublishTarget(left, right) {
  return sameCheckout(left, right) && left != null && left.commitSha === right.commitSha
}
export async function continuesPublishTarget(context, original, current) {
  if (!original) return false
  if (!sameCheckout(original, current)) return false
  if (samePublishTarget(original, current)) return true
  if (!/^[0-9a-f]{40}$/.test(original.commitSha)) return false
  const ancestor = await runCommand(
    "git",
    ["merge-base", "--is-ancestor", original.commitSha, current.commitSha],
    context.repositoryPath,
  )
  if (!ancestor.ok && ancestor.exitCode !== 1)
    throw new Error("The publication commit ancestry could not be verified.")
  return ancestor.ok
}
