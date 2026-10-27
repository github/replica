import type { AuthenticationProviderInput } from "#server/repositories/authentication-providers/types"
import type { AuthorizationAttempt } from "#server/repositories/authorization-attempts/types"
import type {
  ExternalIdentityInput,
  HubExternalIdentity,
} from "#server/repositories/external-identities/types"
import type { GitHubIntegrationState } from "#server/repositories/github-integration-state/types"
import type {
  InstallationMembershipInput,
  InstallationMembershipRecord,
} from "#server/repositories/installation-memberships/types"
import type { AuditInput } from "#server/repositories/security-audits/types"
import type { HubSession } from "#server/repositories/sessions/types"
import type { HubUser, UserInput } from "#server/repositories/users/types"

export interface AuthenticationProviderRevisionRecord {
  id: string
  authenticationProviderId: string
  revision: number
  issuer: string
  configuration: unknown
  authenticationProvider: {
    id: string
    key: string
    type: string
    enabled: boolean
  }
}

export interface SessionContext extends HubSession {
  user: HubUser
  externalIdentity: HubExternalIdentity
  authenticationProviderRevision: AuthenticationProviderRevisionRecord
}

export interface IdentityRecords {
  githubIntegrationState(): Promise<GitHubIntegrationState>
  saveGitHubIntegrationCredentials(encryptedCredentials: string): Promise<void>
  advanceGitHubIntegrationGeneration(): Promise<void>
  user(id: string): Promise<HubUser | null>
  createUser(input: UserInput): Promise<HubUser>
  externalIdentity(
    provider: string,
    issuer: string,
    subject: string,
  ): Promise<(HubExternalIdentity & { user: HubUser }) | null>
  saveExternalIdentity(
    input: ExternalIdentityInput,
  ): Promise<HubExternalIdentity & { user: HubUser }>
  membership(userId: string): Promise<InstallationMembershipRecord | null>
  saveMembership(input: InstallationMembershipInput): Promise<InstallationMembershipRecord>
  createAuthenticationProviderRevision(
    input: AuthenticationProviderInput,
  ): Promise<AuthenticationProviderRevisionRecord>
  session(tokenDigest: string): Promise<SessionContext | null>
  sessionById(id: string): Promise<SessionContext | null>
  createSession(input: Omit<HubSession, "id">): Promise<HubSession>
  verifySession(id: string, at: Date): Promise<void>
  invalidateFreshness(): Promise<void>
  deleteSession(id: string): Promise<void>
  deleteSessions(): Promise<void>
  createAuthorizationAttempt(input: Omit<AuthorizationAttempt, "id">): Promise<void>
  consumeAuthorizationAttempt(stateDigest: string): Promise<AuthorizationAttempt | null>
  audit(input: AuditInput): Promise<void>
  audits(): Promise<(AuditInput & { id: string; createdAt: Date })[]>
}

export interface IdentityStore {
  read: IdentityRecords
  lock<T>(operation: (records: IdentityRecords) => Promise<T>): Promise<T>
}
