export interface GitHubCredentials {
  appId: string
  clientId: string
  clientSecret: string
  privateKey: string
}

export interface IdentityState {
  generation: number
  encryptedCredentials: string | null
}

export interface HubUser {
  id: string
  provider: string
  providerId: string
  login: string
  name: string | null
  avatarUrl: string | null
  administrator: boolean
}

export interface HubSession {
  id: string
  userId: string
  tokenDigest: string
  signedInAt: Date
  freshAuthorizedAt: Date | null
  credentialRevision: string
}

export interface OAuthAttempt {
  id: string
  stateDigest: string
  browserDigest: string
  verifier: string
  generation: number
  credentialRevision: string
  purpose: "sign-in" | "verify" | "enroll"
  sessionId: string | null
  expiresAt: Date
}

export interface AuditInput {
  event: string
  actorId: string | null
  sessionId: string | null
}

export interface IdentityRecords {
  state(): Promise<IdentityState>
  saveCredentials(encryptedCredentials: string): Promise<void>
  advanceGeneration(): Promise<void>
  user(id: string): Promise<HubUser | null>
  githubUser(providerId: string): Promise<HubUser | null>
  saveUser(profile: GitHubProfile): Promise<HubUser>
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

export interface CredentialProvider {
  name: "database" | "environment"
  read(state: IdentityState): GitHubCredentials | null
  encrypt?: (credentials: GitHubCredentials) => string
}

export interface GitHubProfile {
  providerId: string
  login: string
  name: string | null
  avatarUrl: string | null
}

export type RepositoryPermission = "none" | "read" | "write" | "admin"

export interface GitHubIdentityClient {
  authorize(credentials: GitHubCredentials, state: string, verifier: string): string
  identify(credentials: GitHubCredentials, code: string, verifier: string): Promise<GitHubProfile>
  admitted(credentials: GitHubCredentials, profile: GitHubProfile): Promise<boolean>
  permission(
    credentials: GitHubCredentials,
    profile: GitHubProfile,
    owner: string,
    repository: string,
  ): Promise<RepositoryPermission>
}

export interface IdentitySettings {
  origin: string
  bootstrapSecret: string | undefined
  secureCookies: boolean
}

export interface IdentityContext {
  user: HubUser
  session: HubSession
  csrfToken: string
}

export interface IdentityService {
  setup(secret: string, input: unknown): Promise<void>
  start(input: {
    purpose: OAuthAttempt["purpose"]
    token?: string
    csrfToken?: string
    bootstrapSecret?: string
  }): Promise<{ url: string; browserToken: string }>
  complete(code: string, state: string, browserToken: string): Promise<{ token?: string }>
  current(token: string): Promise<IdentityContext>
  signOut(token: string, csrfToken: string): Promise<void>
  permission(token: string, owner: string, repository: string): Promise<RepositoryPermission>
  rotate(token: string, csrfToken: string, input: unknown): Promise<void>
  revoke(token: string, csrfToken: string, confirmed: boolean): Promise<void>
  audits(token: string): ReturnType<IdentityRecords["audits"]>
  denied(token: string, code: string): Promise<void>
}
