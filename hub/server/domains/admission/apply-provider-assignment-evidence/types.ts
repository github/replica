import type { AdmissionRepositories } from "../run-admission-transaction/types.ts"

export interface ApplyProviderAssignmentEvidenceInput {
  assignmentSubject: string | null
  externalIdentityId: string
  providerRevisionId: string
  role: "MEMBER" | "ADMINISTRATOR" | null
  userId: string
}

export interface ApplyProviderAssignmentEvidenceDependencies {
  createId(): string
  deferSessionEnd?: boolean
  markNoRepositoryAccess?: boolean
  repositories: AdmissionRepositories
}

export type ApplyProviderAssignmentEvidenceResult =
  | {
      denied: false
      membershipId: string
      role: "MEMBER" | "ADMINISTRATOR"
    }
  | {
      denied: true
      reason: "authority_missing" | "membership_inactive" | "membership_missing"
    }
