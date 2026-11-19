import { z } from "zod"

import {
  GitHubInstallationHttpError,
  type GitHubInstallationClient,
} from "../create-installation-client/index.ts"
import { GitHubProviderRequestError } from "../errors.ts"
import {
  githubBranchName,
  githubCommitSha,
  githubId,
  githubRepositoryPath,
  installationBranch,
} from "../hosted-build-evidence.ts"
import type { GitHubRepositoryEvidence } from "../types.ts"

const pageSize = 100
const maxPages = 20
const repositorySchema = z.object({
  id: githubId,
  full_name: z.string(),
  default_branch: githubBranchName,
})
const branchesSchema = z
  .array(z.object({ name: githubBranchName, commit: z.object({ sha: githubCommitSha }) }))
  .max(pageSize)
const refSchema = z.object({
  ref: z.string(),
  object: z.object({ type: z.literal("commit"), sha: githubCommitSha }),
})
const comparisonSchema = z.object({
  base_commit: z.object({ sha: githubCommitSha }),
  merge_base_commit: z.object({ sha: githubCommitSha }),
  status: z.enum(["ahead", "behind", "diverged"]),
})

export async function readHostedBranchHeads(
  client: GitHubInstallationClient,
  repository: GitHubRepositoryEvidence,
  observed: ReadonlyMap<string, { deleted: boolean; internal: boolean; head: string | null }>,
) {
  const path = githubRepositoryPath(repository.nameWithOwner)
  async function confirmRepository() {
    const result = await client.get(path, repositorySchema)
    if (
      result.id !== repository.githubRepositoryId ||
      result.full_name.toLowerCase() !== repository.nameWithOwner.toLowerCase() ||
      result.default_branch !== repository.defaultBranch
    ) {
      throw new GitHubProviderRequestError()
    }
  }

  async function exactHead(branch: string) {
    const ref = `heads/${branch.split("/").map(encodeURIComponent).join("/")}`
    try {
      const result = await client.get(`${path}/git/ref/${ref}`, refSchema)
      if (result.ref !== `refs/heads/${branch}`) throw new GitHubProviderRequestError()
      return result.object.sha
    } catch (error) {
      if (!(error instanceof GitHubInstallationHttpError) || error.status !== 404 || error.limited)
        throw error
      return null // The caller confirms repository identity/readability before accepting absence.
    }
  }

  await confirmRepository()
  const heads = new Map<string, string>()
  for (let page = 1; ; page += 1) {
    const branches = await client.get(
      `${path}/branches?per_page=${pageSize}&page=${page}`,
      branchesSchema,
    )
    for (const { name, commit } of branches) {
      if (heads.has(name)) throw new GitHubProviderRequestError()
      heads.set(name, commit.sha)
    }
    if (branches.length < pageSize) break
    if (page === maxPages) throw new GitHubProviderRequestError()
  }
  heads.delete(installationBranch)

  const retiredToResume = new Set<string>()
  for (const [branch, previous] of observed) {
    if (branch === installationBranch || previous.internal || branch === repository.defaultBranch)
      continue
    if (!previous.deleted && !heads.has(branch)) {
      const sha = await exactHead(branch)
      if (sha) heads.set(branch, sha)
    } else if (previous.deleted && heads.has(branch)) {
      const head = await exactHead(branch)
      if (!head) {
        heads.delete(branch)
        continue
      }
      heads.set(branch, head)
      const base = previous.head
      if (!base) continue
      if (head === base) {
        retiredToResume.add(branch)
        continue
      }
      const comparison = await client.get(`${path}/compare/${base}...${head}`, comparisonSchema)
      const mergeBase = comparison.merge_base_commit.sha
      if (
        comparison.base_commit.sha !== base ||
        (comparison.status === "ahead") !== (mergeBase === base) ||
        (comparison.status === "behind") !== (mergeBase === head)
      ) {
        throw new GitHubProviderRequestError()
      }
      if (comparison.status === "ahead") retiredToResume.add(branch)
    }
  }
  await confirmRepository()
  return { heads, retiredToResume }
}
