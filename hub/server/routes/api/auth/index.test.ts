import { createHash, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer, request as httpRequest, type IncomingMessage } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../create-app"
import { admitAuthenticationProof } from "../../../domains/admission/admit-authentication-proof"
import {
  AdmissionDeniedError,
  AdmissionUnavailableError,
  SessionTerminationConflictError,
} from "../../../domains/admission/errors"
import type { AdmissionRepositories } from "../../../domains/admission/run-admission-transaction/types"
import { createGitHubRepositoryDenialNotice } from "../../../domains/authentication/create-github-repository-denial-notice"
import { AuthenticationProofError } from "../../../domains/authentication/errors"
import { readGitHubRepositoryDenialNotice } from "../../../domains/authentication/read-github-repository-denial-notice"
import { startAuthenticationProof } from "../../../domains/authentication/start-authentication-proof"
import type { StartAuthenticationProofDependencies } from "../../../domains/authentication/start-authentication-proof/types"
import { createGitHubUserAuthenticationAdapter } from "../../../integrations/github/create-user-authentication-adapter"
import { createLogger } from "../../../integrations/pino/create-logger"
import type { AuthenticationRouteDependencies } from "./types"

const httpsApplicationOrigin = "https://hub.example.test"

function routeDependencies(applicationOrigin = "http://127.0.0.1:5173") {
  const secureCookie = new URL(applicationOrigin).protocol === "https:"
  const encryptionKey = Buffer.alloc(32, 1)
  const checkRateLimit = vi.fn().mockResolvedValue({ allowed: true, auditFailed: false })
  const startSignIn = vi.fn()
  const startEnrollment = vi.fn()
  const endSession = vi.fn()
  const completeProof = vi.fn()
  const verifyAdministratorAuthorization = vi.fn().mockResolvedValue("DESIGNATE_ADMINISTRATORS")
  const admitSession = vi.fn()
  const restoreSession = vi.fn()
  const verifyBootstrapSecret = vi.fn().mockReturnValue(false)
  const dependencies: AuthenticationRouteDependencies = {
    github: {
      signIn: {
        applicationOrigin,
        checkRateLimit,
        secureCookie,
        start: startSignIn,
      },
      administratorEnrollment: {
        applicationOrigin,
        checkRateLimit,
        secureCookie,
        start: startEnrollment,
        verifyBootstrapSecret,
        writeBootstrapDenial: vi.fn().mockResolvedValue(undefined),
      },
      callback: {
        callbackIssuer: "https://github.com/login/oauth",
        checkRateLimit,
        createGitHubRepositoryDenialNotice: (login) =>
          createGitHubRepositoryDenialNotice(login, encryptionKey),
        secureCookie,
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
      applicationOrigin,
      secureCookie,
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

function requestThroughProxy(
  url: string,
  headers: Record<string, string>,
  method: "GET" | "POST" = "GET",
) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method,
        headers: {
          host: new URL(httpsApplicationOrigin).host,
          "x-forwarded-proto": "https",
          ...headers,
        },
      },
      (response) => {
        response.on("error", reject)
        response.on("end", () => resolve(response))
        response.resume()
      },
    )
    request.on("error", reject)
    request.end()
  })
}

function expectClearedSessionCookie(cookies: string[], name: string, secure = true) {
  const matches = cookies.filter((cookie) => cookie.startsWith(`${name}=`))
  expect(matches).toHaveLength(1)
  const [pair, ...attributes] = matches[0]!.split(/;\s*/)
  expect(pair).toBe(`${name}=`)
  expect(attributes).toEqual(expect.arrayContaining(["Max-Age=0", "Path=/"]))
  expect(attributes.includes("Secure")).toBe(secure)
  expect(matches[0]).not.toMatch(/;\s*Domain=/i)
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
      const binding = response.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("hub_auth_browser="))
      expect(binding).toBeDefined()
      expect(binding).not.toContain("Secure")
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

  it.each([
    { provider: "github", path: "start", body: "" },
    { provider: "entra", path: "start", body: "" },
    { provider: "github", path: "admin-enrollment/start", body: "bootstrap_secret=test-secret" },
    { provider: "entra", path: "admin-enrollment/start", body: "bootstrap_secret=test-secret" },
  ])(
    "issues a host-only HTTPS browser binding at $provider/$path",
    async ({ provider, path, body }) => {
      const { dependencies, startSignIn, startEnrollment, verifyBootstrapSecret } =
        routeDependencies(httpsApplicationOrigin)
      dependencies.entra = dependencies.github
      const result = {
        authorizationUrl: "https://provider.example.test/authorize",
        browserBinding: "b".repeat(32),
        expiresAt: new Date("2030-01-01T00:00:00Z"),
      }
      startSignIn.mockResolvedValue(result)
      startEnrollment.mockResolvedValue(result)
      verifyBootstrapSecret.mockReturnValue(true)

      await withServer(dependencies, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/auth/${provider}/${path}`, {
          method: "POST",
          headers: {
            origin: httpsApplicationOrigin,
            "content-type": "application/x-www-form-urlencoded",
          },
          body,
          redirect: "manual",
        })

        expect(response.status).toBe(303)
        expect(response.headers.get("location")).toBe(result.authorizationUrl)
        const cookies = response.headers.getSetCookie()
        const binding = cookies.find((cookie) => cookie.startsWith("__Host-hub_auth_browser="))
        expect(binding?.split(/;\s*/)).toEqual(
          expect.arrayContaining([
            `__Host-hub_auth_browser=${result.browserBinding}`,
            "Secure",
            "HttpOnly",
            "SameSite=Lax",
            "Path=/",
          ]),
        )
        expect(binding).not.toMatch(/;\s*Domain=/i)
        expect(cookies.some((cookie) => cookie.startsWith("hub_auth_browser="))).toBe(false)
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
        disconnectCopilotConnection: vi.fn().mockResolvedValue(null),
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
      const cookies = response.headers.getSetCookie()
      const sessionCookie = cookies.find((cookie) => cookie.startsWith("hub_session="))
      expect(sessionCookie).toMatch(/^hub_session=[^;]+;/)
      expect(sessionCookie).not.toMatch(/;\s*Secure(?:;|$)/i)
      expect(cookies.some((cookie) => cookie.startsWith("__Host-hub_session="))).toBe(false)
      expect(completeProof).toHaveBeenCalledWith({
        browserBinding,
        code: "provider-code",
        state,
      })
    })
  })

  it.each(["github", "entra"] as const)(
    "issues a fresh host-only session on the HTTPS %s callback without Origin",
    async (provider) => {
      const { dependencies, completeProof, admitSession } =
        routeDependencies(httpsApplicationOrigin)
      dependencies.entra = dependencies.github
      const browserBinding = "b".repeat(32)
      completeProof.mockResolvedValue({
        purpose: "SIGN_IN",
        proof: { authorizationAttemptId: "attempt-id", externalIdentityId: "identity-id" },
      })
      admitSession.mockResolvedValue({ expiresAt: new Date("2030-01-01T00:00:00Z") })
      const legacy = randomBytes(32).toString("base64url")
      const previous = randomBytes(32).toString("base64url")

      await withServer(
        dependencies,
        async (baseUrl) => {
          const response = await requestThroughProxy(
            `${baseUrl}/api/auth/${provider}/callback?code=provider-code&state=${"s".repeat(32)}`,
            {
              cookie: `__Host-hub_auth_browser=${browserBinding}; hub_session=${legacy}; __Host-hub_session=${previous}`,
            },
          )

          expect(response.statusCode).toBe(303)
          expect(response.headers.location).toBe("/?authentication=success")
          const cookies = response.headers["set-cookie"] ?? []
          const protectedSessions = cookies.filter((cookie) =>
            cookie.startsWith("__Host-hub_session="),
          )
          expect(protectedSessions).toHaveLength(1)
          const [pair, ...attributes] = protectedSessions[0]!.split(/;\s*/)
          const issued = pair?.match(/^__Host-hub_session=(.+)$/)?.[1]
          expect(issued).toBeTruthy()
          expect(issued).not.toBe(legacy)
          expect(issued).not.toBe(previous)
          expect(attributes).toEqual(
            expect.arrayContaining(["Secure", "HttpOnly", "SameSite=Lax", "Path=/"]),
          )
          expect(protectedSessions[0]).not.toMatch(/;\s*Domain=/i)
          expectClearedSessionCookie(cookies, "hub_session")
          expectClearedSessionCookie(cookies, "__Host-hub_auth_browser")
          expect(completeProof).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ browserBinding }),
          )
          const sessionDigest = createHash("sha256").update(issued!).digest("hex")
          expect(admitSession).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ sessionDigest }),
          )
        },
        { trustedProxyHops: 1 },
      )
    },
  )

  it("requires a fresh HTTPS sign-in when an in-flight callback has only the legacy binding", async () => {
    const { dependencies, completeProof, admitSession } = routeDependencies(httpsApplicationOrigin)
    completeProof.mockResolvedValue({
      purpose: "SIGN_IN",
      proof: { authorizationAttemptId: "attempt-id", externalIdentityId: "identity-id" },
    })
    admitSession.mockResolvedValue({ expiresAt: new Date("2030-01-01T00:00:00Z") })

    await withServer(
      dependencies,
      async (baseUrl) => {
        const response = await requestThroughProxy(
          `${baseUrl}/api/auth/github/callback?code=provider-code&state=${"s".repeat(32)}`,
          { cookie: `hub_auth_browser=${"b".repeat(32)}` },
        )

        expect(response.statusCode).toBe(303)
        expect(response.headers.location).toBe("/?authentication=denied")
        const cookies = response.headers["set-cookie"] ?? []
        expectClearedSessionCookie(cookies, "__Host-hub_auth_browser")
        expect(cookies.some((cookie) => cookie.startsWith("__Host-hub_session="))).toBe(false)
        expect(completeProof).not.toHaveBeenCalled()
        expect(admitSession).not.toHaveBeenCalled()
      },
      { trustedProxyHops: 1 },
    )
  })

  it.each([
    {
      reason: "a different Host port",
      host: "hub.example.test:8443",
      protocol: "https",
      trustedProxyHops: 1,
    },
    {
      reason: "insecure transport",
      host: "hub.example.test",
      protocol: "http",
      trustedProxyHops: 1,
    },
    {
      reason: "an untrusted HTTPS indication",
      host: "hub.example.test",
      protocol: "https",
      trustedProxyHops: 0,
    },
  ])(
    "rejects the HTTPS callback with $reason before sign-in",
    async ({ host, protocol, trustedProxyHops }) => {
      const { dependencies, completeProof, admitSession } =
        routeDependencies(httpsApplicationOrigin)
      completeProof.mockResolvedValue({
        purpose: "SIGN_IN",
        proof: { authorizationAttemptId: "attempt-id", externalIdentityId: "identity-id" },
      })
      admitSession.mockResolvedValue({ expiresAt: new Date("2030-01-01T00:00:00Z") })

      await withServer(
        dependencies,
        async (baseUrl) => {
          const response = await requestThroughProxy(
            `${baseUrl}/api/auth/github/callback?code=provider-code&state=${"s".repeat(32)}`,
            {
              host,
              "x-forwarded-proto": protocol,
              cookie: `__Host-hub_auth_browser=${"b".repeat(32)}`,
            },
          )

          expect(response.statusCode).toBe(404)
          expect(completeProof).not.toHaveBeenCalled()
          expect(admitSession).not.toHaveBeenCalled()
          expect(response.headers["set-cookie"]).toBeUndefined()
        },
        { trustedProxyHops },
      )
    },
  )

  it("redirects to a fresh sign-in state when admission authority is busy", async () => {
    const { dependencies, completeProof, admitSession } = routeDependencies()
    completeProof.mockResolvedValue({
      purpose: "SIGN_IN",
      proof: {
        authorizationAttemptId: "attempt-id",
        externalIdentityId: "identity-id",
      },
    })
    admitSession.mockRejectedValue(new AdmissionUnavailableError())
    const state = "s".repeat(32)
    const browserBinding = "b".repeat(32)

    await withServer(dependencies, async (baseUrl) => {
      const callback = new URL("/api/auth/github/callback", baseUrl)
      callback.searchParams.set("code", "test-code")
      callback.searchParams.set("state", state)
      const response = await fetch(callback, {
        headers: { cookie: `hub_auth_browser=${browserBinding}` },
        redirect: "manual",
      })

      expect(response.status).toBe(503)
      expect(response.headers.get("content-type")).toContain("text/plain")
      expect(response.headers.get("retry-after")).toBe("1")
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
      expect(await response.text()).toBe(
        "Sign-in is temporarily unavailable. Return to Replica Hub and start sign-in again.",
      )
    })
  })

  it("continues fresh administrator authorization without issuing a new Hub session", async () => {
    const { admitSession, completeProof, dependencies, verifyAdministratorAuthorization } =
      routeDependencies(httpsApplicationOrigin)
    const sensitiveAuthorizationId = "00000000-0000-4000-8000-000000000020"
    const browserBinding = "b".repeat(32)
    completeProof.mockResolvedValue({
      purpose: "ADMINISTRATOR_MANAGEMENT",
      sensitiveAuthorizationId,
      proof: {
        authorizationAttemptId: "00000000-0000-4000-8000-000000000010",
        externalIdentityId: "00000000-0000-4000-8000-000000000012",
      },
    })

    await withServer(
      dependencies,
      async (baseUrl) => {
        const response = await requestThroughProxy(
          `${baseUrl}/api/auth/github/callback?code=provider-code&state=${"s".repeat(32)}`,
          {
            cookie: `__Host-hub_auth_browser=${browserBinding}; __Host-hub_session=retained-session`,
          },
        )

        expect(response.statusCode).toBe(303)
        expect(response.headers.location).toBe(
          `/settings/administrators/confirm?authorizationId=${sensitiveAuthorizationId}`,
        )
        expect(completeProof).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ browserBinding }),
        )
        expect(verifyAdministratorAuthorization).toHaveBeenCalledWith({
          authorizationAttemptId: "00000000-0000-4000-8000-000000000010",
          externalIdentityId: "00000000-0000-4000-8000-000000000012",
          providerAssignment: undefined,
          sessionDigest: createHash("sha256").update("retained-session").digest("hex"),
          sensitiveAuthorizationId,
        })
        expect(admitSession).not.toHaveBeenCalled()
        const cookies = response.headers["set-cookie"] ?? []
        expectClearedSessionCookie(cookies, "__Host-hub_auth_browser")
        expect(cookies.some((cookie) => /^(?:__Host-)?hub_session=/.test(cookie))).toBe(false)
      },
      { trustedProxyHops: 1 },
    )
  })

  it("returns a busy administrator callback to the active session with retry guidance", async () => {
    const { completeProof, dependencies, verifyAdministratorAuthorization } = routeDependencies()
    completeProof.mockResolvedValue({
      purpose: "ADMINISTRATOR_MANAGEMENT",
      sensitiveAuthorizationId: "00000000-0000-4000-8000-000000000020",
      proof: {
        authorizationAttemptId: "00000000-0000-4000-8000-000000000010",
        externalIdentityId: "00000000-0000-4000-8000-000000000012",
      },
    })
    verifyAdministratorAuthorization.mockRejectedValue(new AdmissionUnavailableError())

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

      expect(response.status).toBe(503)
      expect(response.headers.get("content-type")).toContain("text/plain")
      expect(response.headers.get("retry-after")).toBe("1")
      expect(response.headers.get("set-cookie")).not.toContain("hub_session=")
      expect(await response.text()).toBe(
        "Verification is temporarily unavailable. Return to Hub settings and start the administrator action again.",
      )
    })
  })

  it("routes verified global session revocation to its confirmation page", async () => {
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
    verifyAdministratorAuthorization.mockResolvedValue("END_ALL_HUB_SESSIONS")

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
        `/settings/sessions/confirm?authorizationId=${sensitiveAuthorizationId}`,
      )
      expect(admitSession).not.toHaveBeenCalled()
    })
  })

  it("routes verified Copilot authorization to its confirmation page", async () => {
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
    verifyAdministratorAuthorization.mockResolvedValue("CONNECT_COPILOT")

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
        `/settings/copilot/confirm?authorizationId=${sensitiveAuthorizationId}`,
      )
      expect(admitSession).not.toHaveBeenCalled()
    })
  })

  it("denies administrator authorization when callback verification returns null", async () => {
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
    verifyAdministratorAuthorization.mockResolvedValue(null)

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
      expect(response.headers.get("location")).toBe("/?authentication=denied")
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

  it("restores only the legacy session for HTTP configuration even over a trusted HTTPS proxy", async () => {
    const { dependencies, restoreSession } = routeDependencies()
    restoreSession.mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "local",
      sessionProvider: "local",
      login: "local-test",
      name: "Local developer",
      role: "ADMINISTRATOR",
    })

    await withServer(
      dependencies,
      async (baseUrl) => {
        const protectedOnly = await requestThroughProxy(`${baseUrl}/api/auth/session`, {
          cookie: "__Host-hub_session=protected-session",
        })
        expect(protectedOnly.statusCode).toBe(401)
        expect(restoreSession).not.toHaveBeenCalled()

        const both = await requestThroughProxy(`${baseUrl}/api/auth/session`, {
          cookie: "__Host-hub_session=protected-session; hub_session=local-session",
        })
        expect(both.statusCode).toBe(200)
        expect(restoreSession).toHaveBeenCalledExactlyOnceWith(
          createHash("sha256").update("local-session").digest("hex"),
        )
      },
      { trustedProxyHops: 1 },
    )
  })

  it.each([
    { scenario: "legacy when protected is absent", order: ["legacy"], selected: "legacy" },
    { scenario: "protected after legacy", order: ["legacy", "protected"], selected: "protected" },
    { scenario: "protected before legacy", order: ["protected", "legacy"], selected: "protected" },
  ] as const)("restores $scenario without reissuing a cookie", async ({ order, selected }) => {
    const { dependencies, restoreSession } = routeDependencies(httpsApplicationOrigin)
    const sessions = {
      legacy: randomBytes(32).toString("base64url"),
      protected: randomBytes(32).toString("base64url"),
    }
    const pairs = {
      legacy: `hub_session=${sessions.legacy}`,
      protected: `__Host-hub_session=${sessions.protected}`,
    }
    restoreSession.mockResolvedValue({
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      login: "member",
      name: null,
      role: "MEMBER",
    })

    await withServer(
      dependencies,
      async (baseUrl) => {
        const response = await requestThroughProxy(`${baseUrl}/api/auth/session`, {
          cookie: order.map((name) => pairs[name]).join("; "),
        })

        expect(response.statusCode).toBe(200)
        expect(response.headers["set-cookie"]).toBeUndefined()
        expect(restoreSession).toHaveBeenCalledExactlyOnceWith(
          createHash("sha256").update(sessions[selected]).digest("hex"),
        )
      },
      { trustedProxyHops: 1 },
    )
  })

  it.each([
    { reason: "empty", value: "" },
    { reason: "malformed", value: "%" },
  ])("does not fall back when the protected session cookie is $reason", async ({ value }) => {
    const { dependencies, restoreSession } = routeDependencies(httpsApplicationOrigin)
    const legacy = randomBytes(32).toString("base64url")

    await withServer(
      dependencies,
      async (baseUrl) => {
        const response = await requestThroughProxy(`${baseUrl}/api/auth/session`, {
          cookie: `__Host-hub_session=${value}; hub_session=${legacy}`,
        })

        expect(response.statusCode).toBe(401)
        expect(restoreSession).not.toHaveBeenCalled()
        expect(response.headers["set-cookie"]).toBeUndefined()
      },
      { trustedProxyHops: 1 },
    )
  })

  it("does not fall back when the protected session is unrecognized and legacy is current", async () => {
    const { dependencies, restoreSession } = routeDependencies(httpsApplicationOrigin)
    const legacy = randomBytes(32).toString("base64url")
    const legacyDigest = createHash("sha256").update(legacy).digest("hex")
    const unknown = randomBytes(32).toString("base64url")
    const viewer = {
      membershipId: randomUUID(),
      userId: randomUUID(),
      provider: "github",
      login: "member",
      name: null,
      role: "MEMBER",
    }
    restoreSession.mockImplementation((digest: string) =>
      Promise.resolve(digest === legacyDigest ? viewer : null),
    )

    await withServer(
      dependencies,
      async (baseUrl) => {
        const response = await requestThroughProxy(`${baseUrl}/api/auth/session`, {
          cookie: `__Host-hub_session=${unknown}; hub_session=${legacy}`,
        })

        expect(response.statusCode).toBe(401)
        expect(response.headers["set-cookie"]).toBeUndefined()
        expect(restoreSession).toHaveBeenCalledExactlyOnceWith(
          createHash("sha256").update(unknown).digest("hex"),
        )
      },
      { trustedProxyHops: 1 },
    )
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
          cookie: "__Host-hub_session=protected-session; hub_session=session-value",
          origin: dependencies.signOut.applicationOrigin,
        },
        redirect: "manual",
      })

      expect(response.status).toBe(303)
      expect(response.headers.get("location")).toBe("/")
      const cookies = response.headers.getSetCookie()
      expect(cookies).toHaveLength(1)
      expectClearedSessionCookie(cookies, "hub_session", false)
      expect(endSession).toHaveBeenCalledExactlyOnceWith(
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

  it.each([
    { scenario: "distinct", legacy: "legacy-session", protectedSession: "protected-session" },
    { scenario: "the same", legacy: "current-session", protectedSession: "current-session" },
  ])(
    "ends $scenario presented sessions and clears both cookie names on HTTPS sign-out",
    async ({ legacy, protectedSession }) => {
      const { dependencies, endSession } = routeDependencies(httpsApplicationOrigin)
      endSession.mockResolvedValue(true)

      await withServer(
        dependencies,
        async (baseUrl) => {
          const response = await requestThroughProxy(
            `${baseUrl}/api/auth/session/sign-out`,
            {
              cookie: `hub_session=${legacy}; __Host-hub_session=${protectedSession}`,
              origin: httpsApplicationOrigin,
            },
            "POST",
          )

          expect(response.statusCode).toBe(204)
          const presented = [...new Set([legacy, protectedSession])]
          expect(endSession).toHaveBeenCalledTimes(presented.length)
          for (const value of presented) {
            expect(endSession).toHaveBeenCalledWith(
              createHash("sha256").update(value).digest("hex"),
            )
          }
          const cookies = response.headers["set-cookie"] ?? []
          expectClearedSessionCookie(cookies, "__Host-hub_session")
          expectClearedSessionCookie(cookies, "hub_session")
        },
        { trustedProxyHops: 1 },
      )
    },
  )

  it.each([
    { reason: "a different Origin", origin: "https://other.example.test" },
    { reason: "no Origin", origin: undefined },
  ])("rejects HTTPS sign-out with $reason", async ({ origin }) => {
    const { dependencies, endSession } = routeDependencies(httpsApplicationOrigin)
    const protectedSession = randomBytes(32).toString("base64url")

    await withServer(
      dependencies,
      async (baseUrl) => {
        const response = await requestThroughProxy(
          `${baseUrl}/api/auth/session/sign-out`,
          { cookie: `__Host-hub_session=${protectedSession}`, ...(origin ? { origin } : {}) },
          "POST",
        )

        expect(response.statusCode).toBe(403)
        expect(endSession).not.toHaveBeenCalled()
        expect(response.headers["set-cookie"]).toBeUndefined()
      },
      { trustedProxyHops: 1 },
    )
  })

  it("keeps both HTTPS cookies when ending one of two sessions succeeds and the other is busy", async () => {
    const { dependencies, endSession } = routeDependencies(httpsApplicationOrigin)
    endSession
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new SessionTerminationConflictError())
    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/session/sign-out`, {
        method: "POST",
        headers: {
          accept: "application/json",
          cookie: "__Host-hub_session=protected-session; hub_session=legacy-session",
          origin: dependencies.signOut.applicationOrigin,
        },
      })

      expect(response.status).toBe(503)
      expect(endSession).toHaveBeenCalledTimes(2)
      expect(response.headers.get("retry-after")).toBe("1")
      expect(response.headers.get("set-cookie")).toBeNull()
      expect(await response.json()).toEqual({
        error: "Sign-out is temporarily unavailable. Try again.",
      })
    })
  })

  it("returns a busy native sign-out to the active session with retry guidance", async () => {
    const { dependencies, endSession } = routeDependencies(httpsApplicationOrigin)
    const legacyDigest = createHash("sha256").update("legacy-session").digest("hex")
    endSession.mockImplementation((digest: string) =>
      digest === legacyDigest
        ? Promise.reject(new SessionTerminationConflictError())
        : Promise.resolve(true),
    )
    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/session/sign-out`, {
        method: "POST",
        headers: {
          accept: "text/html",
          cookie: "__Host-hub_session=protected-session; hub_session=legacy-session",
          origin: dependencies.signOut.applicationOrigin,
        },
        redirect: "manual",
      })

      expect(response.status).toBe(503)
      expect(endSession).toHaveBeenCalledExactlyOnceWith(legacyDigest)
      expect(response.headers.get("content-type")).toContain("text/plain")
      expect(response.headers.get("retry-after")).toBe("1")
      expect(response.headers.get("set-cookie")).toBeNull()
      expect(await response.text()).toBe(
        "Sign-out is temporarily unavailable. Return to Replica Hub and try again.",
      )
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
