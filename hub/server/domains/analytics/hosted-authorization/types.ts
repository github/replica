import type { Prisma } from "../../../generated/prisma/client.ts"
import type { StartAuthenticationProofResult } from "../../authentication/start-authentication-proof/types.ts"
import type {
  ImmutableIdentityEvidence,
  AuthenticationProofResult,
} from "../../authentication/types.ts"

export interface RepositoryAnalyticsProof {
  secureCookie: boolean
  callbackIssuer?: string
  checkRateLimit(
    operation: "start" | "callback",
    subjectDigest: string,
  ): Promise<{ allowed: boolean; auditFailed: boolean }>
  start(
    save: (
      tx: Prisma.TransactionClient,
      attempt: { id: string; providerRevisionId: string; sessionRevocationRevision: number },
    ) => Promise<void>,
  ): Promise<StartAuthenticationProofResult>
  complete(
    input: { browserBinding: string; code: string; state: string },
    match: (
      evidence: ImmutableIdentityEvidence & { authorizationAttemptId: string },
    ) => Promise<{ externalIdentityId: string; userId: string }>,
  ): Promise<AuthenticationProofResult>
}

export type LiveRepositoryPermission = (
  viewer: {
    membershipId: string
    sessionProvider: string | null
    externalIdentityId?: string | null
    role: "MEMBER" | "ADMINISTRATOR"
  },
  repositoryId: string,
) => Promise<"none" | "read" | "triage" | "write" | "maintain" | "admin">
