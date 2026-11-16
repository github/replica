import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished } from "vitest"

import { createApp } from "../../../../../create-app"
import { prisma } from "../../../../../integrations/prisma"
import { createAuthenticationRouteDependencies } from "../../../auth/create-authentication-route-dependencies"
import { createProductRouteDependencies } from "../../../product/create-product-route-dependencies"

const origin = "http://127.0.0.1:5173"
const anchor = {
  schemaVersion: 1,
  kind: "element",
  route: { pathname: "/checkout", search: "", hash: "" },
  selector: "#delivery-address",
  accessibleName: "Delivery address",
  tagName: "section",
  selectedText: "",
  rect: { x: 24, y: 120, width: 640, height: 240 },
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 40 },
  elementOffset: { x: 0.25, y: 0.5 },
}

async function openScopedServer() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const authentication = await createAuthenticationRouteDependencies({
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "test-secret",
    GITHUB_PROVIDER_REVISION: "1",
    GITHUB_APP_ID: "123",
    GITHUB_APP_INSTALLATION_ID: "456",
    GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(
      privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    ).toString("base64"),
    GITHUB_WEBHOOK_SECRET: "test-webhook-secret-at-least-20-characters",
    HUB_APPLICATION_ORIGIN: origin,
    HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    HUB_BOOTSTRAP_SECRET: "test-bootstrap-secret-at-least-32-characters",
  })
  const server = createServer(
    createApp({
      authentication,
      product: createProductRouteDependencies({ scopeGitHubMembers: true }),
    }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

async function createGitHubMember() {
  const provider = await prisma.authenticationProvider.findUniqueOrThrow({
    where: { key: "github" },
  })
  const user = await prisma.user.create({
    data: { profile: { create: { provider: "github", login: randomUUID() } } },
  })
  const identity = await prisma.externalIdentity.create({
    data: { userId: user.id, provider: "github", issuer: "https://github.com", subject: user.id },
  })
  const membership = await prisma.membership.create({ data: { userId: user.id } })
  await prisma.membershipAssignment.create({
    data: {
      membershipId: membership.id,
      externalIdentityId: identity.id,
      providerRevisionId: provider.selectedRevisionId,
      providerAssignmentSubject: identity.subject,
      source: "AUTHENTICATION_PROVIDER",
      role: "MEMBER",
    },
  })
  const token = randomUUID()
  await prisma.hubSession.create({
    data: {
      membershipId: membership.id,
      externalIdentityId: identity.id,
      providerRevisionId: provider.selectedRevisionId,
      digest: createHash("sha256").update(token).digest("hex"),
      revocationRevision: 0,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    },
  })
  return { membership, token }
}

describe("prototype review comments with GitHub repository access", () => {
  it("hides threads and refuses comments when the member cannot read the repository", async () => {
    const serverUrl = await openScopedServer()
    const member = await createGitHubMember()
    const repository = await prisma.repository.create({
      data: { nameWithOwner: `team/review-${randomUUID()}`, defaultBranch: "main" },
    })
    const prototype = await prisma.prototype.create({
      data: {
        repositoryId: repository.id,
        branchName: "prototype/checkout",
        name: "Checkout",
        registeredAt: new Date("2026-11-01T00:00:00Z"),
      },
    })
    const build = await prisma.build.create({
      data: { prototypeId: prototype.id, number: 12, state: "successful" },
    })
    const url = `${serverUrl}/api/repositories/${repository.id}/prototypes/${prototype.id}/review-comments`
    const headers = {
      origin,
      cookie: `hub_session=${member.token}`,
      "content-type": "application/json",
    }
    function comment(body: string) {
      return fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ review_comment: { build_number: build.number, body, anchor } }),
      })
    }

    expect((await fetch(url, { headers })).status).toBe(404)
    expect((await comment("Hidden")).status).toBe(404)
    expect(await prisma.reviewThread.count({ where: { prototypeId: prototype.id } })).toBe(0)

    const grant = await prisma.repositoryAccessGrant.create({
      data: {
        membershipId: member.membership.id,
        repositoryId: repository.id,
        observedAt: new Date(),
      },
    })
    const created = await comment("Visible")
    expect(created.status).toBe(201)
    const [root] = ((await created.json()) as { comments: { id: number }[] }).comments
    if (!root) throw new Error("Expected a root comment")
    expect((await fetch(url, { headers })).status).toBe(200)

    await prisma.repositoryAccessGrant.delete({ where: { id: grant.id } })
    expect((await fetch(url, { headers })).status).toBe(404)
    const reply = await fetch(`${url}/${root.id}/replies`, {
      method: "POST",
      headers,
      body: JSON.stringify({ review_comment: { body: "Hidden reply" } }),
    })
    expect(reply.status).toBe(404)
    expect(await prisma.reviewComment.count({ where: { body: "Hidden reply" } })).toBe(0)
  })
})
