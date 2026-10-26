import { generateKeyPairSync, randomUUID } from "node:crypto"
import { vi } from "vitest"

import { createCredentialProvider } from "#server/domains/identity/create-credential-provider"
import { createIdentityService } from "#server/domains/identity/create-service"
import type {
  AuditInput,
  GitHubIdentityClient,
  GitHubProfile,
  HubSession,
  HubUser,
  IdentityRecords,
  IdentityState,
  IdentityStore,
  OAuthAttempt,
  RepositoryProviderName,
  SignInProviderName,
} from "#server/utils/identity-contracts/types"

export function createFixture({
  environment = false,
  demoMode = false,
  signInProviders = ["github"],
  repositoryProvider = "github",
}: {
  environment?: boolean
  demoMode?: boolean
  signInProviders?: SignInProviderName[]
  repositoryProvider?: RepositoryProviderName
} = {}) {
  let data = {
    state: { generation: 0, encryptedCredentials: null } as IdentityState,
    users: [] as HubUser[],
    sessions: [] as HubSession[],
    attempts: [] as OAuthAttempt[],
    audits: [] as (AuditInput & { id: string; createdAt: Date })[],
  }
  let failAudit = false
  let tail = Promise.resolve()
  const records: IdentityRecords = {
    state: () => Promise.resolve(structuredClone(data.state)),
    saveCredentials: (encryptedCredentials) => {
      data.state.encryptedCredentials = encryptedCredentials
      return Promise.resolve()
    },
    advanceGeneration: () => {
      data.state.generation++
      data.attempts = []
      return Promise.resolve()
    },
    user: (id) =>
      Promise.resolve(structuredClone(data.users.find((user) => user.id === id) ?? null)),
    githubUser: (providerId) =>
      Promise.resolve(
        structuredClone(
          data.users.find((user) => user.provider === "github" && user.providerId === providerId) ??
            null,
        ),
      ),
    saveUser: (profile) => {
      let user = data.users.find(
        (user) => user.provider === profile.provider && user.providerId === profile.providerId,
      )
      if (user) Object.assign(user, profile)
      else {
        user = { ...profile, id: randomUUID(), administrator: false }
        data.users.push(user)
      }
      return Promise.resolve(structuredClone(user))
    },
    administrator: () =>
      Promise.resolve(structuredClone(data.users.find((user) => user.administrator) ?? null)),
    enroll: (id) => {
      const user = data.users.find((user) => user.id === id)!
      user.administrator = true
      return Promise.resolve(structuredClone(user))
    },
    session: (digest) => {
      const session = data.sessions.find((session) => session.tokenDigest === digest)
      if (!session) return Promise.resolve(null)
      return Promise.resolve(
        structuredClone({
          ...session,
          user: data.users.find((user) => user.id === session.userId)!,
        }),
      )
    },
    sessionById: (id) => {
      const session = data.sessions.find((session) => session.id === id)
      if (!session) return Promise.resolve(null)
      return Promise.resolve(
        structuredClone({
          ...session,
          user: data.users.find((user) => user.id === session.userId)!,
        }),
      )
    },
    createSession: (input) => {
      const session = { ...input, id: randomUUID() }
      data.sessions.push(session)
      return Promise.resolve(structuredClone(session))
    },
    verifySession: (id, freshAuthorizedAt, credentialRevision) => {
      const session = data.sessions.find((session) => session.id === id)
      if (!session) throw new Error("Session no longer exists")
      Object.assign(session, { freshAuthorizedAt, credentialRevision })
      return Promise.resolve()
    },
    invalidateFreshness: () => {
      for (const session of data.sessions) session.freshAuthorizedAt = null
      return Promise.resolve()
    },
    deleteSession: (id) => {
      data.sessions = data.sessions.filter((session) => session.id !== id)
      data.attempts = data.attempts.filter((attempt) => attempt.sessionId !== id)
      return Promise.resolve()
    },
    deleteSessions: () => {
      data.sessions = []
      return Promise.resolve()
    },
    createAttempt: (input) => {
      data.attempts.push({ ...input, id: randomUUID() })
      return Promise.resolve()
    },
    consumeAttempt: (digest) => {
      const attempt = data.attempts.find((attempt) => attempt.stateDigest === digest)
      data.attempts = data.attempts.filter((attempt) => attempt.stateDigest !== digest)
      return Promise.resolve(structuredClone(attempt ?? null))
    },
    audit: (input) => {
      if (failAudit) return Promise.reject(new Error("Audit unavailable"))
      data.audits.push({ ...input, id: randomUUID(), createdAt: new Date() })
      return Promise.resolve()
    },
    audits: () => Promise.resolve(structuredClone(data.audits)),
  }
  const store: IdentityStore = {
    read: records,
    async lock(operation) {
      const previous = tail
      let release!: () => void
      tail = new Promise<void>((resolve) => {
        release = resolve
      })
      await previous
      const snapshot = structuredClone(data)
      try {
        return await operation(records)
      } catch (error) {
        data = snapshot
        throw error
      } finally {
        release()
      }
    },
  }
  const credentials = {
    appId: "12345",
    installationId: "7",
    clientId: "synthetic-client",
    clientSecret: "synthetic-secret",
    privateKey: generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    }).privateKey,
  }
  const profile: GitHubProfile = {
    providerId: "10001",
    login: "synthetic-user",
    name: null,
    avatarUrl: null,
  }
  const github = {
    validate: vi.fn<GitHubIdentityClient["validate"]>().mockResolvedValue(),
    authorize: vi.fn<GitHubIdentityClient["authorize"]>(
      () => "https://github.com/login/oauth/authorize",
    ),
    identify: vi.fn<GitHubIdentityClient["identify"]>().mockResolvedValue({ ...profile }),
    admitted: vi.fn<GitHubIdentityClient["admitted"]>().mockResolvedValue(true),
    permission: vi.fn<GitHubIdentityClient["permission"]>().mockResolvedValue("read"),
  }
  const settings = {
    origin: "https://hub.example.test",
    bootstrapSecret: "synthetic-bootstrap",
    secureCookies: true,
    demoMode,
    signInProviders,
    repositoryProvider,
  }
  const provider = createCredentialProvider(
    environment
      ? {
          HUB_CREDENTIAL_PROVIDER: "environment",
          GITHUB_APP_ID: credentials.appId,
          GITHUB_INSTALLATION_ID: credentials.installationId,
          GITHUB_CLIENT_ID: credentials.clientId,
          GITHUB_CLIENT_SECRET: credentials.clientSecret,
          GITHUB_PRIVATE_KEY: credentials.privateKey,
        }
      : { HUB_CREDENTIAL_KEY: "ab".repeat(32) },
  )
  let clock = new Date()
  const service = createIdentityService({
    store,
    provider,
    github,
    settings,
    now: () => new Date(clock),
  })

  async function begin(input: Parameters<typeof service.start>[0] = { purpose: "sign-in" }) {
    const result = await service.start(input)
    const [, state, verifier] = github.authorize.mock.calls.at(-1)!
    return { ...result, state, verifier }
  }
  async function signIn(purpose: "sign-in" | "enroll" = "sign-in") {
    const attempt = await begin({ purpose, bootstrapSecret: settings.bootstrapSecret })
    const result = await service.complete("synthetic-code", attempt.state, attempt.browserToken)
    if (!result.token) throw new Error("Expected a sign-in token")
    return { token: result.token, ...(await service.current(result.token)) }
  }

  return {
    service,
    store,
    github,
    provider,
    credentials,
    profile,
    settings,
    begin,
    signIn,
    snapshot: () => structuredClone(data),
    failAudit: () => {
      failAudit = true
    },
    advance: (milliseconds: number) => {
      clock = new Date(clock.getTime() + milliseconds)
    },
  }
}
