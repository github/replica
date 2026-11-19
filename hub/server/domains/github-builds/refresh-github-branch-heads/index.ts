import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { recordGitHubBranchHeads } from "../../../repositories/github-builds/record-github-branch-heads/index.ts"
import { listGitHubBranchIdentities } from "../../../repositories/prototypes/list-github-branch-identities/index.ts"

/** Checks continuity outside locks, then records heads only for the captured owners. */
export async function refreshGitHubBranchHeads(
  {
    database,
    listBranchHeads,
    isAncestor,
  }: {
    database: PrismaClient
    listBranchHeads: (
      githubRepositoryId: number,
    ) => Promise<{ branchName: string; commitSha: string }[]>
    isAncestor: (githubRepositoryId: number, base: string, head: string) => Promise<boolean>
  },
  githubRepositoryId: number,
) {
  const observed = await listGitHubBranchIdentities(database, githubRepositoryId)
  const observedAt = new Date()
  const heads = await listBranchHeads(githubRepositoryId)
  const failures: Error[] = []
  for (const head of heads) {
    try {
      const owner = observed.get(head.branchName) ?? null
      let resumeRetired = false
      if (owner?.branchDeletedAt && owner.retiredHeadSha) {
        resumeRetired =
          owner.retiredHeadSha === head.commitSha ||
          (await isAncestor(githubRepositoryId, owner.retiredHeadSha, head.commitSha))
      }
      await recordGitHubBranchHeads(database, {
        githubRepositoryId,
        heads: [{ ...head, observed: owner, resumeRetired }],
        observedAt,
      })
    } catch (error) {
      failures.push(new Error(`Could not refresh branch ${head.branchName}.`, { cause: error }))
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "GitHub branch head refresh failed.")
}
