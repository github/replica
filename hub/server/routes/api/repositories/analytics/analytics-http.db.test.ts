import { randomBytes } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished } from "vitest"

import { createApp } from "../../../../create-app"
import { readAnalyticsSettings } from "../../../../domains/analytics/read-settings"
import { prisma } from "../../../../integrations/prisma"
import { createAuthenticationRouteDependencies } from "../../auth/create-authentication-route-dependencies"
import { createProductRouteDependencies } from "../../product/create-product-route-dependencies"

function readCookie(response: Response, name: string) {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))
  if (!cookie) throw new Error(`Local sign-in did not set ${name}.`)
  return cookie.split(";")[0]!
}

async function localSession() {
  const server = createServer().listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const env = {
    HUB_APPLICATION_ORIGIN: origin,
    HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    HUB_BOOTSTRAP_SECRET: randomBytes(32).toString("base64url"),
    HUB_LOCAL_SIGN_IN: "true",
  }
  const authentication = await createAuthenticationRouteDependencies(env)
  const product = createProductRouteDependencies({
    analyticsSettings: readAnalyticsSettings(env, true),
    localAnalyticsAdministration: true,
  })
  server.on("request", createApp({ authentication, product }))
  const signIn = await fetch(`${origin}/api/auth/local/start`, {
    method: "POST",
    headers: { origin },
    redirect: "manual",
  })
  const callback = await fetch(new URL(signIn.headers.get("location")!, origin), {
    headers: { cookie: readCookie(signIn, "hub_auth_browser") },
    redirect: "manual",
  })
  return { origin, cookie: readCookie(callback, "hub_session") }
}

describe("repository analytics HTTP API", () => {
  it("allows only same-origin local administration and never returns saved credentials", async () => {
    const repository = await prisma.repository.create({
      data: {
        defaultBranch: "main",
        nameWithOwner: "local/synthetic",
        localPath: "/synthetic/repo",
      },
    })
    const other = await prisma.repository.create({
      data: { defaultBranch: "main", nameWithOwner: "example/hosted", githubRepositoryId: 123 },
    })
    const { origin, cookie } = await localSession()
    const url = `${origin}/api/repositories/${repository.id}/analytics`
    const credential = "synthetic-source-key"
    const input = {
      provider: "segment",
      eventTypes: ["prototype_registered"],
      configuration: { region: "eu", writeKey: credential },
    }
    const body = JSON.stringify(input)
    const forged = await fetch(`${url}/destinations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: "https://example.com" },
      body,
    })
    expect(forged.status).toBe(403)
    expect(await prisma.analyticsDestination.count()).toBe(0)
    const unauthorized = await fetch(`${origin}/api/repositories/${other.id}/analytics`, {
      headers: { cookie },
    })
    expect(unauthorized.status).toBe(404)
    const backfill = await fetch(`${url}/destinations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin },
      body: JSON.stringify({ ...input, includeRetained: true }),
    })
    expect(backfill.status).toBe(422)
    expect(await prisma.analyticsDestination.count()).toBe(0)
    const saved = await fetch(`${url}/destinations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin },
      body,
    })
    expect(saved.status).toBe(201)
    const { id } = (await saved.json()) as { id: string }
    const list = await fetch(url, { headers: { cookie } })
    const text = await list.text()
    expect(text).not.toContain(credential)
    expect(JSON.parse(text)).toMatchObject({
      canMutate: true,
      canExportHistory: false,
      outboundEnabled: false,
      destinations: [{ id, provider: "segment", region: "eu" }],
    })
    expect(
      await prisma.securityAudit.findFirst({ where: { action: "analytics_destination.create" } }),
    ).toMatchObject({ outcome: "SUCCESS", targetId: id, context: { repositoryId: repository.id } })
  })
})
