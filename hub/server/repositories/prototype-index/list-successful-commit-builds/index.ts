import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { reviewablePrototypeWhere } from "../reviewable-prototype-where/index.ts"

/**
 * Lists a repository's successful Builds of the given commits, newest first, so a score
 * recorded against a commit can point people at the Build it judged. Only prototypes
 * people can open count, so the link never leads to a hidden page.
 */
export async function listSuccessfulCommitBuilds(
  database: PrismaClient,
  input: { repository: { id: string; defaultBranch: string }; commitShas: string[] },
) {
  if (input.commitShas.length === 0) return []
  const builds = await database.build.findMany({
    where: {
      state: "successful",
      commitSha: { in: input.commitShas },
      prototype: reviewablePrototypeWhere(input.repository),
    },
    select: {
      commitSha: true,
      number: true,
      createdAt: true,
      workflowCreatedAt: true,
      prototype: { select: { id: true, name: true, branchName: true } },
    },
  })
  // Build numbers count up separately for each prototype, so only time orders them across
  // prototypes. This matches the order prototype pages use.
  builds.sort((first, second) => {
    const firstCreatedAt = (first.workflowCreatedAt ?? first.createdAt).getTime()
    const secondCreatedAt = (second.workflowCreatedAt ?? second.createdAt).getTime()
    return secondCreatedAt - firstCreatedAt || second.number - first.number
  })
  return builds.flatMap(({ commitSha, number, prototype }) =>
    commitSha
      ? [
          {
            commitSha,
            number,
            prototypeId: prototype.id,
            prototypeName: prototype.name ?? prototype.branchName,
          },
        ]
      : [],
  )
}
