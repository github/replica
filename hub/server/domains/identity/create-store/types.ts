import type { IdentityState } from "#server/repositories/identity-state/types"
import type { OAuthAttempt } from "#server/repositories/oauth-attempts/types"
import type { AuditInput } from "#server/repositories/security-audits/types"
import type { HubSession } from "#server/repositories/sessions/types"
import type { GitHubUserInput, HubUser } from "#server/repositories/users/types"

export interface IdentityRecords {
  state(): Promise<IdentityState>
  saveCredentials(encryptedCredentials: string): Promise<void>
  advanceGeneration(): Promise<void>
  user(id: string): Promise<HubUser | null>
  githubUser(providerId: string): Promise<HubUser | null>
  saveUser(profile: GitHubUserInput): Promise<HubUser>
  enroll(userId: string): Promise<HubUser>
  session(tokenDigest: string): Promise<(HubSession & { user: HubUser }) | null>
  sessionById(id: string): Promise<(HubSession & { user: HubUser }) | null>
  createSession(input: Omit<HubSession, "id">): Promise<HubSession>
  verifySession(id: string, at: Date, credentialRevision: string): Promise<void>
  invalidateFreshness(): Promise<void>
  deleteSession(id: string): Promise<void>
  deleteSessions(): Promise<void>
  createAttempt(input: Omit<OAuthAttempt, "id">): Promise<void>
  consumeAttempt(stateDigest: string): Promise<OAuthAttempt | null>
  audit(input: AuditInput): Promise<void>
  audits(): Promise<(AuditInput & { id: string; createdAt: Date })[]>
}

export interface IdentityStore {
  read: IdentityRecords
  lock<T>(operation: (records: IdentityRecords) => Promise<T>): Promise<T>
}
