import { randomBytes } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../create-app"
import { prisma } from "../../integrations/prisma"
import { createAuthenticationRouteDependencies } from "../../routes/api/auth/create-authentication-route-dependencies"

const applicationOrigin = "https://hub.example.test"
const tenantId = "11111111-1111-4111-8111-111111111111"
const clientId = "22222222-2222-4222-8222-222222222222"
const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`
const assignmentSubject = "33333333-3333-4333-8333-333333333333"

interface TokenEvidence {
  assignmentSubject?: string
  issuedAt: number
  nonce?: string
  role: "ADMINISTRATOR" | "MEMBER" | null
}

function cookieValue(response: Response, name: string) {
  const header = response.headers.get("set-cookie") ?? ""
  const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;,]*)`))
  return match ? decodeURIComponent(match[1]!) : null
}

function environment() {
  return {
    ENTRA_OIDC_CLIENT_AUTHENTICATION: "client-secret",
    ENTRA_OIDC_CLIENT_ID: clientId,
    ENTRA_OIDC_CLIENT_SECRET: "entra-secret",
    ENTRA_OIDC_ISSUER: issuer,
    ENTRA_OIDC_PROVIDER_REVISION: "1",
    HUB_APPLICATION_ORIGIN: applicationOrigin,
    HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    HUB_BOOTSTRAP_SECRET: "bootstrap-secret-that-is-at-least-32-characters",
  }
}

async function openServer(tokens: Map<string, TokenEvidence>) {
  const { privateKey, publicKey } = await generateKeyPair("RS256")
  const jwk = await exportJWK(publicKey)
  let blockedCode: string | undefined
  let releaseBlocked: (() => void) | undefined
  let blockedRequestStarted: (() => void) | undefined
  let blockedRequest = Promise.resolve()
  function block(code: string) {
    blockedCode = code
    blockedRequest = new Promise<void>((resolve) => {
      blockedRequestStarted = resolve
    })
    return {
      started: blockedRequest,
      release() {
        releaseBlocked?.()
      },
    }
  }
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Response.json({
        authorization_endpoint: `${issuer}/oauth2/v2.0/authorize`,
        id_token_signing_alg_values_supported: ["RS256"],
        issuer,
        jwks_uri: `${issuer}/discovery/v2.0/keys`,
        token_endpoint: `${issuer}/oauth2/v2.0/token`,
      })
    }
    if (url === `${issuer}/discovery/v2.0/keys`) {
      return Response.json({ keys: [{ ...jwk, alg: "RS256", kid: "test-key", use: "sig" }] })
    }
    if (url === `${issuer}/oauth2/v2.0/token`) {
      const code = new URLSearchParams(init?.body as URLSearchParams).get("code")!
      if (code === blockedCode) {
        blockedRequestStarted?.()
        await new Promise<void>((resolve) => {
          releaseBlocked = resolve
        })
      }
      const evidence = tokens.get(code)
      if (!evidence) throw new Error(`Unexpected authorization code: ${code}`)
      const roles =
        evidence.role === "ADMINISTRATOR"
          ? ["Hub.Administrator"]
          : evidence.role === "MEMBER"
            ? ["Hub.User"]
            : []
      const token = await new SignJWT({
        nonce: evidence.nonce,
        oid: evidence.assignmentSubject ?? assignmentSubject,
        roles,
      })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(issuer)
        .setAudience(clientId)
        .setSubject("immutable-subject")
        .setIssuedAt(evidence.issuedAt)
        .setExpirationTime(evidence.issuedAt + 3_600)
        .sign(privateKey)
      return Response.json({ id_token: token })
    }
    throw new Error(`Unexpected provider request: ${url}`)
  })
  const dependencies = await createAuthenticationRouteDependencies(environment(), request)
  const server = createServer(createApp({ authentication: dependencies }))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    block,
    async close() {
      vi.useRealTimers()
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
      server.closeIdleConnections()
      server.closeAllConnections()
      await closed
    },
  }
}

async function startAuthentication(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/auth/entra/start`, {
    headers: { origin: applicationOrigin },
    method: "POST",
    redirect: "manual",
  })
  const location = response.headers.get("location")
  const browserBinding = cookieValue(response, "hub_auth_browser")
  const state = location ? new URL(location).searchParams.get("state") : null
  const nonce = location ? new URL(location).searchParams.get("nonce") : null
  if (!browserBinding || !nonce || !state) throw new Error("Authentication start was incomplete.")
  return { browserBinding, nonce, state }
}

function completeAuthentication(
  baseUrl: string,
  attempt: Awaited<ReturnType<typeof startAuthentication>>,
  code: string,
) {
  return fetch(
    `${baseUrl}/api/auth/entra/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(attempt.state)}`,
    {
      headers: {
        cookie: `hub_auth_browser=${encodeURIComponent(attempt.browserBinding)}`,
        host: "hub.example.test",
      },
      redirect: "manual",
    },
  )
}

async function activeProviderRole() {
  return prisma.membershipAssignment.findFirst({
    select: { role: true },
    where: {
      lifecycle: "ACTIVE",
      source: "AUTHENTICATION_PROVIDER",
    },
  })
}

async function sessionSummary() {
  const sessions = await prisma.hubSession.findMany({
    select: { endedAt: true },
  })
  return {
    ended: sessions.filter(({ endedAt }) => endedAt !== null).length,
    open: sessions.filter(({ endedAt }) => endedAt === null).length,
    total: sessions.length,
  }
}

describe("provider evidence ordering", () => {
  it.each([
    {
      name: "stale administrator after revocation",
      initial: "ADMINISTRATOR" as const,
      stale: "ADMINISTRATOR" as const,
      current: null,
      staleIssuedAt: 1_798_847_900,
      currentIssuedAt: 1_798_847_950,
      expected: null,
    },
    {
      name: "stale administrator after downgrade",
      initial: "ADMINISTRATOR" as const,
      stale: "ADMINISTRATOR" as const,
      current: "MEMBER" as const,
      staleIssuedAt: 1_798_847_900,
      currentIssuedAt: 1_798_847_950,
      expected: "MEMBER" as const,
    },
    {
      name: "stale member after upgrade",
      initial: "MEMBER" as const,
      stale: "MEMBER" as const,
      current: "ADMINISTRATOR" as const,
      staleIssuedAt: 1_798_847_900,
      currentIssuedAt: 1_798_847_950,
      expected: "ADMINISTRATOR" as const,
    },
    {
      name: "equal marker administrator replay after member evidence",
      initial: "MEMBER" as const,
      stale: "ADMINISTRATOR" as const,
      current: "MEMBER" as const,
      staleIssuedAt: 1_798_847_950,
      currentIssuedAt: 1_798_847_950,
      expected: "MEMBER" as const,
    },
    {
      name: "stale member against revoked assignment history",
      initial: "MEMBER" as const,
      stale: "MEMBER" as const,
      current: null,
      staleIssuedAt: 1_798_847_900,
      currentIssuedAt: 1_798_847_950,
      expected: null,
    },
  ])("rejects $name before authority mutation or session issuance", async (scenario) => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2027-01-02T00:00:00Z"))
    const tokens = new Map<string, TokenEvidence>([
      ["initial", { issuedAt: 1_798_847_800, role: scenario.initial }],
      ["stale", { issuedAt: scenario.staleIssuedAt, role: scenario.stale }],
      ["current", { issuedAt: scenario.currentIssuedAt, role: scenario.current }],
    ])
    const server = await openServer(tokens)
    try {
      const initialAttempt = await startAuthentication(server.baseUrl)
      tokens.get("initial")!.nonce = initialAttempt.nonce
      const initial = await completeAuthentication(server.baseUrl, initialAttempt, "initial")
      expect(initial.headers.get("location")).toBe("/?authentication=success")

      const staleAttempt = await startAuthentication(server.baseUrl)
      const currentAttempt = await startAuthentication(server.baseUrl)
      tokens.get("stale")!.nonce = staleAttempt.nonce
      tokens.get("current")!.nonce = currentAttempt.nonce
      const barrier = server.block("stale")
      const staleCompletion = completeAuthentication(server.baseUrl, staleAttempt, "stale")
      await barrier.started

      const current = await completeAuthentication(server.baseUrl, currentAttempt, "current")
      expect(current.headers.get("location")).toBe(
        scenario.current === null ? "/?authentication=denied" : "/?authentication=success",
      )
      barrier.release()
      const stale = await staleCompletion

      expect(stale.headers.get("location")).toBe("/?authentication=denied")
      await expect(activeProviderRole()).resolves.toEqual(
        scenario.expected === null ? null : { role: scenario.expected },
      )
      await expect(
        prisma.securityAudit.findFirst({
          orderBy: { createdAt: "desc" },
          where: { action: "admission.denied" },
        }),
      ).resolves.toMatchObject({ outcome: "DENIED" })
    } finally {
      await server.close()
    }
  })

  it.each([
    {
      name: "administrator before equal-second member evidence",
      initial: "MEMBER" as const,
      first: "ADMINISTRATOR" as const,
      second: "MEMBER" as const,
      firstLocation: "/?authentication=success",
      secondLocation: "/?authentication=success",
      expectedRole: "MEMBER" as const,
      sessions: { ended: 2, open: 1, total: 3 },
    },
    {
      name: "administrator before equal-second authority loss",
      initial: "MEMBER" as const,
      first: "ADMINISTRATOR" as const,
      second: null,
      firstLocation: "/?authentication=success",
      secondLocation: "/?authentication=denied",
      expectedRole: null,
      sessions: { ended: 2, open: 0, total: 2 },
    },
    {
      name: "member before equal-second administrator evidence",
      initial: "ADMINISTRATOR" as const,
      first: "MEMBER" as const,
      second: "ADMINISTRATOR" as const,
      firstLocation: "/?authentication=success",
      secondLocation: "/?authentication=denied",
      expectedRole: "MEMBER" as const,
      sessions: { ended: 1, open: 1, total: 2 },
    },
    {
      name: "authority loss before equal-second administrator evidence",
      initial: "ADMINISTRATOR" as const,
      first: null,
      second: "ADMINISTRATOR" as const,
      firstLocation: "/?authentication=denied",
      secondLocation: "/?authentication=denied",
      expectedRole: null,
      sessions: { ended: 1, open: 0, total: 1 },
    },
    {
      name: "member before an equal-second identical replay",
      initial: "ADMINISTRATOR" as const,
      first: "MEMBER" as const,
      second: "MEMBER" as const,
      firstLocation: "/?authentication=success",
      secondLocation: "/?authentication=denied",
      expectedRole: "MEMBER" as const,
      sessions: { ended: 1, open: 1, total: 2 },
    },
    {
      name: "member before equal-second conflicting member provenance",
      initial: "ADMINISTRATOR" as const,
      first: "MEMBER" as const,
      second: "MEMBER" as const,
      secondAssignmentSubject: "44444444-4444-4444-8444-444444444444",
      firstLocation: "/?authentication=success",
      secondLocation: "/?authentication=denied",
      expectedRole: "MEMBER" as const,
      sessions: { ended: 1, open: 1, total: 2 },
    },
  ])(
    "orders $name without issuing a stale session",
    async ({
      initial,
      first,
      second,
      secondAssignmentSubject,
      firstLocation,
      secondLocation,
      expectedRole,
      sessions,
    }) => {
      vi.useFakeTimers({ toFake: ["Date"] })
      vi.setSystemTime(new Date("2027-01-02T00:00:00Z"))
      const equalIssuedAt = 1_798_847_950
      const tokens = new Map<string, TokenEvidence>([
        ["initial", { issuedAt: equalIssuedAt - 100, role: initial }],
        ["first", { issuedAt: equalIssuedAt, role: first }],
        [
          "second",
          {
            assignmentSubject: secondAssignmentSubject,
            issuedAt: equalIssuedAt,
            role: second,
          },
        ],
      ])
      const server = await openServer(tokens)
      try {
        const initialAttempt = await startAuthentication(server.baseUrl)
        tokens.get("initial")!.nonce = initialAttempt.nonce
        const initialResponse = await completeAuthentication(
          server.baseUrl,
          initialAttempt,
          "initial",
        )
        expect(initialResponse.headers.get("location")).toBe("/?authentication=success")

        const firstAttempt = await startAuthentication(server.baseUrl)
        const secondAttempt = await startAuthentication(server.baseUrl)
        tokens.get("first")!.nonce = firstAttempt.nonce
        tokens.get("second")!.nonce = secondAttempt.nonce
        const barrier = server.block("second")
        const secondCompletion = completeAuthentication(server.baseUrl, secondAttempt, "second")
        await barrier.started

        const firstResponse = await completeAuthentication(server.baseUrl, firstAttempt, "first")
        expect(firstResponse.headers.get("location")).toBe(firstLocation)
        barrier.release()
        const secondResponse = await secondCompletion

        expect(secondResponse.headers.get("location")).toBe(secondLocation)
        await expect(activeProviderRole()).resolves.toEqual(
          expectedRole === null ? null : { role: expectedRole },
        )
        await expect(sessionSummary()).resolves.toEqual(sessions)
        await expect(
          prisma.providerEvidenceState.findFirstOrThrow({
            select: { lastIssuedAt: true, lastRole: true },
          }),
        ).resolves.toEqual({
          lastIssuedAt: new Date(equalIssuedAt * 1_000),
          lastRole: expectedRole,
        })
      } finally {
        await server.close()
      }
    },
  )

  it("applies a later timestamp normally after an equal-second reduction", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2027-01-02T00:00:00Z"))
    const equalIssuedAt = 1_798_847_950
    const tokens = new Map<string, TokenEvidence>([
      ["initial", { issuedAt: equalIssuedAt - 100, role: "MEMBER" }],
      ["administrator", { issuedAt: equalIssuedAt, role: "ADMINISTRATOR" }],
      ["member", { issuedAt: equalIssuedAt, role: "MEMBER" }],
      ["later", { issuedAt: equalIssuedAt + 1, role: "ADMINISTRATOR" }],
    ])
    const server = await openServer(tokens)
    try {
      for (const code of ["initial", "administrator", "member", "later"]) {
        const attempt = await startAuthentication(server.baseUrl)
        tokens.get(code)!.nonce = attempt.nonce
        const response = await completeAuthentication(server.baseUrl, attempt, code)
        expect(response.headers.get("location")).toBe("/?authentication=success")
      }

      await expect(activeProviderRole()).resolves.toEqual({ role: "ADMINISTRATOR" })
      await expect(sessionSummary()).resolves.toEqual({ ended: 3, open: 1, total: 4 })
      await expect(
        prisma.providerEvidenceState.findFirstOrThrow({
          select: { lastIssuedAt: true, lastRole: true },
        }),
      ).resolves.toEqual({
        lastIssuedAt: new Date((equalIssuedAt + 1) * 1_000),
        lastRole: "ADMINISTRATOR",
      })
    } finally {
      await server.close()
    }
  })
})
