import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished } from "vitest"

import { createApp } from "../../../../../create-app"
import type { RepositoryPermission } from "../../../../../integrations/github/read-repository-permission/types"
import { prisma } from "../../../../../integrations/prisma"
import { createAuthenticationRouteDependencies } from "../../../auth/create-authentication-route-dependencies"
import { createProductRouteDependencies } from "../../../product/create-product-route-dependencies"

function signInCookie(response: Response, name: string) {
  const cookie = response.headers
    .getSetCookie()
    .find((header) => header.startsWith(`${name}=`))
    ?.split(";")[0]
  if (!cookie) throw new Error(`Local sign-in did not set ${name}.`)
  return cookie
}

async function signInAsLocalAdministrator() {
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )

  const { port } = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${port}`
  const authentication = await createAuthenticationRouteDependencies({
    HUB_APPLICATION_ORIGIN: origin,
    HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    HUB_BOOTSTRAP_SECRET: randomBytes(32).toString("base64url"),
    HUB_LOCAL_SIGN_IN: "true",
  })
  server.on("request", createApp({ authentication, product: createProductRouteDependencies() }))

  const start = await fetch(`${origin}/api/auth/local/start`, {
    method: "POST",
    headers: { origin },
    redirect: "manual",
  })
  const location = start.headers.get("location")
  if (!location) throw new Error("Local sign-in did not redirect.")
  const callbackUrl = new URL(location, origin)
  expect(callbackUrl.origin).toBe(origin)
  const callback = await fetch(callbackUrl, {
    headers: { cookie: signInCookie(start, "hub_auth_browser") },
    redirect: "manual",
  })
  return { origin, headers: { cookie: signInCookie(callback, "hub_session") } }
}

const installationId = "456"
const githubLogin = "synthetic-listings-writer"
const githubUserId = 81001

async function openHostedServer(
  githubRepositoryId: number,
  reply: () => Response | Promise<Response>,
  hasBranch?: (name: string) => boolean,
) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )

  const { port } = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${port}`
  const authentication = await createAuthenticationRouteDependencies({
    GITHUB_CLIENT_ID: "synthetic-client",
    GITHUB_CLIENT_SECRET: randomUUID(),
    GITHUB_PROVIDER_REVISION: "1",
    GITHUB_APP_ID: "123",
    GITHUB_APP_INSTALLATION_ID: installationId,
    GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(
      privateKey.export({ format: "pem", type: "pkcs8" }),
    ).toString("base64"),
    GITHUB_WEBHOOK_SECRET: randomUUID(),
    HUB_APPLICATION_ORIGIN: origin,
    HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    HUB_BOOTSTRAP_SECRET: randomUUID(),
  })
  const options = {
    scopeGitHubMembers: true,
    githubRepositoryCredentials: { appId: "123", installationId, privateKey },
    requestGitHub: (async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.origin === "https://api.github.com") {
        if (
          init?.method === "POST" &&
          url.pathname === `/app/installations/${installationId}/access_tokens`
        ) {
          if (typeof init.body !== "string") throw new Error("Missing GitHub repository IDs.")
          const payload: unknown = JSON.parse(init.body)
          expect(payload).toEqual({ repository_ids: [githubRepositoryId] })
          return Response.json({ token: "synthetic-installation-token" })
        }
        if (init?.method === "GET" && url.pathname === `/repositories/${githubRepositoryId}`) {
          return Response.json({ id: githubRepositoryId, full_name: "team/checkout-renamed" })
        }
        if (
          init?.method === "GET" &&
          url.pathname === `/repos/team/checkout-renamed/collaborators/${githubLogin}/permission`
        ) {
          return reply()
        }
        const branchPath = "/repos/team/checkout-renamed/branches/"
        if (hasBranch && init?.method === "GET" && url.pathname.startsWith(branchPath)) {
          const name = decodeURIComponent(url.pathname.slice(branchPath.length))
          return hasBranch(name) ? Response.json({ name }) : new Response(null, { status: 404 })
        }
      }
      throw new Error(`Unexpected synthetic GitHub request: ${init?.method} ${url.pathname}`)
    }) satisfies typeof fetch,
  }
  server.on(
    "request",
    createApp({ authentication, product: createProductRouteDependencies(options) }),
  )
  return origin
}

async function issueSession({
  membershipId,
  externalIdentityId,
  providerRevisionId,
}: {
  membershipId: string
  externalIdentityId: string
  providerRevisionId: string
}) {
  const token = randomUUID()
  await prisma.hubSession.create({
    data: {
      membershipId,
      externalIdentityId,
      providerRevisionId,
      digest: createHash("sha256").update(token).digest("hex"),
      revocationRevision: 0,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    },
  })
  return { headers: { cookie: `hub_session=${token}` } }
}

async function hostedGitHubViewer(repositoryId: string, administrator = false) {
  const { selectedRevisionId: providerRevisionId } =
    await prisma.authenticationProvider.findUniqueOrThrow({ where: { key: "github" } })
  if (!providerRevisionId) throw new Error("The synthetic GitHub provider was not selected.")
  const user = await prisma.user.create({
    data: { profile: { create: { provider: "github", login: githubLogin } } },
  })
  const identity = await prisma.externalIdentity.create({
    data: {
      userId: user.id,
      provider: "github",
      issuer: "https://github.com",
      subject: String(githubUserId),
    },
  })
  const membership = await prisma.membership.create({ data: { userId: user.id } })
  await prisma.membershipAssignment.create({
    data: {
      membershipId: membership.id,
      externalIdentityId: identity.id,
      ...(administrator
        ? { source: "BOOTSTRAP", role: "ADMINISTRATOR" }
        : {
            source: "AUTHENTICATION_PROVIDER",
            role: "MEMBER",
            providerRevisionId,
            providerAssignmentSubject: identity.subject,
          }),
    },
  })
  await prisma.repositoryAccessGrant.create({
    data: { repositoryId, membershipId: membership.id, observedAt: new Date() },
  })
  const session = await issueSession({
    membershipId: membership.id,
    externalIdentityId: identity.id,
    providerRevisionId,
  })
  return { ...session, userId: user.id, membershipId: membership.id }
}

async function hostedEntraSession({
  userId,
  membershipId,
}: {
  userId: string
  membershipId: string
}) {
  const provider = await prisma.authenticationProvider.create({
    data: { key: "entra", enabled: false },
  })
  const revision = await prisma.authenticationProviderRevision.create({
    data: { providerId: provider.id, revision: 1, configurationDigest: "a".repeat(64) },
  })
  await prisma.authenticationProvider.update({
    where: { id: provider.id },
    data: { enabled: true, selectedRevisionId: revision.id },
  })
  const identity = await prisma.externalIdentity.create({
    data: {
      userId,
      provider: "entra",
      issuer: "https://login.microsoftonline.com/6d043a3d-8676-4168-a473-bf35cb21cb6e/v2.0",
      subject: "synthetic-entra-subject",
    },
  })
  return issueSession({
    membershipId,
    externalIdentityId: identity.id,
    providerRevisionId: revision.id,
  })
}

function registerDraft(origin: string, path: string, headers: { cookie: string }) {
  return fetch(`${origin}${path}`, {
    method: "PATCH",
    headers: { ...headers, origin, "content-type": "application/json" },
    body: JSON.stringify({ name: "Listed checkout" }),
  })
}

describe("prototype management GET API", () => {
  it("separates eligible drafts and registered prototypes and omits ineligible branches", async () => {
    const repository = await prisma.repository.create({
      data: {
        defaultBranch: "trunk",
        localPath: "/prototype-root/checkout",
        nameWithOwner: "local/checkout",
      },
    })
    const repositoryId = repository.id
    const candidate = {
      id: randomUUID(),
      branchName: "feature/address",
      name: "New address form",
      description: "An alternate address form.",
      startPage: "/checkout/address",
    }
    const registered = {
      id: randomUUID(),
      branchName: "feature/payment",
      name: "Payment options",
      description: "A new payment step.",
      startPage: "/checkout/payment",
    }
    const registeredAt = new Date("2026-10-01T00:00:00Z")
    await prisma.prototype.createMany({
      data: [
        { repositoryId, ...candidate },
        { repositoryId, ...registered, registeredAt },
        { repositoryId, branchName: repository.defaultBranch, name: "Default branch" },
        { repositoryId, branchName: "replica/install-workflow", name: "Install workflow" },
        { repositoryId, branchName: "feature/replica", name: "Replica", replica: true },
        {
          repositoryId,
          branchName: "feature/deleted",
          name: "Deleted prototype",
          registeredAt,
          branchDeletedAt: new Date("2026-10-02T00:00:00Z"),
        },
      ],
    })

    const { origin, headers } = await signInAsLocalAdministrator()
    const repositoryUrl = `${origin}/api/repositories/${repositoryId}`
    const response = await fetch(`${repositoryUrl}/prototype-management`, { headers })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      repository: { id: repositoryId },
      registered: [{ ...registered, canEdit: true }],
      candidates: [candidate],
      canManage: true,
    })
  })

  it("returns not found for a non-local repository the local administrator can browse", async () => {
    const repository = await prisma.repository.create({
      data: {
        defaultBranch: "trunk",
        githubRepositoryId: 1001,
        nameWithOwner: "team/checkout",
      },
    })
    await prisma.prototype.create({
      data: {
        repositoryId: repository.id,
        branchName: "feature/address",
        name: "New address form",
      },
    })
    const { origin, headers } = await signInAsLocalAdministrator()
    const repositoryUrl = `${origin}/api/repositories/${repository.id}`

    const gallery = await fetch(repositoryUrl, { headers })
    expect(gallery.status).toBe(200)

    const management = await fetch(`${repositoryUrl}/prototype-management`, { headers })
    expect(management.status).toBe(404)
  })

  it("lists only the selected hosted repository's eligible branches at GitHub write permission", async () => {
    const githubRepositoryId = 27101
    const repository = await prisma.repository.create({
      data: { githubRepositoryId, nameWithOwner: "team/checkout", defaultBranch: "trunk" },
    })
    const other = await prisma.repository.create({
      data: { githubRepositoryId: 27102, nameWithOwner: "team/other", defaultBranch: "trunk" },
    })
    const repositoryId = repository.id
    const candidate = { id: randomUUID(), branchName: "feature/address", name: "Address form" }
    const registered = { id: randomUUID(), branchName: "feature/payment", name: "Payment options" }
    const registeredAt = new Date("2026-10-01T00:00:00Z")
    await prisma.prototype.createMany({
      data: [
        { repositoryId, ...candidate },
        { repositoryId, ...registered, registeredAt },
        { repositoryId, branchName: "trunk", name: "Default", registeredAt },
        { repositoryId, branchName: "replica/install-workflow", name: "Install workflow" },
        { repositoryId, branchName: "feature/replica", replica: true },
        {
          repositoryId,
          branchName: "feature/deleted",
          name: "Deleted prototype",
          registeredAt,
          branchDeletedAt: new Date("2026-10-02T00:00:00Z"),
        },
        { repositoryId: other.id, branchName: candidate.branchName, name: "Other checkout" },
      ],
    })

    const origin = await openHostedServer(githubRepositoryId, () =>
      Response.json({ permission: "write", user: { id: githubUserId } }),
    )
    const { headers } = await hostedGitHubViewer(repositoryId)
    const response = await fetch(
      `${origin}/api/repositories/${repositoryId}/prototype-management`,
      { headers },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      repository: { id: repositoryId },
      registered: [{ ...registered, canEdit: true }],
      candidates: [candidate],
      canManage: true,
    })
  })

  it("registers a hosted draft only with current GitHub write access and a live branch", async () => {
    const githubRepositoryId = 27103
    const repository = await prisma.repository.create({
      data: { githubRepositoryId, nameWithOwner: "team/checkout", defaultBranch: "trunk" },
    })
    const draft = await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "feature/checkout" },
    })
    let permission: RepositoryPermission = "read"
    let branchExists = true
    const branchChecks: string[] = []
    const origin = await openHostedServer(
      githubRepositoryId,
      () => Response.json({ permission, user: { id: githubUserId } }),
      (name) => {
        branchChecks.push(name)
        return name === draft.branchName && branchExists
      },
    )
    const github = await hostedGitHubViewer(repository.id, true)
    const path = `/api/repositories/${repository.id}/prototypes/${draft.id}`

    expect((await registerDraft(origin, path, github.headers)).status).toBe(404)
    permission = "maintain"
    const entra = await hostedEntraSession(github)
    expect((await registerDraft(origin, path, entra.headers)).status).toBe(404)
    expect(branchChecks).toEqual([])

    branchExists = false
    expect((await registerDraft(origin, path, github.headers)).status).toBe(404)
    expect(branchChecks).toContain(draft.branchName)
    expect(await prisma.prototype.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      name: null,
      registeredAt: null,
    })

    branchExists = true
    expect((await registerDraft(origin, path, github.headers)).status).toBe(200)
    const saved = await prisma.prototype.findUniqueOrThrow({ where: { id: draft.id } })
    expect(saved.name).toBe("Listed checkout")
    expect(saved.registeredAt).toBeInstanceOf(Date)

    const listingPath = `/api/repositories/${repository.id}/prototype-management/${draft.id}`
    permission = "read"
    expect((await registerDraft(origin, listingPath, github.headers)).status).toBe(404)
    permission = "write"
    expect((await registerDraft(origin, listingPath, github.headers)).status).toBe(200)
    expect(await prisma.prototype.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      authorId: saved.authorId,
      registeredAt: saved.registeredAt,
    })
  })

  it("does not list hosted branches when current repository authority cannot be confirmed", async () => {
    const githubRepositoryId = 27104
    const repository = await prisma.repository.create({
      data: { githubRepositoryId, nameWithOwner: "team/checkout", defaultBranch: "trunk" },
    })
    await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "feature/checkout" },
    })
    let permissionResponse = Response.json({ permission: "write", user: { id: githubUserId } })
    let signOutDuringPermissionCheck = false
    const viewer = { headers: { cookie: "" } }
    const origin = await openHostedServer(githubRepositoryId, async () => {
      if (signOutDuringPermissionCheck) {
        const signedOut = await fetch(`${origin}/api/auth/session/sign-out`, {
          method: "POST",
          headers: { ...viewer.headers, origin },
        })
        expect(signedOut.status).toBe(204)
      }
      return permissionResponse.clone()
    })
    const { headers } = await hostedGitHubViewer(repository.id)
    viewer.headers = headers
    const url = `${origin}/api/repositories/${repository.id}/prototype-management`

    expect((await fetch(url, { headers })).status).toBe(200)

    permissionResponse = Response.json({ permission: "triage", user: { id: githubUserId } })
    expect((await fetch(url, { headers })).status).toBe(404)
    permissionResponse = Response.json({ permission: "admin", user: { id: githubUserId + 1 } })
    expect((await fetch(url, { headers })).status).toBe(404)
    permissionResponse = new Response(null, { status: 503 })
    expect((await fetch(url, { headers })).status).toBe(503)
    permissionResponse = Response.json({ permission: "write", user: { id: githubUserId } })
    signOutDuringPermissionCheck = true
    expect((await fetch(url, { headers })).status).toBe(401)
  })
})
