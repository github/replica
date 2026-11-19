import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"
import { lockGitHubRepositoryAccessState } from "../../../repositories/github-repository-access-states/lock-github-repository-access-state/index.ts"
import {
  lockHostedBuildRepository,
  type HostedRepositorySnapshot,
} from "../../../repositories/hosted-builds/lock-hosted-build-repository/index.ts"
import { requireCurrentGitHubInstallation } from "../../admission/require-current-github-installation/index.ts"

export interface HostedBuildAuthority {
  database: PrismaClient
  repository: HostedRepositorySnapshot
  provider: { configurationDigest: string; revision: number }
}

export async function withHostedBuildRepository<T>(
  { database, repository, provider }: HostedBuildAuthority,
  perform: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T | null> {
  return database.$transaction(
    async (transaction) => {
      await requireCurrentGitHubInstallation(transaction, provider)
      const { revision } = await lockGitHubRepositoryAccessState(transaction)
      if (
        revision !== repository.accessRevision ||
        !(await lockHostedBuildRepository(transaction, repository))
      )
        return null
      return perform(transaction)
    },
    { maxWait: 10_000, timeout: 60_000 },
  )
}
