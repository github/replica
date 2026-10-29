import type { AuthenticationProviderInput } from "#server/repositories/authentication-providers/types"
import type { AuthorizationAttempt } from "#server/repositories/authorization-attempts/types"
import type {
  ExternalIdentityInput,
  HubExternalIdentity,
} from "#server/repositories/external-identities/types"
import type { GitHubIntegrationCredentials } from "#server/repositories/github-integration-credentials/types"
import type {
  InstallationMembershipDetails,
  InstallationMembershipInput,
  InstallationMembershipPage,
  InstallationMembershipRecord,
} from "#server/repositories/installation-memberships/types"
import type {
  MembershipInvitationInput,
  MembershipInvitationPage,
  MembershipInvitationRecord,
} from "#server/repositories/membership-invitations/types"
import type { AuditInput, SecurityAuditRecord } from "#server/repositories/security-audits/types"
import type { HubSession } from "#server/repositories/sessions/types"
import type { HubUser, UserInput } from "#server/repositories/users/types"
import type { IdentityStoreState } from "#server/repositories/identity-store-state/types"

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
  githubIntegrationCredentials(): Promise<GitHubIntegrationCredentials>
  identityStoreState(): Promise<IdentityStoreState>
  bootstrapCompletedAt(): Promise<Date | null>
  advanceSessionGeneration(): Promise<void>
  completeBootstrap(completedAt: Date): Promise<boolean>
  saveGitHubIntegrationCredentials(encryptedCredentials: string): Promise<void>
  user(id: string): Promise<HubUser | null>
  createUser(input: UserInput): Promise<HubUser>
  updateUser(id: string, input: UserInput): Promise<HubUser>
  externalIdentity(
    provider: string,
    issuer: string,
    subject: string,
  ): Promise<(HubExternalIdentity & { user: HubUser }) | null>
  saveExternalIdentity(
    input: ExternalIdentityInput,
  ): Promise<HubExternalIdentity & { user: HubUser }>
  membership(userId: string): Promise<InstallationMembershipRecord | null>
  membershipById(id: string): Promise<InstallationMembershipDetails | null>
  memberships(cursor?: string | null): Promise<InstallationMembershipPage>
  activeAdministratorCount(): Promise<number>
  saveMembership(input: InstallationMembershipInput): Promise<InstallationMembershipRecord>
  createInvitation(input: MembershipInvitationInput): Promise<MembershipInvitationRecord>
  invitation(id: string): Promise<MembershipInvitationRecord | null>
  invitations(cursor?: string | null): Promise<MembershipInvitationPage>
  usableInvitation(
    provider: string,
    issuer: string,
    subject: string,
    now: Date,
  ): Promise<MembershipInvitationRecord | null>
  consumeInvitation(
    id: string,
    activatedIdentityId: string,
    activatedMembershipId: string,
    consumedAt: Date,
  ): Promise<boolean>
  revokeInvitation(id: string, revokedAt: Date): Promise<boolean>
  revokeExpiredInvitations(revokedAt: Date): Promise<void>
  createAuthenticationProviderRevision(
    input: AuthenticationProviderInput,
  ): Promise<AuthenticationProviderRevisionRecord>
  currentAuthenticationProviderRevision(
    key: string,
  ): Promise<AuthenticationProviderRevisionRecord | null>
  latestAuthenticationProviderRevision(
    key: string,
  ): Promise<AuthenticationProviderRevisionRecord | null>
  authenticationProviderRevision(id: string): Promise<AuthenticationProviderRevisionRecord | null>
  session(tokenDigest: string): Promise<SessionContext | null>
  sessionById(id: string): Promise<SessionContext | null>
  createSession(input: Omit<HubSession, "id">): Promise<HubSession>
  verifySession(id: string, at: Date): Promise<void>
  invalidateFreshness(): Promise<void>
  deleteSession(id: string): Promise<void>
  deleteSessions(): Promise<void>
  deleteUserSessions(userId: string): Promise<void>
  createAuthorizationAttempt(
    input: Omit<AuthorizationAttempt, "id" | "sessionGeneration"> & {
      sessionGeneration?: number
    },
  ): Promise<void>
  consumeAuthorizationAttempt(stateDigest: string): Promise<AuthorizationAttempt | null>
  audit(input: AuditInput): Promise<void>
  audits(): Promise<SecurityAuditRecord[]>
}

export interface IdentityQueries {
  githubIntegrationCredentials(): Promise<GitHubIntegrationCredentials>
  identityStoreState(): Promise<IdentityStoreState>
  user(id: string): Promise<HubUser | null>
  externalIdentity(
    provider: string,
    issuer: string,
    subject: string,
  ): Promise<(HubExternalIdentity & { user: HubUser }) | null>
  membership(userId: string): Promise<InstallationMembershipRecord | null>
  memberships(cursor?: string | null): Promise<InstallationMembershipPage>
  invitations(cursor?: string | null): Promise<MembershipInvitationPage>
  session(tokenDigest: string): Promise<SessionContext | null>
  sessionById(id: string): Promise<SessionContext | null>
  audits(): Promise<SecurityAuditRecord[]>
}

export interface IdentityStore {
  read: IdentityQueries
  lock<T>(operation: (records: IdentityRecords) => Promise<T>): Promise<T>
}
