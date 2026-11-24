import { createHash, generateKeyPairSync, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createApp } from "../../../../create-app"
import { createReviewDirectory } from "../../../../integrations/github/create-review-directory"
import { prisma } from "../../../../integrations/prisma"
import { createAuthenticationRouteDependencies } from "../../auth/create-authentication-route-dependencies"
import { createProductRouteDependencies } from "../../product/create-product-route-dependencies"

async function openNavigation(provider: "local" | "github") {
  const requestGitHub = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("Navigation must not call GitHub."))
  const privateKey =
    provider === "github" ? generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey : null
  const authentication = await createAuthenticationRouteDependencies(
    {
      HUB_APPLICATION_ORIGIN: "http://127.0.0.1:5173",
      HUB_AUTHENTICATION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      HUB_BOOTSTRAP_SECRET: "synthetic-bootstrap-secret-at-least-32-characters",
      ...(privateKey
        ? {
            GITHUB_CLIENT_ID: "synthetic-client",
            GITHUB_CLIENT_SECRET: "synthetic-secret",
            GITHUB_PROVIDER_REVISION: "1",
            GITHUB_APP_ID: "123",
            GITHUB_APP_INSTALLATION_ID: "456",
            GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(
              privateKey.export({ format: "pem", type: "pkcs8" }),
            ).toString("base64"),
            GITHUB_WEBHOOK_SECRET: "synthetic-webhook-secret-at-least-20-characters",
          }
        : { NODE_ENV: "development", HUB_LOCAL_SIGN_IN: "true" }),
    },
    requestGitHub,
  )
  const subject = provider === "github" ? "501" : "local-viewer"
  const user = await prisma.user.create({
    data: { profile: { create: { provider, login: "renamed-viewer" } } },
  })
  const identity = await prisma.externalIdentity.create({
    data: {
      userId: user.id,
      provider,
      issuer: provider === "github" ? "https://github.com" : "http://localhost",
      subject,
    },
  })
  const membership = await prisma.membership.create({ data: { userId: user.id } })
  await prisma.membershipAssignment.create({
    data: {
      membershipId: membership.id,
      externalIdentityId: identity.id,
      source: "BOOTSTRAP",
      role: "ADMINISTRATOR",
    },
  })
  const { selectedRevisionId } = await prisma.authenticationProvider.findUniqueOrThrow({
    where: { key: provider },
  })
  const { revision } = await prisma.sessionRevocationState.findUniqueOrThrow({
    where: { key: "global" },
  })
  const token = randomUUID()
  const session = await prisma.hubSession.create({
    data: {
      membershipId: membership.id,
      externalIdentityId: identity.id,
      providerRevisionId: selectedRevisionId,
      digest: createHash("sha256").update(token).digest("hex"),
      revocationRevision: revision,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    },
  })
  const getRepositoryPermission = vi.fn().mockResolvedValue("none")
  const server = createServer(
    createApp({
      authentication,
      product: createProductRouteDependencies({
        scopeGitHubMembers: provider === "github",
        getRepositoryPermission,
        githubReviewDirectory: privateKey
          ? createReviewDirectory(
              { appId: "123", installationId: "456", privateKey },
              requestGitHub,
            )
          : undefined,
      }),
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
  function navigate() {
    return fetch(`http://127.0.0.1:${port}/api/workspace?view=navigation`, {
      headers: { cookie: `hub_session=${token}` },
    })
  }
  async function snapshot() {
    const response = await navigate()
    expect(response.status).toBe(200)
    return (await response.json()) as {
      repositories: { id: string }[]
      inboxHasUnread?: boolean
      reviewInboxAvailable?: boolean
    }
  }
  return {
    navigate,
    snapshot,
    userId: user.id,
    membershipId: membership.id,
    sessionId: session.id,
    githubSubject: subject,
    requestGitHub,
    getRepositoryPermission,
  }
}

async function saveNotice({
  repositoryId,
  actorId,
  recipientKey,
  branchName = "prototype/welcome",
  registeredAt = new Date("2026-10-01T00:00:00Z"),
  branchDeletedAt,
  replica,
  deletedAt,
  buildState = "successful",
}: {
  repositoryId: string
  actorId: string
  recipientKey: string
  branchName?: string
  registeredAt?: Date | null
  branchDeletedAt?: Date
  replica?: boolean
  deletedAt?: Date
  buildState?: "successful" | "failed"
}) {
  const { id: prototypeId } = await prisma.prototype.create({
    data: { repositoryId, branchName, name: branchName, registeredAt, branchDeletedAt, replica },
  })
  const { id: buildId } = await prisma.build.create({
    data: { prototypeId, number: 1, state: buildState },
  })
  const { id: threadId } = await prisma.reviewThread.create({
    data: { repositoryId, prototypeId, buildId, anchor: { kind: "element" } },
  })
  const { id: commentId } = await prisma.reviewComment.create({
    data: {
      threadId,
      authorId: actorId,
      authorLogin: "author",
      body: "Please review.",
      createdAt: new Date("2026-10-01T00:00:00Z"),
      deletedAt,
    },
  })
  return prisma.reviewNotification.create({
    data: {
      commentId,
      actorId,
      actorLogin: "author",
      kind: "comment",
      recipientKey,
      sourceKey: commentId,
    },
  })
}

describe("workspace navigation Inbox unread state", () => {
  it("uses stored GitHub grants even for a Hub administrator and never checks GitHub live", async () => {
    const viewer = await openNavigation("github")
    const { id: actorId } = await prisma.user.create({ data: {} })
    const { id: repositoryId } = await prisma.repository.create({
      data: { nameWithOwner: "team/design", defaultBranch: "main", githubRepositoryId: 771 },
    })
    const author = await prisma.membership.create({ data: { userId: actorId } })
    await prisma.repositoryAccessGrant.create({
      data: { repositoryId, membershipId: author.id, observedAt: new Date() },
    })
    const mention = await saveNotice({
      repositoryId,
      actorId,
      recipientKey: `github:${viewer.githubSubject}`,
    })
    await saveNotice({
      repositoryId,
      actorId,
      recipientKey: "github:502",
      branchName: "prototype/another-recipient",
    })

    expect(await viewer.snapshot()).toMatchObject({
      repositories: [expect.objectContaining({ id: repositoryId })],
      reviewInboxAvailable: true,
      inboxHasUnread: false,
    })
    const grant = await prisma.repositoryAccessGrant.create({
      data: { repositoryId, membershipId: viewer.membershipId, observedAt: new Date() },
    })
    expect((await viewer.snapshot()).inboxHasUnread).toBe(true)

    await prisma.reviewNotification.update({
      where: { id: mention.id },
      data: { readAt: new Date() },
    })
    expect((await viewer.snapshot()).inboxHasUnread).toBe(false)
    await saveNotice({
      repositoryId,
      actorId,
      recipientKey: `user:${viewer.userId}`,
      branchName: "prototype/follow-up",
    })
    expect((await viewer.snapshot()).inboxHasUnread).toBe(true)

    await prisma.repositoryAccessGrant.delete({ where: { id: grant.id } })
    expect((await viewer.snapshot()).inboxHasUnread).toBe(false)
    expect(viewer.requestGitHub).not.toHaveBeenCalled()
    expect(viewer.getRepositoryPermission).not.toHaveBeenCalled()
  })

  it("ignores notices outside the active local viewer's eligible Inbox", async () => {
    const viewer = await openNavigation("local")
    const { id: actorId } = await prisma.user.create({ data: {} })
    const { id: repositoryId } = await prisma.repository.create({
      data: { nameWithOwner: "team/local", defaultBranch: "trunk", localPath: "/workspace/local" },
    })
    const retiredAt = new Date("2026-10-02T00:00:00Z")
    const hosted = await prisma.repository.create({
      data: { nameWithOwner: "team/hosted", defaultBranch: "main", githubRepositoryId: 772 },
    })
    const removed = await prisma.repository.create({
      data: {
        nameWithOwner: "team/removed",
        defaultBranch: "main",
        localPath: "/workspace/removed",
        removedAt: retiredAt,
      },
    })
    const recipientKey = `user:${viewer.userId}`
    for (const excluded of [
      { branchName: "prototype/other-viewer", recipientKey: `user:${actorId}` },
      { branchName: "prototype/deleted-comment", deletedAt: retiredAt },
      { branchName: "prototype/draft", registeredAt: null },
      { branchName: "prototype/retired", branchDeletedAt: retiredAt },
      { branchName: "replica/example", registeredAt: null, replica: true },
      { branchName: "trunk" },
      { branchName: "replica/install-workflow" },
      { branchName: "prototype/failed-build", buildState: "failed" as const },
      { repositoryId: hosted.id },
      { repositoryId: removed.id },
    ]) {
      await saveNotice({ repositoryId, actorId, recipientKey, ...excluded })
    }
    expect((await viewer.snapshot()).inboxHasUnread).toBe(false)

    const notice = await saveNotice({ repositoryId, actorId, recipientKey })
    expect((await viewer.snapshot()).inboxHasUnread).toBe(true)
    await prisma.reviewNotification.update({
      where: { id: notice.id },
      data: { readAt: new Date() },
    })
    expect((await viewer.snapshot()).inboxHasUnread).toBe(false)

    await prisma.reviewNotification.update({ where: { id: notice.id }, data: { readAt: null } })
    await prisma.hubSession.update({
      where: { id: viewer.sessionId },
      data: { endedAt: new Date() },
    })
    const signedOut = await viewer.navigate()
    expect(signedOut.status).toBe(401)
    expect(await signedOut.json()).not.toHaveProperty("inboxHasUnread")
  })
})
