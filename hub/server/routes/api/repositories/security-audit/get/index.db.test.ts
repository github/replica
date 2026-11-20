import { createHash, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished } from "vitest"

import { createApp } from "../../../../../create-app"
import { prisma } from "../../../../../integrations/prisma"
import { createAuthenticationRouteDependencies } from "../../../auth/create-authentication-route-dependencies"
import { createProductRouteDependencies } from "../../../product/create-product-route-dependencies"
import type { ProductRouteDependencies } from "../../../product/types"
import type { SecurityAuditResponse } from "../../../security-audits/contract"

async function createAuditViewer(providerKey: "github" | "entra") {
  const provider = await prisma.authenticationProvider.create({
    data: { key: providerKey, enabled: false },
  })
  const revision = await prisma.authenticationProviderRevision.create({
    data: { providerId: provider.id, revision: 1, configurationDigest: "a".repeat(64) },
  })
  await prisma.authenticationProvider.update({
    where: { id: provider.id },
    data: { enabled: true, selectedRevisionId: revision.id },
  })
  const user = await prisma.user.create({
    data: { profile: { create: { provider: providerKey, login: `${providerKey}-audit-viewer` } } },
  })
  const identity = await prisma.externalIdentity.create({
    data: {
      userId: user.id,
      provider: providerKey,
      issuer:
        providerKey === "github"
          ? "https://github.com"
          : "https://login.microsoftonline.com/6d043a3d-8676-4168-a473-bf35cb21cb6e/v2.0",
      subject: providerKey === "github" ? "72001" : "synthetic-entra-audit-viewer",
    },
  })
  const membership = await prisma.membership.create({ data: { userId: user.id } })
  await prisma.membershipAssignment.create({
    data: {
      membershipId: membership.id,
      externalIdentityId: identity.id,
      ...(providerKey === "entra"
        ? { source: "BOOTSTRAP", role: "ADMINISTRATOR" }
        : {
            source: "AUTHENTICATION_PROVIDER",
            role: "MEMBER",
            providerRevisionId: revision.id,
            providerAssignmentSubject: identity.subject,
          }),
    },
  })
  const token = randomUUID()
  await prisma.hubSession.create({
    data: {
      membershipId: membership.id,
      externalIdentityId: identity.id,
      providerRevisionId: revision.id,
      digest: createHash("sha256").update(token).digest("hex"),
      revocationRevision: 0,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    },
  })
  return {
    headers: { cookie: `hub_session=${token}` },
    membershipId: membership.id,
    externalIdentityId: identity.id,
  }
}

async function openAuditServer(
  getRepositoryPermission: ProductRouteDependencies["getRepositoryPermission"],
) {
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
    HUB_BOOTSTRAP_SECRET: randomUUID(),
  })
  const product = {
    ...createProductRouteDependencies({ scopeGitHubMembers: true }),
    getRepositoryPermission,
  }
  server.on("request", createApp({ authentication, product }))
  return origin
}

describe("repository security audit GET API", () => {
  it("requires admin permission on the selected repository regardless of the Hub role", async () => {
    const administered = await prisma.repository.create({
      data: { githubRepositoryId: 27201, nameWithOwner: "team/checkout", defaultBranch: "main" },
    })
    const maintained = await prisma.repository.create({
      data: { githubRepositoryId: 27202, nameWithOwner: "team/search", defaultBranch: "main" },
    })

    let repositoryAdministrator: string | null = null
    const origin = await openAuditServer((viewer, repositoryId) => {
      if (
        viewer.sessionProvider !== "github" ||
        viewer.externalIdentityId !== repositoryAdministrator
      ) {
        return Promise.resolve("none")
      }
      if (repositoryId === administered.id) return Promise.resolve("admin")
      return Promise.resolve(repositoryId === maintained.id ? "maintain" : "none")
    })
    const member = await createAuditViewer("github")
    const hubAdministrator = await createAuditViewer("entra")
    repositoryAdministrator = member.externalIdentityId
    await prisma.repositoryAccessGrant.createMany({
      data: [administered.id, maintained.id].map((repositoryId) => ({
        repositoryId,
        membershipId: member.membershipId,
        observedAt: new Date(),
      })),
    })
    function auditUrl(id: string) {
      return `${origin}/api/repositories/${id}/security-audit`
    }

    const allowed = await fetch(auditUrl(administered.id), { headers: member.headers })
    expect(allowed.status).toBe(200)
    expect(await allowed.json()).toEqual({ records: [], nextCursor: null })
    expect((await fetch(auditUrl(maintained.id), { headers: member.headers })).status).toBe(404)
    expect(
      (await fetch(auditUrl(administered.id), { headers: hubAdministrator.headers })).status,
    ).toBe(404)
    expect(
      (await fetch(`${origin}/api/security-audits`, { headers: hubAdministrator.headers })).status,
    ).toBe(200)
  })

  it("paginates only the selected repository's events and keeps them out of the Hub audit", async () => {
    const selected = await prisma.repository.create({
      data: { githubRepositoryId: 27203, nameWithOwner: "team/checkout", defaultBranch: "main" },
    })
    const other = await prisma.repository.create({
      data: { githubRepositoryId: 27204, nameWithOwner: "team/search", defaultBranch: "main" },
    })
    const origin = await openAuditServer((viewer) =>
      Promise.resolve(viewer.sessionProvider === "github" ? "admin" : "none"),
    )
    const member = await createAuditViewer("github")
    const hubAdministrator = await createAuditViewer("entra")
    await prisma.repositoryAccessGrant.createMany({
      data: [selected.id, other.id].map((repositoryId) => ({
        repositoryId,
        membershipId: member.membershipId,
        observedAt: new Date(),
      })),
    })
    const firstId = randomUUID()
    const secondId = randomUUID()
    const otherId = randomUUID()
    const hubId = randomUUID()
    const event = {
      action: "prototype.registered",
      context: { actorMembershipId: member.membershipId },
      outcome: "SUCCESS" as const,
      targetType: "prototype",
    }
    await prisma.securityAudit.createMany({
      data: [
        {
          ...event,
          id: firstId,
          repositoryId: selected.id,
          createdAt: new Date("2026-10-04T00:00:00Z"),
        },
        {
          ...event,
          id: otherId,
          repositoryId: other.id,
          createdAt: new Date("2026-10-03T00:00:00Z"),
        },
        {
          id: hubId,
          action: "session.created",
          context: { membershipId: hubAdministrator.membershipId },
          outcome: "SUCCESS",
          targetType: "hub_session",
          createdAt: new Date("2026-10-02T00:00:00Z"),
        },
        {
          ...event,
          id: secondId,
          repositoryId: selected.id,
          createdAt: new Date("2026-10-01T00:00:00Z"),
        },
      ],
    })
    const auditUrl = `${origin}/api/repositories/${selected.id}/security-audit?limit=1`

    const first = await fetch(auditUrl, { headers: member.headers })
    expect(first.status).toBe(200)
    const firstPage = (await first.json()) as SecurityAuditResponse
    expect(firstPage.records).toMatchObject([
      {
        id: firstId,
        action: event.action,
        actor: { membershipId: member.membershipId },
        outcome: "success",
      },
    ])
    expect(typeof firstPage.nextCursor).toBe("string")

    const second = await fetch(`${auditUrl}&before=${encodeURIComponent(firstPage.nextCursor!)}`, {
      headers: member.headers,
    })
    expect(second.status).toBe(200)
    const secondPage = (await second.json()) as SecurityAuditResponse
    expect(secondPage.records.map(({ id }) => id)).toEqual([secondId])
    expect(secondPage.nextCursor).toBeNull()

    const otherAudit = await fetch(`${origin}/api/repositories/${other.id}/security-audit`, {
      headers: member.headers,
    })
    expect(otherAudit.status).toBe(200)
    const otherPage = (await otherAudit.json()) as SecurityAuditResponse
    expect(otherPage.records.map(({ id }) => id)).toEqual([otherId])

    const hub = await fetch(`${origin}/api/security-audits`, { headers: hubAdministrator.headers })
    expect(hub.status).toBe(200)
    const hubPage = (await hub.json()) as SecurityAuditResponse
    expect(hubPage.records.map(({ id }) => id)).toEqual([hubId])
    expect(hubPage.nextCursor).toBeNull()
  })
})
