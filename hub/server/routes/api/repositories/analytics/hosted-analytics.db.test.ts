import { createHash, generateKeyPairSync, randomBytes } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished } from "vitest"

import { createApp } from "../../../../create-app"
import { readAnalyticsSettings } from "../../../../domains/analytics/read-settings"
import type { LiveRepositoryPermission } from "../../../../domains/analytics/hosted-authorization/types"
import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value"
import { prisma } from "../../../../integrations/prisma"
import { createAuthenticationRouteDependencies } from "../../auth/create-authentication-route-dependencies"
import { createProductRouteDependencies } from "../../product/create-product-route-dependencies"

const githubKey = Buffer.from(
  generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
    type: "pkcs1",
    format: "pem",
  }),
).toString("base64")

const destination = {
  provider: "segment",
  eventTypes: ["prototype_registered"],
  configuration: { region: "us", writeKey: "synthetic-analytics-key" },
}

async function fixture() {
  const server = createServer().listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const env = {
    HUB_APPLICATION_ORIGIN: origin,
    HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    HUB_ANALYTICS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    HUB_BOOTSTRAP_SECRET: randomBytes(32).toString("base64url"),
    GITHUB_CLIENT_ID: "synthetic-github-client",
    GITHUB_CLIENT_SECRET: "synthetic-github-client-secret",
    GITHUB_PROVIDER_REVISION: "1",
    GITHUB_APP_ID: "123",
    GITHUB_APP_INSTALLATION_ID: "456",
    GITHUB_WEBHOOK_SECRET: "synthetic-local-github-webhook-key",
    GITHUB_APP_PRIVATE_KEY_BASE64: githubKey,
  }
  const codes = new Map<string, { challenge: string; identity: number }>()
  function github(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
    const url = input instanceof Request ? input.url : input.toString()
    if (url === "https://github.com/login/oauth/access_token") {
      if (!(init?.body instanceof URLSearchParams)) throw new Error("Missing GitHub form.")
      const code = init.body.get("code")
      const expected = code ? codes.get(code) : undefined
      const verifier = init.body.get("code_verifier")
      if (
        !verifier ||
        !expected ||
        createHash("sha256").update(verifier).digest("base64url") !== expected.challenge
      ) {
        return Promise.resolve(new Response(null, { status: 401 }))
      }
      return Promise.resolve(
        Response.json({ access_token: `synthetic/${expected.identity}`, token_type: "bearer" }),
      )
    }
    if (url === "https://api.github.com/user") {
      const accessToken = new Headers(init?.headers).get("authorization")
      const match = accessToken?.match(/^Bearer synthetic\/(\d+)$/i)
      return Promise.resolve(
        match
          ? Response.json({ id: Number(match[1]), login: "not-an-admission-profile" })
          : new Response(null, { status: 401 }),
      )
    }
    throw new Error("Unexpected synthetic GitHub request.")
  }
  const authentication = await createAuthenticationRouteDependencies(env, github)
  const provider = await prisma.authenticationProvider.findUniqueOrThrow({
    where: { key: "github" },
  })
  const providerRevisionId = provider.selectedRevisionId!
  const repository = await prisma.repository.create({
    data: {
      nameWithOwner: "synthetic/repository",
      defaultBranch: "main",
      githubRepositoryId: 1001,
    },
  })
  const otherRepository = await prisma.repository.create({
    data: { nameWithOwner: "synthetic/other", defaultBranch: "main", githubRepositoryId: 1002 },
  })
  const user = await prisma.user.create({
    data: { profile: { create: { provider: "github", login: "original-github-member" } } },
  })
  const identity = await prisma.externalIdentity.create({
    data: { userId: user.id, provider: "github", issuer: "https://github.com", subject: "101" },
  })
  const membership = await prisma.membership.create({ data: { userId: user.id } })
  await prisma.membershipAssignment.create({
    data: {
      membershipId: membership.id,
      externalIdentityId: identity.id,
      providerRevisionId,
      source: "AUTHENTICATION_PROVIDER",
      role: "MEMBER",
      providerAssignmentSubject: "github_repository_access",
    },
  })
  async function sessionCookie() {
    const value = randomBytes(32).toString("base64url")
    await prisma.hubSession.create({
      data: {
        digest: hashAuthenticationValue(value),
        externalIdentityId: identity.id,
        membershipId: membership.id,
        providerRevisionId,
        revocationRevision: 0,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    })
    return `hub_session=${value}`
  }
  const cookie = await sessionCookie()
  let permission: Awaited<ReturnType<LiveRepositoryPermission>> = "admin"
  const product = createProductRouteDependencies({
    analyticsSettings: readAnalyticsSettings(env),
    getRepositoryPermission(viewer) {
      return Promise.resolve(
        viewer.externalIdentityId === identity.id && viewer.role === "MEMBER" ? permission : "none",
      )
    },
  })
  server.on("request", createApp({ authentication, product }))
  const path = `/api/repositories/${repository.id}/analytics`

  function write(
    url: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown,
    session = cookie,
  ) {
    return fetch(`${origin}${url}`, {
      method,
      headers: { origin, cookie: session, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }
  async function begin(
    relative = "/destinations",
    method: "POST" | "PATCH" | "DELETE" = "POST",
    body: unknown = destination,
  ) {
    const started = await write(`${path}${relative}`, method, body)
    expect(started.status).toBe(202)
    const { authorization } = (await started.json()) as {
      authorization: { id: string; authorizationUrl: string }
    }
    const binding = started.headers
      .getSetCookie()
      .find((item) => item.startsWith("hub_analytics_auth_browser="))!
      .split(";")[0]!
    const url = new URL(authorization.authorizationUrl)
    expect(url.searchParams.get("prompt")).toBe("select_account")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.href).not.toContain("synthetic-analytics-key")
    return {
      ...authorization,
      binding,
      url,
      path: `${path}/authorizations/${authorization.id}`,
    }
  }
  async function verify(
    attempt: Awaited<ReturnType<typeof begin>>,
    identity = 101,
    session = cookie,
  ) {
    const code = randomBytes(16).toString("hex")
    codes.set(code, { identity, challenge: attempt.url.searchParams.get("code_challenge")! })
    const search = new URLSearchParams({ code, state: attempt.url.searchParams.get("state")! })
    return fetch(`${origin}/api/auth/github/callback?${search}`, {
      headers: { cookie: `${session}; ${attempt.binding}` },
      redirect: "manual",
    })
  }
  return {
    path,
    otherRepository,
    begin,
    verify,
    write,
    sessionCookie,
    user,
    setPermission(value: typeof permission) {
      permission = value
    },
  }
}

describe("hosted analytics authorization", () => {
  it("uses a fresh GitHub proof for a member with live repo admin access, then applies the exact saved action once", async () => {
    const test = await fixture()
    const attempt = await test.begin()
    expect(await prisma.analyticsDestination.count()).toBe(0)
    const saved = await prisma.analyticsDestinationAuthorization.findUniqueOrThrow({
      where: { id: attempt.id },
    })
    expect(saved.mutationCiphertext).not.toContain(destination.configuration.writeKey)
    expect((await test.write(`${attempt.path}/continue`, "POST", {})).status).toBe(404)
    const verified = await test.verify(attempt)
    expect(verified.status).toBe(303)
    expect(verified.headers.get("location")).toContain(`authorizationId=${attempt.id}`)
    expect(verified.headers.getSetCookie().some((value) => value.startsWith("hub_session="))).toBe(
      false,
    )
    expect(await prisma.hubSession.count()).toBe(1)
    expect(await prisma.userProfile.findUnique({ where: { userId: test.user.id } })).toMatchObject({
      login: "original-github-member",
    })
    expect(await prisma.analyticsDestination.count()).toBe(0)

    const foreign = `/api/repositories/${test.otherRepository.id}/analytics/authorizations/${attempt.id}/continue`
    expect((await test.write(foreign, "POST", {})).status).toBe(404)
    expect(
      (await test.write(`${attempt.path}/continue`, "POST", { action: "delete" })).status,
    ).toBe(422)
    const contenders = await Promise.all([
      test.write(`${attempt.path}/continue`, "POST", {}),
      test.write(`${attempt.path}/continue`, "POST", {}),
    ])
    expect(contenders.map((response) => response.status).sort()).toEqual([200, 404])
    expect(await prisma.analyticsDestination.count()).toBe(1)
    expect(await prisma.analyticsDestinationAuthorization.count()).toBe(0)
  })

  it("discards verification for another GitHub account or another Hub session for the same account", async () => {
    const test = await fixture()
    const wrongIdentity = await test.begin()
    expect((await test.verify(wrongIdentity, 202)).headers.get("location")).toContain(
      "authorization=unavailable",
    )
    expect(await prisma.externalIdentity.count()).toBe(1)
    expect(await prisma.analyticsDestinationAuthorization.count()).toBe(0)
    const wrongSession = await test.begin()
    const parallelSession = await test.sessionCookie()
    expect((await test.verify(wrongSession, 101, parallelSession)).headers.get("location")).toBe(
      "/?authentication=denied",
    )
    expect((await test.write(`${wrongSession.path}/continue`, "POST", {})).status).toBe(404)
    expect(await prisma.analyticsDestination.count()).toBe(0)
  })

  it("cannot continue cancelled, expired, or freshly revoked authorization", async () => {
    const test = await fixture()
    const cancelled = await test.begin()
    expect((await test.write(`${cancelled.path}/cancel`, "POST", {})).status).toBe(200)
    expect((await test.verify(cancelled)).headers.get("location")).toBe("/?authentication=denied")

    const expired = await test.begin()
    await test.verify(expired)
    await prisma.analyticsDestinationAuthorization.update({
      where: { id: expired.id },
      data: { verifiedAt: new Date(Date.now() - 5 * 60_000) },
    })
    expect((await test.write(`${expired.path}/continue`, "POST", {})).status).toBe(404)

    const revoked = await test.begin()
    await test.verify(revoked)
    test.setPermission("maintain")
    expect((await test.write(`${revoked.path}/continue`, "POST", {})).status).toBe(404)
    expect(await prisma.analyticsDestinationAuthorization.count()).toBe(0)
    expect((await test.write(`${test.path}/destinations`, "POST", destination)).status).toBe(404)
    expect(await prisma.analyticsDestination.count()).toBe(0)
  })

  it("binds changes to the chosen destination and rejects settings changed during verification", async () => {
    const test = await fixture()
    const first = await test.begin()
    await test.verify(first)
    expect((await test.write(`${first.path}/continue`, "POST")).status).toBe(200)
    const original = await prisma.analyticsDestination.findFirstOrThrow()
    const path = `/destinations/${original.id}`
    const stale = await test.begin(`${path}/pause`)
    await test.verify(stale)
    await prisma.analyticsDestination.update({
      where: { id: original.id },
      data: { updatedAt: new Date(original.updatedAt.getTime() + 1_000) },
    })
    expect((await test.write(`${stale.path}/continue`, "POST")).status).toBe(409)
    expect(await prisma.analyticsDestinationAuthorization.count()).toBe(0)
    expect(
      await prisma.analyticsDestination.findUniqueOrThrow({ where: { id: original.id } }),
    ).toMatchObject({ enabled: true })

    for (const [action, method, enabled] of [
      ["/pause", "POST", false],
      ["/resume", "POST", true],
      ["", "PATCH", true],
      ["", "DELETE", null],
    ] as const) {
      const attempt = await test.begin(
        `${path}${action}`,
        method,
        method === "PATCH"
          ? { ...destination, configuration: { region: "eu", writeKey: "" } }
          : undefined,
      )
      expect((await test.verify(attempt)).headers.get("location")).toContain(
        `authorizationId=${attempt.id}`,
      )
      expect((await test.write(`${attempt.path}/continue`, "POST")).status).toBe(200)
      const row = await prisma.analyticsDestination.findUnique({ where: { id: original.id } })
      expect(row?.enabled ?? null).toBe(enabled)
    }
  })
})
