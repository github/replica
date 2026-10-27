import type { GitHubUserProfile } from "#server/integrations/github/create-user-auth-client/types"
import type { Prisma } from "../../../generated/prisma/client.ts"
import type { GitHubRepositoryPermission, MappedGitHubPermission } from "../map-permission/index.ts"

export interface GitHubAdmissionBaseline extends MappedGitHubPermission {
  repositorySourceId: string
  rawPermission: GitHubRepositoryPermission
  confirmedAt: Date
}

export interface GitHubPrototypeBaseline {
  role: NonNullable<MappedGitHubPermission["prototypeRole"]>
  repositorySourceId: string
  githubRepositoryId: string
  rawPermission: GitHubRepositoryPermission
  confirmedAt: Date
  synchronizationStatus: string
}

export interface GitHubAuthorizationService {
  evaluateAdmission(profile: GitHubUserProfile): Promise<GitHubAdmissionBaseline | null>
  saveAdmissionBaseline(
    database: Prisma.TransactionClient,
    userId: string,
    baseline: GitHubAdmissionBaseline,
  ): Promise<void>
  prototypeBaseline(
    database: Prisma.TransactionClient,
    userId: string,
    prototypeId: string,
    now?: Date,
  ): Promise<GitHubPrototypeBaseline | null>
  listRepositories(sessionToken: string): Promise<unknown[]>
  linkRepository(sessionToken: string, input: unknown): Promise<unknown>
  updateRepository(
    sessionToken: string,
    repositorySourceId: string,
    input: unknown,
  ): Promise<unknown>
  unlinkRepository(sessionToken: string, repositorySourceId: string): Promise<void>
  reconcileRepository(sessionToken: string, repositorySourceId: string): Promise<unknown>
  reconcileDue(): Promise<void>
  processWebhook(input: {
    deliveryId: string
    event: string
    signature: string
    body: Buffer
  }): Promise<"accepted" | "duplicate" | "ignored">
}
