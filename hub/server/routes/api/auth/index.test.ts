import { once } from "node:events"
import { createHash, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../create-app"
import { admitAuthenticationProof } from "../../../domains/admission/admit-authentication-proof"
import { AdmissionDeniedError } from "../../../domains/admission/errors"
import type { AdmissionRepositories } from "../../../domains/admission/run-admission-transaction/types"
import { createGitHubRepositoryDenialNotice } from "../../../domains/authentication/create-github-repository-denial-notice"
import { AuthenticationProofError } from "../../../domains/authentication/errors"
import { readGitHubRepositoryDenialNotice } from "../../../domains/authentication/read-github-repository-denial-notice"
import { startAuthenticationProof } from "../../../domains/authentication/start-authentication-proof"
import type { StartAuthenticationProofDependencies } from "../../../domains/authentication/start-authentication-proof/types"
import { createGitHubUserAuthenticationAdapter } from "../../../integrations/github/create-user-authentication-adapter"
import { createLogger } from "../../../integrations/pino/create-logger"
import type { AuthenticationRouteDependencies } from "./types"

function routeDependencies() {
  const encryptionKey = Buffer.alloc(32, 1)
  const checkRateLimit = vi.fn().mockResolvedValue({ allowed: true, auditFailed: false })
  const startSignIn = vi.fn()
  const startEnrollment = vi.fn()
  const endSession = vi.fn()
  const completeProof = vi.fn()
  const verifyAdministratorAuthorization = vi.fn().mockResolvedValue(true)
  const admitSession = vi.fn()
  const restoreSession = vi.fn()
  const verifyBootstrapSecret = vi.fn().mockReturnValue(false)
  const dependencies: AuthenticationRouteDependencies = {
    github: {
      signIn: {
        applicationOrigin: "http://127.0.0.1:5173",
        checkRateLimit,
        secureCookie: false,
        start: startSignIn,
      },
      administratorEnrollment: {
        applicationOrigin: "http://127.0.0.1:5173",
        checkRateLimit,
        secureCookie: false,
        start: startEnrollment,
        verifyBootstrapSecret,
        writeBootstrapDenial: vi.fn().mockResolvedValue(undefined),
      },
      callback: {
        callbackIssuer: "https://github.com/login/oauth",
        checkRateLimit,
        createGitHubRepositoryDenialNotice: (login) =>
          createGitHubRepositoryDenialNotice(login, encryptionKey),
        secureCookie: false,
        complete: completeProof,
        verifyAdministratorAuthorization,
        admit: admitSession,
      },
    },
    currentSession: {
      readGitHubRepositoryDenialNotice: (value) =>
        readGitHubRepositoryDenialNotice(value, encryptionKey),
      restore: restoreSession,
    },
    signOut: {
      applicationOrigin: "http://127.0.0.1:5173",
      secureCookie: false,
      end: endSession,
    },
  }
  return {
    dependencies,
    admitSession,
    checkRateLimit,
    completeProof,
    endSession,
    restoreSession,
    startEnrollment,
    startSignIn,
    verifyAdministratorAuthorization,
    verifyBootstrapSecret,
  }
}

async function withServer(
  authentication: AuthenticationRouteDependencies,
  operation: (baseUrl: string) => Promise<void>,
  options: Parameters<typeof createApp>[0] = {},
) {
  const server = createServer(createApp({ ...options, authentication }))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const { port } = server.address() as AddressInfo
    await operation(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

describe("authenticationRoutes()", () => {
  it("reports only the explicitly configured provider routes", async () => {
    const { dependencies } = routeDependencies()
    dependencies.entra = dependencies.github
    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/providers`)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ providers: ["github", "entra"] })
    })
  })

  it("rejects a start from a different origin before provider work", async () => {
    const { dependencies, checkRateLimit, startSignIn } = routeDependencies()
    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/github/start`, {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      })

      expect(response.status).toBe(403)
      expect(checkRateLimit).not.toHaveBeenCalled()
      expect(startSignIn).not.toHaveBeenCalled()
    })
  })

  it.each([
    ["retry", "", null],
    ["switch accounts", "switch_account=true", "select_account"],
  ])("starts a GitHub %s with the requested account choice", async (_label, body, prompt) => {
    const { dependencies, checkRateLimit } = routeDependencies()
    const publicConfiguration = {
      authorizationEndpoint: "https://github.com/login/oauth/authorize",
      callbackUri: "https://hub.example.test/api/auth/github/callback",
      clientId: "client-id",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      userEndpoint: "https://api.github.com/user",
    }
    const proofDependencies: StartAuthenticationProofDependencies = {
      adapter: createGitHubUserAuthenticationAdapter({
        clientSecret: "client-secret",
        publicConfiguration,
      }),
      callbackUri: publicConfiguration.callbackUri,
      configurationDigest: "a".repeat(64),
      expectedRevision: 1,
      createAttempt: vi.fn().mockResolvedValue({ expiresAt: new Date(Date.now() + 600_000) }),
      createId: randomUUID,
      createOpaqueValue: () => "x".repeat(32),
      deleteExpiredArtifacts: vi.fn().mockResolvedValue(undefined),
      encryptCodeVerifier: () => "encrypted-verifier",
      encryptNonce: () => "encrypted-nonce",
      getAuthenticationProofState: vi.fn().mockResolvedValue({
        selectedProviderRevision: {
          configurationDigest: "a".repeat(64),
          id: randomUUID(),
          revision: 1,
        },
        sessionRevocationRevision: 0,
      }),
      writeDenialAudit: vi.fn(),
    }
    dependencies.github!.signIn.start = (input) =>
      startAuthenticationProof(
        { purpose: "SIGN_IN", switchAccount: input?.switchAccount },
        proofDependencies,
      )

    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/github/start`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: dependencies.github!.signIn.applicationOrigin,
        },
        body,
        redirect: "manual",
      })

      expect(response.status).toBe(303)
      const location = new URL(response.headers.get("location")!)
      expect(location.origin + location.pathname).toBe(publicConfiguration.authorizationEndpoint)
      expect(location.searchParams.get("prompt")).toBe(prompt)
      expect(response.headers.get("set-cookie")).toContain("hub_auth_browser=")
      expect(checkRateLimit).toHaveBeenCalledOnce()
    })
  })

  it("checks the origin before a switch-account request reaches the rate limiter", async () => {
    const { dependencies, checkRateLimit, startSignIn } = routeDependencies()
    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/github/start`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://attacker.example",
        },
        body: "switch_account=true",
      })

      expect(response.status).toBe(403)
      expect(checkRateLimit).not.toHaveBeenCalled()
      expect(startSignIn).not.toHaveBeenCalled()
    })
  })

  it("rate-limits a switch-account request before starting authentication", async () => {
    const { dependencies, checkRateLimit, startSignIn } = routeDependencies()
    checkRateLimit.mockResolvedValue({ allowed: false, auditFailed: false })
    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/github/start`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: dependencies.github!.signIn.applicationOrigin,
        },
        body: "switch_account=true",
      })

      expect(response.status).toBe(429)
      expect(checkRateLimit).toHaveBeenCalledOnce()
      expect(startSignIn).not.toHaveBeenCalled()
    })
  })

  it.each([
    ["an invalid value", "switch_account=false"],
    ["duplicate values", "switch_account=true&switch_account=false"],
    ["an unexpected field", "switch_account=true&unexpected=value"],
  ])("rejects %s in a switch-account request", async (_description, body) => {
    const { dependencies, checkRateLimit, startSignIn } = routeDependencies()
    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/github/start`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: dependencies.github!.signIn.applicationOrigin,
        },
        body,
      })

      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(500)
      expect(checkRateLimit).toHaveBeenCalledOnce()
      expect(startSignIn).not.toHaveBeenCalled()
    })
  })

  it("does not treat an unparsed switch-account request as an ordinary retry", async () => {
    const { dependencies, startSignIn } = routeDependencies()
    startSignIn.mockResolvedValue({
      authorizationUrl: "https://github.com/login/oauth/authorize",
      browserBinding: "b".repeat(32),
      expiresAt: new Date(Date.now() + 600_000),
    })
    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/github/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: dependencies.github!.signIn.applicationOrigin,
        },
        body: JSON.stringify({ switch_account: "invalid" }),
        redirect: "manual",
      })

      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(500)
      expect(startSignIn).not.toHaveBeenCalled()
    })
  })

  it.each([
    ["uppercase malformed", "/API/AUTH/GITHUB/START", "{malformed"],
    ["mixed-case oversized", "/Api/Auth/GitHub/Start", JSON.stringify("x".repeat(150_000))],
  ])(
    "rejects %s JSON by origin before parsing the authentication body",
    async (_name, path, body) => {
      const { dependencies, checkRateLimit, startSignIn } = routeDependencies()
      await withServer(dependencies, async (baseUrl) => {
        const response = await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        })

        expect(response.status).toBe(403)
        expect(checkRateLimit).not.toHaveBeenCalled()
        expect(startSignIn).not.toHaveBeenCalled()
      })
    },
  )

  it("rate-limits an enrollment before parsing its secret", async () => {
    const { dependencies, checkRateLimit, startEnrollment, verifyBootstrapSecret } =
      routeDependencies()
    checkRateLimit.mockResolvedValue({ allowed: false, auditFailed: false })
    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/github/admin-enrollment/start`, {
        method: "POST",
        headers: {
          origin: dependencies.github!.administratorEnrollment.applicationOrigin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "bootstrap_secret=payload-secret",
      })

      expect(response.status).toBe(429)
      expect(verifyBootstrapSecret).not.toHaveBeenCalled()
      expect(startEnrollment).not.toHaveBeenCalled()
    })
  })

  it.each(["github", "entra"] as const)(
    "redirects a native %s enrollment form after an invalid secret",
    async (provider) => {
      const { dependencies, startEnrollment, verifyBootstrapSecret } = routeDependencies()
      dependencies.entra = dependencies.github
      await withServer(dependencies, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/auth/${provider}/admin-enrollment/start`, {
          method: "POST",
          headers: {
            accept: "text/html,application/xhtml+xml",
            origin: dependencies[provider]!.administratorEnrollment.applicationOrigin,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: "bootstrap_secret=wrong-secret",
          redirect: "manual",
        })

        expect(response.status).toBe(303)
        expect(response.headers.get("location")).toBe("/admin-enrollment?authentication=denied")
        expect(verifyBootstrapSecret).toHaveBeenCalledWith("wrong-secret")
        expect(startEnrollment).not.toHaveBeenCalled()
      })
    },
  )

  it.each(["github", "entra"] as const)(
    "returns a JSON denial for an invalid %s enrollment secret",
    async (provider) => {
      const { dependencies, startEnrollment, verifyBootstrapSecret } = routeDependencies()
      dependencies.entra = dependencies.github
      await withServer(dependencies, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/auth/${provider}/admin-enrollment/start`, {
          method: "POST",
          headers: {
            accept: "application/json",
            origin: dependencies[provider]!.administratorEnrollment.applicationOrigin,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: "bootstrap_secret=wrong-secret",
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
          error: "Administrator enrollment was denied.",
        })
        expect(verifyBootstrapSecret).toHaveBeenCalledWith("wrong-secret")
        expect(startEnrollment).not.toHaveBeenCalled()
      })
    },
  )

  it("uses the trusted proxy address only when the exact hop count is configured", async () => {
    const { dependencies, checkRateLimit } = routeDependencies()
    await withServer(
      dependencies,
      async (baseUrl) => {
        await fetch(`${baseUrl}/api/auth/github/start`, {
          method: "POST",
          headers: {
            origin: dependencies.github!.signIn.applicationOrigin,
            "x-forwarded-for": "203.0.113.7",
          },
          redirect: "manual",
        })

        expect(checkRateLimit).toHaveBeenCalledWith(
          "start",
          createHash("sha256").update("start:203.0.113.7").digest("hex"),
        )
      },
      { trustedProxyHops: 1 },
    )
  })

  it("suppresses callback query and cookie values and disables response storage", async () => {
    const { dependencies } = routeDependencies()
    const records: string[] = []
    const logger = createLogger({
      destination: { write: (line) => records.push(line) },
    })

    await withServer(
      dependencies,
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/auth/github/callback?code=callback-code-secret&state=short`,
          {
            headers: { cookie: "hub_auth_browser=browser-binding-secret" },
            redirect: "manual",
          },
        )

        expect(response.status).toBe(303)
        expect(response.headers.get("cache-control")).toBe("no-store")
        await vi.waitFor(() => expect(records).toHaveLength(1))
        expect(records[0]).not.toMatch(/callback-code-secret|browser-binding-secret|state/)
      },
      { logger },
    )
  })

  it("rejects a malformed browser-binding cookie before proof completion", async () => {
    const { dependencies, completeProof } = routeDependencies()
    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/auth/github/callback?code=provider-code&state=${"s".repeat(32)}`,
        {
          headers: { cookie: "hub_auth_browser=x" },
          redirect: "manual",
        },
      )

      expect(response.status).toBe(303)
      expect(response.headers.get("location")).toBe("/?authentication=denied")
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
      expect(completeProof).not.toHaveBeenCalled()
    })
  })

  it.each([
    ["a verified login", "octocat"],
    ["no verified login", undefined],
  ])("redirects a no-access denial with %s and no new session", async (_label, login) => {
    const { dependencies, completeProof, admitSession } = routeDependencies()
    const repositoryAccess: [] = []
    completeProof.mockResolvedValue({
      purpose: "SIGN_IN",
      githubLogin: login,
      proof: {
        authorizationAttemptId: "00000000-0000-4000-8000-000000000010",
        externalIdentityId: "00000000-0000-4000-8000-000000000012",
      },
      repositoryAccess,
    })
    admitSession.mockRejectedValue(
      new AdmissionDeniedError("no_repository_access", "00000000-0000-4000-8000-000000000012"),
    )

    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/auth/github/callback?code=provider-code&state=${"s".repeat(32)}`,
        {
          headers: { cookie: `hub_auth_browser=${"b".repeat(32)}` },
          redirect: "manual",
        },
      )

      expect(response.status).toBe(303)
      const location = new URL(response.headers.get("location")!, baseUrl)
      expect(location.pathname).toBe("/signed-in/no-access")
      expect(location.hash).toBe("")
      const noticeCookie = response.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("hub_github_repository_denial="))
      if (login) {
        expect(noticeCookie).toContain("HttpOnly")
        expect(noticeCookie).not.toContain(login)
        const cookie = noticeCookie!.split(";", 1)[0]!
        const notice = await fetch(`${baseUrl}/api/auth/session?explain_no_repository_access=1`, {
          headers: { cookie },
        })
        expect(notice.status).toBe(401)
        expect(await notice.json()).toMatchObject({ login, reason: "no_repository_access" })
        const ordinarySession = await fetch(`${baseUrl}/api/auth/session`, {
          headers: { cookie },
        })
        expect(await ordinarySession.json()).toEqual({ authenticated: false })
        const forgedNotice = await fetch(
          `${baseUrl}/api/auth/session?explain_no_repository_access=1`,
          { headers: { cookie: "hub_github_repository_denial=somebody-else" } },
        )
        expect(await forgedNotice.json()).toEqual({ authenticated: false })
      } else {
        expect(noticeCookie).toBeUndefined()
      }
      expect(admitSession).toHaveBeenCalledWith(expect.objectContaining({ repositoryAccess }))
      expect(response.headers.get("set-cookie")).not.toContain("hub_session=")
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
    })
  })

  it.each([
    {
      label: "a first-time GitHub user",
      assignments: [],
      hasMembership: false,
      independentlyAuthorized: false,
    },
    {
      label: "a GitHub member with no remaining authority",
      assignments: [],
      hasMembership: true,
      independentlyAuthorized: false,
    },
    {
      label: "an independent administrator",
      assignments: [{ id: "independent", role: "ADMINISTRATOR", source: "HUB_ADMINISTRATOR" }],
      hasMembership: true,
      independentlyAuthorized: true,
    },
    {
      label: "an independent Entra member",
      assignments: [{ id: "independent", role: "MEMBER", source: "AUTHENTICATION_PROVIDER" }],
      hasMembership: true,
      independentlyAuthorized: false,
    },
  ])(
    "handles a verified GitHub sign-in with no repository grants for $label",
    async ({ assignments, hasMembership, independentlyAuthorized }) => {
      const { dependencies, completeProof } = routeDependencies()
      const providerRevisionId = randomUUID()
      const membershipId = randomUUID()
      const records = {
        claimProviderEvidence: vi.fn().mockResolvedValue("created"),
        createMembership: vi.fn(),
        createProviderAssignment: vi.fn(),
        createBootstrapAssignment: vi.fn(),
        createHubSession: vi
          .fn()
          .mockResolvedValue({ expiresAt: new Date(Date.now() + 3_600_000) }),
        createOrRestoreMembership: vi.fn(),
        createSecurityAudit: vi.fn().mockResolvedValue(undefined),
        recordRepositoryAccess: vi.fn().mockResolvedValue(undefined),
        endProviderAssignment: vi.fn(),
        endOpenHubSessionsForMembership: vi.fn().mockResolvedValue([]),
        lockActiveAssignments: vi.fn().mockResolvedValue(assignments),
        lockActiveProviderAssignment: vi.fn().mockResolvedValue(null),
        lockAttempt: vi.fn().mockResolvedValue({
          bootstrapSecretDigest: null,
          consumedAt: new Date(),
          createdAt: new Date(),
          providerRevisionId,
          purpose: "SIGN_IN",
          sessionRevocationRevision: 0,
        }),
        getExternalIdentity: vi
          .fn()
          .mockResolvedValue({ provider: "github", userId: randomUUID() }),
        lockGitHubRepositoryAccess: vi.fn().mockResolvedValue({ revision: 0, changedAt: null }),
        hasDisconnectedRepositories: vi.fn().mockResolvedValue(false),
        lockMembership: vi
          .fn()
          .mockResolvedValue(hasMembership ? { id: membershipId, lifecycle: "ACTIVE" } : null),
        lockProvider: vi
          .fn()
          .mockResolvedValue({ enabled: true, selectedRevisionId: providerRevisionId }),
        lockRevocation: vi.fn().mockResolvedValue({ revision: 0 }),
      } satisfies AdmissionRepositories
      completeProof.mockResolvedValue({
        githubLogin: "octocat",
        proof: { authorizationAttemptId: randomUUID(), externalIdentityId: randomUUID() },
        purpose: "SIGN_IN",
        providerAssignment: {
          assignmentSubject: "github_repository_access",
          issuedAt: new Date(),
          providerRevisionId,
          role: null,
        },
        repositoryAccess: [],
      })
      dependencies.github!.callback.admit = (input) =>
        admitAuthenticationProof(
          {
            ...input,
            providerKey: "github",
            requiresProviderAssignmentEvidence: true,
            sessionLifetimeSeconds: 3_600,
          },
          {
            createId: randomUUID,
            getBootstrapSecretDigest: () => "f".repeat(64),
            runTransaction: (operation) => operation(records),
            writeAudit: vi.fn(),
          },
        )

      await withServer(dependencies, async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/auth/github/callback?code=provider-code&state=${"s".repeat(32)}`,
          {
            headers: { cookie: `hub_auth_browser=${"b".repeat(32)}` },
            redirect: "manual",
          },
        )

        expect(response.status).toBe(303)
        if (independentlyAuthorized) {
          expect(new URL(response.headers.get("location")!, baseUrl).pathname).not.toBe(
            "/signed-in/no-access",
          )
        } else {
          expect(new URL(response.headers.get("location")!, baseUrl).pathname).toBe(
            "/signed-in/no-access",
          )
          expect(response.headers.get("set-cookie")).not.toContain("hub_session=")
          expect(records.createHubSession).not.toHaveBeenCalled()
        }
      })
    },
  )

  it("accepts GitHub's exact callback issuer parameter", async () => {
    const { dependencies, completeProof, admitSession } = routeDependencies()
    completeProof.mockResolvedValue({
      proof: {
        authorizationAttemptId: "attempt-id",
        externalIdentityId: "identity-id",
      },
    })
    admitSession.mockResolvedValue({ expiresAt: new Date("2030-01-01T00:00:00Z") })
    const state = "s".repeat(32)
    const browserBinding = "b".repeat(32)

    await withServer(dependencies, async (baseUrl) => {
      const callback = new URL("/api/auth/github/callback", baseUrl)
      callback.searchParams.set("code", "provider-code")
      callback.searchParams.set("state", state)
      callback.searchParams.set("iss", "https://github.com/login/oauth")
      const response = await fetch(callback, {
        headers: { cookie: `hub_auth_browser=${browserBinding}` },
        redirect: "manual",
      })

      expect(response.headers.get("location")).toBe("/?authentication=success")
      expect(completeProof).toHaveBeenCalledWith({
        browserBinding,
        code: "provider-code",
        state,
      })
    })
  })

  it("continues fresh administrator authorization without issuing a new Hub session", async () => {
    const { admitSession, completeProof, dependencies, verifyAdministratorAuthorization } =
      routeDependencies()
    const sensitiveAuthorizationId = "00000000-0000-4000-8000-000000000020"
    completeProof.mockResolvedValue({
      purpose: "ADMINISTRATOR_MANAGEMENT",
      sensitiveAuthorizationId,
      proof: {
        authorizationAttemptId: "00000000-0000-4000-8000-000000000010",
        externalIdentityId: "00000000-0000-4000-8000-000000000012",
      },
    })

    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/auth/github/callback?code=provider-code&state=${"s".repeat(32)}`,
        {
          headers: {
            cookie: `hub_auth_browser=${"b".repeat(32)}; hub_session=retained-session`,
          },
          redirect: "manual",
        },
      )

      expect(response.status).toBe(303)
      expect(response.headers.get("location")).toBe(
        `/settings/administrators/confirm?authorizationId=${sensitiveAuthorizationId}`,
      )
      expect(verifyAdministratorAuthorization).toHaveBeenCalledWith({
        authorizationAttemptId: "00000000-0000-4000-8000-000000000010",
        externalIdentityId: "00000000-0000-4000-8000-000000000012",
        providerAssignment: undefined,
        sessionDigest: createHash("sha256").update("retained-session").digest("hex"),
        sensitiveAuthorizationId,
      })
      expect(admitSession).not.toHaveBeenCalled()
      expect(response.headers.get("set-cookie")).not.toContain("hub_session=")
    })
  })

  it("denies fresh administrator authorization without the current Hub session cookie", async () => {
    const { admitSession, completeProof, dependencies, verifyAdministratorAuthorization } =
      routeDependencies()
    completeProof.mockResolvedValue({
      purpose: "ADMINISTRATOR_MANAGEMENT",
      sensitiveAuthorizationId: "00000000-0000-4000-8000-000000000020",
      proof: {
        authorizationAttemptId: "00000000-0000-4000-8000-000000000010",
        externalIdentityId: "00000000-0000-4000-8000-000000000012",
      },
    })

    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/auth/github/callback?code=provider-code&state=${"s".repeat(32)}`,
        {
          headers: { cookie: `hub_auth_browser=${"b".repeat(32)}` },
          redirect: "manual",
        },
      )

      expect(response.status).toBe(303)
      expect(response.headers.get("location")).toBe("/?authentication=denied")
      expect(verifyAdministratorAuthorization).not.toHaveBeenCalled()
      expect(admitSession).not.toHaveBeenCalled()
      expect(response.headers.get("set-cookie")).not.toContain("hub_session=")
    })
  })

  it("rejects an unexpected callback issuer before proof completion", async () => {
    const { dependencies, completeProof } = routeDependencies()
    await withServer(dependencies, async (baseUrl) => {
      const callback = new URL("/api/auth/github/callback", baseUrl)
      callback.searchParams.set("code", "provider-code")
      callback.searchParams.set("state", "s".repeat(32))
      callback.searchParams.set("iss", "https://attacker.example")
      const response = await fetch(callback, {
        headers: { cookie: `hub_auth_browser=${"b".repeat(32)}` },
        redirect: "manual",
      })

      expect(response.headers.get("location")).toBe("/?authentication=denied")
      expect(completeProof).not.toHaveBeenCalled()
    })
  })

  it("preserves a successful Hub session when a replay denial response arrives last", async () => {
    const { dependencies, completeProof, admitSession } = routeDependencies()
    completeProof
      .mockResolvedValueOnce({
        proof: {
          authorizationAttemptId: "attempt-id",
          externalIdentityId: "identity-id",
        },
      })
      .mockRejectedValueOnce(
        new AuthenticationProofError("attempt_invalid", "The attempt was already consumed."),
      )
    admitSession.mockResolvedValue({
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    })
    const state = "s".repeat(32)
    const browserBinding = "b".repeat(32)
    let activeSession = "existing-session"

    await withServer(dependencies, async (baseUrl) => {
      const success = await fetch(
        `${baseUrl}/api/auth/github/callback?code=provider-code&state=${state}`,
        {
          headers: { cookie: `hub_auth_browser=${browserBinding}; hub_session=${activeSession}` },
          redirect: "manual",
        },
      )
      const issued = success.headers.get("set-cookie")?.match(/hub_session=([^;,]+)/)?.[1]
      expect(success.headers.get("location")).toBe("/?authentication=success")
      expect(issued).toBeTruthy()
      activeSession = issued!

      const denial = await fetch(
        `${baseUrl}/api/auth/github/callback?code=replayed-code&state=${state}`,
        {
          headers: { cookie: `hub_auth_browser=${browserBinding}; hub_session=${activeSession}` },
          redirect: "manual",
        },
      )
      const denialCookies = denial.headers.get("set-cookie") ?? ""
      expect(denial.headers.get("location")).toBe("/?authentication=denied")
      expect(denialCookies).toContain("hub_auth_browser=")
      expect(denialCookies).not.toContain("hub_session=")
      expect(activeSession).toBe(issued)
    })
  })

  it("preserves a new session when an older restore denial arrives last", async () => {
    const { dependencies, completeProof, admitSession, restoreSession } = routeDependencies()
    let finishOldRestore!: (value: null) => void
    restoreSession.mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          finishOldRestore = resolve
        }),
    )
    completeProof.mockResolvedValueOnce({
      proof: {
        authorizationAttemptId: "attempt-id",
        externalIdentityId: "identity-id",
      },
    })
    admitSession.mockResolvedValueOnce({ expiresAt: new Date("2030-01-01T00:00:00Z") })

    await withServer(dependencies, async (baseUrl) => {
      const oldRestore = fetch(`${baseUrl}/api/auth/session`, {
        headers: { cookie: "hub_session=expired-session" },
      })
      await vi.waitFor(() => expect(restoreSession).toHaveBeenCalledOnce())

      const success = await fetch(
        `${baseUrl}/api/auth/github/callback?code=provider-code&state=${"s".repeat(32)}`,
        {
          headers: { cookie: `hub_auth_browser=${"b".repeat(32)}` },
          redirect: "manual",
        },
      )
      const issued = success.headers.get("set-cookie")?.match(/hub_session=([^;,]+)/)?.[1]
      expect(issued).toBeTruthy()

      finishOldRestore(null)
      const staleDenial = await oldRestore
      expect(staleDenial.status).toBe(401)
      expect(staleDenial.headers.get("set-cookie")).toBeNull()

      restoreSession.mockResolvedValueOnce({
        membershipId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        provider: "github",
        login: "octocat",
        name: "The Octocat",
        role: "ADMINISTRATOR",
      })
      const current = await fetch(`${baseUrl}/api/auth/session`, {
        headers: { cookie: `hub_session=${issued}` },
      })
      expect(current.status).toBe(200)
      expect(await current.json()).toEqual({
        authenticated: true,
        membershipId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        provider: "github",
        login: "octocat",
        name: "The Octocat",
        role: "ADMINISTRATOR",
      })
      expect(restoreSession).toHaveBeenLastCalledWith(
        createHash("sha256").update(issued!).digest("hex"),
      )
    })
  })

  it("returns 401 without mutating an invalid retained session cookie", async () => {
    const { dependencies, restoreSession } = routeDependencies()
    restoreSession.mockResolvedValueOnce(null)

    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/session`, {
        headers: { cookie: "hub_session=invalid-retained-session" },
      })

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ authenticated: false })
      expect(response.headers.get("set-cookie")).toBeNull()
      expect(restoreSession).toHaveBeenCalledWith(
        createHash("sha256").update("invalid-retained-session").digest("hex"),
      )
    })
  })

  it.each(["octocat", null])(
    "reports a revoked GitHub session without changing its cookie (login: %s)",
    async (login) => {
      const { dependencies, restoreSession } = routeDependencies()
      restoreSession.mockResolvedValue(null)
      const findDenial = vi.fn().mockResolvedValue({ login })
      dependencies.currentSession.findGitHubRepositoryAccessDenial = findDenial

      await withServer(dependencies, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/auth/session`, {
          headers: { cookie: "hub_session=revoked-session" },
        })

        expect(response.status).toBe(401)
        expect(await response.json()).toMatchObject({
          authenticated: false,
          login,
          reason: "no_repository_access",
        })
        expect(response.headers.get("set-cookie")).toBeNull()
        expect(findDenial).toHaveBeenCalledWith(
          createHash("sha256").update("revoked-session").digest("hex"),
        )
      })
    },
  )

  it.each([
    ["no session cookie", undefined],
    ["an ordinary ended session", "hub_session=ordinary-session"],
  ])("does not label %s as repository access loss", async (_label, cookie) => {
    const { dependencies, restoreSession } = routeDependencies()
    restoreSession.mockResolvedValue(null)
    const findDenial = vi.fn().mockResolvedValue(null)
    dependencies.currentSession.findGitHubRepositoryAccessDenial = findDenial

    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/session`, {
        headers: cookie ? { cookie } : {},
      })

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ authenticated: false })
      expect(response.headers.get("set-cookie")).toBeNull()
      expect(findDenial).toHaveBeenCalledTimes(cookie ? 1 : 0)
    })
  })

  it.each([
    ["GitHub administrator", "github", "ADMINISTRATOR"],
    ["Entra member", "entra", "MEMBER"],
  ] as const)(
    "restores a current %s without a repository-loss lookup",
    async (_label, provider, role) => {
      const { dependencies, restoreSession } = routeDependencies()
      restoreSession.mockResolvedValue({
        membershipId: randomUUID(),
        userId: randomUUID(),
        provider,
        login: "member",
        name: null,
        role,
      })
      const findDenial = vi.fn().mockResolvedValue({ login: "wrong-account" })
      dependencies.currentSession.findGitHubRepositoryAccessDenial = findDenial

      await withServer(dependencies, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/auth/session`, {
          headers: { cookie: "hub_session=current-session" },
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ authenticated: true, provider, role })
        expect(findDenial).not.toHaveBeenCalled()
      })
    },
  )

  it("redirects a native sign-out form after ending and clearing the session", async () => {
    const { dependencies, endSession } = routeDependencies()
    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/session/sign-out`, {
        method: "POST",
        headers: {
          accept: "text/html,application/xhtml+xml",
          cookie: "hub_session=session-value",
          origin: dependencies.signOut.applicationOrigin,
        },
        redirect: "manual",
      })

      expect(response.status).toBe(303)
      expect(response.headers.get("location")).toBe("/")
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
      expect(endSession).toHaveBeenCalledWith(
        createHash("sha256").update("session-value").digest("hex"),
      )
    })
  })

  it("keeps API sign-out as an empty response", async () => {
    const { dependencies, endSession } = routeDependencies()
    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/session/sign-out`, {
        method: "POST",
        headers: {
          accept: "application/json",
          origin: dependencies.signOut.applicationOrigin,
        },
      })

      expect(response.status).toBe(204)
      expect(endSession).not.toHaveBeenCalled()
    })
  })

  it("rate-limits before parsing an oversized enrollment body and suppresses it from logs", async () => {
    const { dependencies, checkRateLimit, verifyBootstrapSecret } = routeDependencies()
    const records: string[] = []
    const logger = createLogger({
      destination: { write: (line) => records.push(line) },
    })
    await withServer(
      dependencies,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/auth/github/admin-enrollment/start`, {
          method: "POST",
          headers: {
            origin: dependencies.github!.administratorEnrollment.applicationOrigin,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: `bootstrap_secret=oversized-secret-${"x".repeat(5_000)}`,
        })

        expect(response.status).toBe(413)
        expect(response.headers.get("cache-control")).toBe("no-store")
        expect(checkRateLimit).toHaveBeenCalledOnce()
        expect(verifyBootstrapSecret).not.toHaveBeenCalled()
        await vi.waitFor(() => expect(records).toHaveLength(1))
        expect(records[0]).not.toContain("oversized-secret")
      },
      { logger },
    )
  })

  it("fails closed when the bootstrap rate-limit denial audit cannot be written", async () => {
    const { dependencies, checkRateLimit, verifyBootstrapSecret } = routeDependencies()
    checkRateLimit.mockResolvedValue({ allowed: false, auditFailed: true })
    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/github/admin-enrollment/start`, {
        method: "POST",
        headers: {
          origin: dependencies.github!.administratorEnrollment.applicationOrigin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "bootstrap_secret=never-parsed",
      })

      expect(response.status).toBe(429)
      expect(verifyBootstrapSecret).not.toHaveBeenCalled()
    })
  })
})
