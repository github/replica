import { createHmac, generateKeyPairSync } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createAdministrationService } from "#server/domains/administration/create-service"
import { createAuthenticationService } from "#server/domains/authentication/create-service"
import { createGitHubAuthorizationService } from "#server/domains/github-authorization/create-service"
import type {
  GitHubAdmissionBaseline,
  GitHubAuthorizationService,
} from "#server/domains/github-authorization/create-service/types"
import { createIdentityStore } from "#server/domains/identity/create-store"
import { digestSecret } from "#server/utils/digest-secret"

import type { PrismaClient } from "../../../generated/prisma/client.ts"

type IdentityStore = ReturnType<typeof createIdentityStore>

function environment() {
  const privateKey = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey
  return {
    HUB_GITHUB_CREDENTIAL_PROVIDER: "environment",
    HUB_GITHUB_WEBHOOK_SECRET: "synthetic-webhook-secret",
    GITHUB_APP_ID: "12345",
    GITHUB_INSTALLATION_ID: "7",
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "synthetic-client-secret",
    GITHUB_PRIVATE_KEY: privateKey,
  }
}

async function database(environmentOverrides: NodeJS.ProcessEnv = {}) {
  vi.stubGlobal("prisma", undefined)
  const { prisma } = await import("../../../integrations/prisma")
  onTestFinished(() => prisma.$disconnect())
  const store = createIdentityStore(prisma)
  return {
    prisma,
    store,
    service: createGitHubAuthorizationService({
      database: prisma,
      environment: { ...environment(), ...environmentOverrides },
      store,
    }),
  }
}

async function createUser(
  store: IdentityStore,
  {
    subject,
    membershipSource = "manual",
    role = "member",
    status = "active",
    token,
  }: {
    subject: string
    membershipSource?: "legacy-synchronized" | "manual" | "synchronized"
    role?: "administrator" | "member"
    status?: "active" | "removed" | "suspended"
    token?: string
  },
) {
  return store.lock(async (records) => {
    const user = await records.createUser({ displayName: `User ${subject}`, avatarUrl: null })
    const identity = await records.saveExternalIdentity({
      userId: user.id,
      provider: "github",
      issuer: "https://github.com",
      subject,
      username: `user-${subject}`,
      displayName: user.displayName,
      avatarUrl: null,
    })
    const provider =
      (await records.currentAuthenticationProviderRevision("github")) ??
      (await records.createAuthenticationProviderRevision({
        key: "github",
        type: "github",
        enabled: true,
        revision: 1,
        issuer: "https://github.com",
        configuration: { clientId: "github-client" },
      }))
    const membership = await records.saveMembership({
      userId: user.id,
      status,
      role,
      source: membershipSource,
      suspendedAt: status === "suspended" ? new Date() : null,
      removedAt: status === "removed" ? new Date() : null,
    })
    const session = token
      ? await records.createSession({
          userId: user.id,
          externalIdentityId: identity.id,
          authenticationProviderRevisionId: provider.id,
          tokenDigest: digestSecret(token),
          signedInAt: new Date(),
          freshAuthorizedAt: new Date(),
        })
      : null
    return { identity, membership, session, user }
  })
}

function webhook(body: object, event: string, deliveryId: string) {
  const encoded = Buffer.from(JSON.stringify(body))
  return {
    body: encoded,
    deliveryId,
    event,
    signature: `sha256=${createHmac("sha256", "synthetic-webhook-secret")
      .update(encoded)
      .digest("hex")}`,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url
}

async function saveAdmissionFixture(
  prisma: PrismaClient,
  service: GitHubAuthorizationService,
  userId: string,
  subject: string,
  baseline: Omit<GitHubAdmissionBaseline, "subject" | "admissionGeneration" | "persist">,
) {
  const attempt = await prisma.gitHubAdmissionAttempt.upsert({
    where: {
      repositorySourceId_subject: {
        repositorySourceId: baseline.repositorySourceId,
        subject,
      },
    },
    create: { repositorySourceId: baseline.repositorySourceId, subject, generation: 1 },
    update: { generation: { increment: 1 } },
  })
  await service.saveAdmissionBaseline(prisma, userId, {
    ...baseline,
    subject,
    admissionGeneration: attempt.generation,
    persist: true,
  })
}

describe("createGitHubAuthorizationService() database behavior", () => {
  it("uses only a fresh baseline for the linked repository and keeps repositories isolated", async () => {
    const { prisma, service, store } = await database()
    const actor = await createUser(store, { subject: "42" })
    const [source, otherSource] = await Promise.all([
      prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "100",
          appId: "12345",
          installationId: "7",
          owner: "owner",
          name: "repository",
          defaultBranch: "main",
        },
      }),
      prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "200",
          appId: "12345",
          installationId: "7",
          owner: "other",
          name: "repository",
          defaultBranch: "main",
        },
      }),
    ])
    const request = vi.fn()
    vi.stubGlobal("fetch", request)

    await expect(
      service.evaluateAdmission({
        subject: "42",
        username: "user-42",
        displayName: "User 42",
        avatarUrl: null,
      }),
    ).resolves.toBeNull()
    expect(request).not.toHaveBeenCalled()
    await prisma.gitHubRepositorySource.update({
      where: { id: source.id },
      data: { admissionEnabled: true },
    })

    const workspace = await prisma.workspace.create({
      data: { name: "Workspace", createdByUserId: actor.user.id },
    })
    const [prototype, otherPrototype] = await Promise.all([
      prisma.prototype.create({
        data: {
          name: "Prototype",
          workspaceId: workspace.id,
          createdByUserId: actor.user.id,
          authorizationMode: "github-synchronized",
          sourceRepositoryId: source.id,
        },
      }),
      prisma.prototype.create({
        data: {
          name: "Other",
          workspaceId: workspace.id,
          createdByUserId: actor.user.id,
          authorizationMode: "github-synchronized",
          sourceRepositoryId: otherSource.id,
        },
      }),
    ])
    const confirmedAt = new Date("2026-10-27T20:00:00.000Z")
    await saveAdmissionFixture(prisma, service, actor.user.id, actor.identity.subject, {
      repositorySourceId: source.id,
      sourceGeneration: source.synchronizationGeneration,
      rawPermission: "write",
      prototypeRole: "editor",
      admissionEligible: true,
      confirmedAt,
    })
    await prisma.gitHubAuthorizationPolicy.create({
      data: { id: "00000000-0000-0000-0000-000000000001", lastKnownGoodSeconds: 60 },
    })

    await expect(
      service.prototypeBaseline(prisma, actor.user.id, prototype.id, confirmedAt),
    ).resolves.toMatchObject({
      role: "editor",
      repositorySourceId: source.id,
      githubRepositoryId: "100",
      rawPermission: "write",
    })
    await expect(
      service.prototypeBaseline(prisma, actor.user.id, otherPrototype.id, confirmedAt),
    ).resolves.toBeNull()
    await expect(
      service.prototypeBaseline(
        prisma,
        actor.user.id,
        prototype.id,
        new Date(confirmedAt.getTime() + 61_000),
      ),
    ).resolves.toBeNull()
  })

  it("removes synchronized state for a repository webhook while preserving manual rules", async () => {
    const { prisma, service, store } = await database()
    const actor = await createUser(store, { subject: "42" })
    const [source, unrelatedSource] = await Promise.all([
      prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "100",
          appId: "12345",
          installationId: "7",
          owner: "owner",
          name: "repository",
          defaultBranch: "main",
          admissionEnabled: true,
        },
      }),
      prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "200",
          appId: "12345",
          installationId: "7",
          owner: "owner",
          name: "unrelated",
          defaultBranch: "main",
          synchronizationStatus: "current",
          lastConfirmedAt: new Date("2026-10-28T18:00:00.000Z"),
        },
      }),
    ])
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
        grants: {
          create: {
            userId: actor.user.id,
            effect: "allow",
            role: "viewer",
          },
        },
      },
    })
    await saveAdmissionFixture(prisma, service, actor.user.id, actor.identity.subject, {
      repositorySourceId: source.id,
      sourceGeneration: source.synchronizationGeneration,
      rawPermission: "read",
      prototypeRole: "viewer",
      admissionEligible: true,
      confirmedAt: new Date(),
    })
    const input = webhook(
      {
        action: "removed",
        installation: { id: 7 },
        repositories_removed: [{ id: 100 }],
      },
      "installation_repositories",
      "delivery-1",
    )

    await expect(service.processWebhook(input)).resolves.toBe("accepted")
    await expect(service.processWebhook(input)).resolves.toBe("duplicate")

    expect(
      await prisma.gitHubRepositorySource.findUnique({ where: { id: source.id } }),
    ).toMatchObject({
      status: "removed",
      admissionEnabled: false,
      synchronizationStatus: "removed",
    })
    expect(
      await prisma.gitHubSynchronizedAccess.findUnique({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: actor.user.id,
          },
        },
      }),
    ).toMatchObject({ status: "removed", synchronizationStatus: "removed" })
    expect(
      await prisma.workspaceAccessGrant.findUnique({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: actor.user.id } },
      }),
    ).toMatchObject({ effect: "allow", role: "viewer" })
    expect(
      await prisma.gitHubRepositorySource.findUnique({ where: { id: unrelatedSource.id } }),
    ).toMatchObject({
      synchronizationGeneration: unrelatedSource.synchronizationGeneration,
      synchronizationStatus: "current",
      dirtyAt: null,
    })
    expect(await prisma.gitHubWebhookDelivery.count()).toBe(1)
  })

  it("reconciles by immutable repository ID with an installation token and revokes lost synchronized access", async () => {
    const { prisma, service, store } = await database()
    const actor = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      token: "session-token",
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "old-owner",
        name: "old-name",
        defaultBranch: "master",
        admissionEnabled: true,
      },
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
        grants: {
          create: { userId: actor.user.id, effect: "allow", role: "commenter" },
        },
      },
    })
    const responses = [
      { token: "installation-token" },
      {
        id: 100,
        full_name: "new-owner/new-name",
        name: "new-name",
        owner: { login: "new-owner" },
        default_branch: "trunk",
        visibility: "private",
      },
      { user: { id: 42 }, permission: "none" },
    ]
    const request = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(
      () => Promise.resolve(new Response(JSON.stringify(responses.shift()), { status: 200 })),
    )
    vi.stubGlobal("fetch", request)

    await expect(service.reconcileDue()).resolves.toBeUndefined()

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/app/installations/7/access_tokens",
      "https://api.github.com/repositories/100",
      "https://api.github.com/repos/new-owner/new-name/collaborators/user-42/permission",
    ])
    expect(new Headers(request.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(
      "Bearer installation-token",
    )
    const reconciled = await prisma.gitHubRepositorySource.findUnique({ where: { id: source.id } })
    expect(reconciled).toMatchObject({
      owner: "new-owner",
      name: "new-name",
      defaultBranch: "trunk",
      synchronizationStatus: "current",
    })
    expect(
      await prisma.installationMembership.findUnique({ where: { id: actor.membership.id } }),
    ).toMatchObject({ status: "removed", source: "synchronized" })
    expect(await prisma.session.findUnique({ where: { id: actor.session!.id } })).toBeNull()
    expect(
      await prisma.workspaceAccessGrant.findUnique({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: actor.user.id } },
      }),
    ).toMatchObject({ effect: "allow", role: "commenter" })

    request.mockReset()
    request.mockResolvedValue(new Response(null, { status: 503 }))

    await expect(service.reconcileDue()).resolves.toBeUndefined()
    expect(
      await prisma.gitHubRepositorySource.findUnique({ where: { id: source.id } }),
    ).toMatchObject({
      synchronizationStatus: "failed",
      lastConfirmedAt: reconciled?.lastConfirmedAt,
    })
  })

  it("does not resurrect a repository removed while reconciliation is waiting on GitHub", async () => {
    const { prisma, service, store } = await database()
    const actor = await createUser(store, { subject: "42" })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "original-owner",
        name: "original-name",
        defaultBranch: "main",
        admissionEnabled: true,
      },
    })
    const workspace = await prisma.workspace.create({
      data: {
        name: "Workspace",
        createdByUserId: actor.user.id,
        grants: {
          create: { userId: actor.user.id, effect: "allow", role: "commenter" },
        },
      },
    })
    await saveAdmissionFixture(prisma, service, actor.user.id, actor.identity.subject, {
      repositorySourceId: source.id,
      sourceGeneration: source.synchronizationGeneration,
      rawPermission: "read",
      prototypeRole: "viewer",
      admissionEligible: true,
      confirmedAt: new Date(),
    })
    const repositoryResponse = deferred<Response>()
    const repositoryRequested = deferred<void>()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input)
        if (url.endsWith("/access_tokens")) {
          return Promise.resolve(
            new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
          )
        }
        if (url.endsWith("/repositories/100")) {
          repositoryRequested.resolve()
          return repositoryResponse.promise
        }
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 42 }, permission: "write" }), {
            status: 200,
          }),
        )
      }),
    )

    const reconciliation = service.reconcileDue()
    await repositoryRequested.promise
    await service.processWebhook(
      webhook(
        {
          action: "removed",
          installation: { id: 7 },
          repositories_removed: [{ id: 100 }],
        },
        "installation_repositories",
        "delivery-during-reconcile",
      ),
    )
    repositoryResponse.resolve(
      new Response(
        JSON.stringify({
          id: 100,
          full_name: "resurrected-owner/resurrected-name",
          name: "resurrected-name",
          owner: { login: "resurrected-owner" },
          default_branch: "trunk",
          visibility: "private",
        }),
        { status: 200 },
      ),
    )
    await reconciliation

    expect(
      await prisma.gitHubRepositorySource.findUnique({ where: { id: source.id } }),
    ).toMatchObject({
      status: "removed",
      owner: "original-owner",
      name: "original-name",
      defaultBranch: "main",
      synchronizationGeneration: 2,
    })
    expect(
      await prisma.gitHubSynchronizedAccess.findUnique({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: actor.user.id,
          },
        },
      }),
    ).toMatchObject({ status: "removed" })
    expect(
      await prisma.workspaceAccessGrant.findUnique({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: actor.user.id } },
      }),
    ).toMatchObject({ effect: "allow", role: "commenter" })
  })

  it("rejects repository metadata observed before a source generation change", async () => {
    const { prisma, service, store } = await database()
    const actor = await createUser(store, { subject: "42" })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "original-owner",
        name: "original-name",
        defaultBranch: "main",
        admissionEnabled: true,
      },
    })
    const sourcesObserved = deferred<void>()
    const continueAdmission = deferred<void>()
    const findMany = prisma.gitHubRepositorySource.findMany.bind(prisma.gitHubRepositorySource)
    vi.spyOn(prisma.gitHubRepositorySource, "findMany").mockImplementation(((args) =>
      findMany(args).then(async (sources) => {
        sourcesObserved.resolve()
        await continueAdmission.promise
        return sources
      })) as typeof prisma.gitHubRepositorySource.findMany)
    const request = vi.fn((input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url.endsWith("/access_tokens")) {
        return Promise.resolve(
          new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 999,
            full_name: "original-owner/original-name",
            name: "original-name",
            owner: { login: "replacement-owner" },
            default_branch: "main",
            visibility: "private",
          }),
          { status: 200 },
        ),
      )
    })
    vi.stubGlobal("fetch", request)

    const admission = service.evaluateAdmission({
      subject: actor.identity.subject,
      username: actor.identity.username!,
      displayName: actor.user.displayName,
      avatarUrl: null,
    })
    await sourcesObserved.promise
    await service.processWebhook(
      webhook(
        {
          action: "added",
          installation: { id: 7 },
          repository: {
            id: 100,
            name: "renamed",
            owner: { login: "new-owner" },
            default_branch: "main",
            visibility: "private",
          },
        },
        "member",
        "source-generation-changed-before-claim",
      ),
    )
    continueAdmission.resolve()

    await expect(admission).resolves.toBeNull()
    expect(request.mock.calls.map(([input]) => requestUrl(input))).toEqual([
      "https://api.github.com/app/installations/7/access_tokens",
    ])
    expect(
      await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: source.id } }),
    ).toMatchObject({
      synchronizationGeneration: source.synchronizationGeneration + 1,
      synchronizationStatus: "dirty",
    })
  })

  it("does not start another scheduled reconciliation while one is running", async () => {
    const { prisma, service, store } = await database()
    await createUser(store, { subject: "42" })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "original-owner",
        name: "original-name",
        defaultBranch: "main",
        admissionEnabled: true,
      },
    })
    const repositoryResponse = deferred<Response>()
    const repositoryRequested = deferred<void>()
    let repositoryRequests = 0
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input)
        if (url.endsWith("/access_tokens")) {
          return Promise.resolve(
            new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
          )
        }
        if (url.endsWith("/repositories/100")) {
          repositoryRequests += 1
          repositoryRequested.resolve()
          return repositoryResponse.promise
        }
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 42 }, permission: "read" }), { status: 200 }),
        )
      }),
    )

    const firstReconciliation = service.reconcileDue()
    await repositoryRequested.promise

    await expect(service.reconcileDue()).resolves.toBeUndefined()
    expect(repositoryRequests).toBe(1)

    repositoryResponse.resolve(
      new Response(
        JSON.stringify({
          id: Number(source.githubRepositoryId),
          full_name: "owner/repository",
          name: "repository",
          owner: { login: "owner" },
          default_branch: "main",
          visibility: "private",
        }),
        { status: 200 },
      ),
    )
    await firstReconciliation

    expect(
      await prisma.gitHubRepositorySource.findUnique({ where: { id: source.id } }),
    ).toMatchObject({
      synchronizationStatus: "current",
      synchronizationGeneration: 1,
    })
  })

  it("applies a long manual reconciliation after freshness expires and attributes its audit", async () => {
    const { prisma, service, store } = await database()
    const administrator = await createUser(store, {
      subject: "41",
      role: "administrator",
      token: "administrator-token",
    })
    const target = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      token: "target-token",
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        admissionEnabled: true,
      },
    })
    const permissionResponse = deferred<Response>()
    const permissionRequested = deferred<void>()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input)
        if (url.endsWith("/access_tokens")) {
          return Promise.resolve(
            new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
          )
        }
        if (url.endsWith("/repositories/100")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 100,
                full_name: "owner/repository",
                name: "repository",
                owner: { login: "owner" },
                default_branch: "main",
                visibility: "private",
              }),
              { status: 200 },
            ),
          )
        }
        if (url.includes("user-42")) {
          permissionRequested.resolve()
          return permissionResponse.promise
        }
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 41 }, permission: "write" }), { status: 200 }),
        )
      }),
    )

    const reconciliation = service.reconcileRepository("administrator-token", source.id)
    await permissionRequested.promise
    await prisma.session.update({
      where: { id: administrator.session!.id },
      data: { freshAuthorizedAt: new Date(Date.now() - 6 * 60_000) },
    })
    permissionResponse.resolve(
      new Response(JSON.stringify({ user: { id: 42 }, permission: "none" }), { status: 200 }),
    )

    await expect(reconciliation).resolves.toMatchObject({
      id: source.id,
      synchronizationStatus: "current",
    })
    expect(
      await prisma.installationMembership.findUnique({ where: { id: target.membership.id } }),
    ).toMatchObject({ source: "synchronized", status: "removed" })
    expect(await prisma.session.findUnique({ where: { id: target.session!.id } })).toBeNull()
    expect(
      await prisma.securityAudit.findFirst({
        where: { event: "github.repository.reconcile", githubRepositorySourceId: source.id },
      }),
    ).toMatchObject({
      actorUserId: administrator.user.id,
      sessionId: administrator.session!.id,
      authenticationProviderRevisionId: administrator.session!.authenticationProviderRevisionId,
    })
  })

  it("persists a live denial so a later outage cannot reuse the old positive cache", async () => {
    const { prisma, service, store } = await database()
    const actor = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
    })
    const [sourceA, sourceB] = await Promise.all([
      prisma.gitHubRepositorySource.create({
        data: {
          id: "00000000-0000-0000-0000-000000000001",
          githubRepositoryId: "100",
          appId: "12345",
          installationId: "7",
          owner: "owner",
          name: "repository-a",
          defaultBranch: "main",
          admissionEnabled: true,
        },
      }),
      prisma.gitHubRepositorySource.create({
        data: {
          id: "00000000-0000-0000-0000-000000000002",
          githubRepositoryId: "200",
          appId: "12345",
          installationId: "7",
          owner: "owner",
          name: "repository-b",
          defaultBranch: "main",
          admissionEnabled: true,
        },
      }),
    ])
    await saveAdmissionFixture(prisma, service, actor.user.id, actor.identity.subject, {
      repositorySourceId: sourceA.id,
      sourceGeneration: sourceA.synchronizationGeneration,
      rawPermission: "write",
      prototypeRole: "editor",
      admissionEligible: true,
      confirmedAt: new Date(),
    })
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input)
        if (url.endsWith("/access_tokens")) {
          return Promise.resolve(
            new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
          )
        }
        if (url.endsWith("/repositories/100")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 100,
                full_name: "owner/repository-a",
                name: "repository-a",
                owner: { login: "owner" },
                default_branch: "main",
                visibility: "private",
              }),
              { status: 200 },
            ),
          )
        }
        if (url.includes("/repos/owner/repository-a/")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                user: { id: 42 },
                permission: "none",
                role_name: "none",
              }),
              { status: 200 },
            ),
          )
        }
        if (url.endsWith("/repositories/200")) {
          return Promise.resolve(new Response(null, { status: 503 }))
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )

    await expect(
      service.evaluateAdmission({
        subject: actor.identity.subject,
        username: actor.identity.username!,
        displayName: actor.user.displayName,
        avatarUrl: null,
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: "source_integration_unavailable",
    })

    expect(
      await prisma.gitHubSynchronizedAccess.findUnique({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: sourceA.id,
            userId: actor.user.id,
          },
        },
      }),
    ).toMatchObject({
      rawPermission: "none",
      admissionEligible: false,
      mappedPrototypeRole: null,
      status: "removed",
    })
    expect(sourceB.id).not.toBe(sourceA.id)

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) =>
        Promise.resolve(
          requestUrl(input).endsWith("/access_tokens")
            ? new Response(JSON.stringify({ token: "installation-token" }), { status: 200 })
            : new Response(null, { status: 503 }),
        ),
      ),
    )

    await expect(
      service.evaluateAdmission({
        subject: actor.identity.subject,
        username: actor.identity.username!,
        displayName: actor.user.displayName,
        avatarUrl: null,
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: "source_integration_unavailable",
    })
  })

  it("uses a fresh cached grant after metadata succeeds without persisting the fallback", async () => {
    const { prisma, service, store } = await database()
    const actor = await createUser(store, { subject: "42" })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        admissionEnabled: true,
      },
    })
    const confirmedAt = new Date()
    await saveAdmissionFixture(prisma, service, actor.user.id, actor.identity.subject, {
      repositorySourceId: source.id,
      sourceGeneration: source.synchronizationGeneration,
      rawPermission: "read",
      prototypeRole: "viewer",
      admissionEligible: true,
      confirmedAt,
    })
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input)
        if (url.endsWith("/access_tokens")) {
          return Promise.resolve(
            new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
          )
        }
        if (url.endsWith("/repositories/100")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 100,
                full_name: "owner/repository",
                name: "repository",
                owner: { login: "owner" },
                default_branch: "main",
                visibility: "private",
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(new Response(null, { status: 503 }))
      }),
    )

    const admission = await service.evaluateAdmission({
      subject: actor.identity.subject,
      username: actor.identity.username!,
      displayName: actor.user.displayName,
      avatarUrl: null,
    })
    expect(admission).toEqual({
      repositorySourceId: source.id,
      sourceGeneration: source.synchronizationGeneration,
      subject: actor.identity.subject,
      admissionGeneration: 0,
      persist: false,
      rawPermission: "read",
      admissionEligible: true,
      prototypeRole: "viewer",
      confirmedAt,
    })
    await service.saveAdmissionBaseline(prisma, actor.user.id, admission!)
    expect(
      await prisma.gitHubSynchronizedAccess.findUniqueOrThrow({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: actor.user.id,
          },
        },
      }),
    ).toMatchObject({
      rawPermission: "read",
      lastConfirmedAt: confirmedAt,
    })
    expect(
      await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: source.id } }),
    ).toMatchObject({ synchronizationGeneration: source.synchronizationGeneration })
  })

  it.each([
    { appId: "99999", installationId: "7", mismatch: "App" },
    { appId: "12345", installationId: "8", mismatch: "installation" },
  ])(
    "does not use cached access after token creation fails when the source $mismatch ID differs",
    async ({ appId, installationId }) => {
      const { prisma, service, store } = await database()
      const actor = await createUser(store, {
        subject: "42",
        membershipSource: "synchronized",
      })
      const source = await prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "100",
          appId,
          installationId,
          owner: "owner",
          name: "repository",
          defaultBranch: "main",
          admissionEnabled: true,
        },
      })
      await saveAdmissionFixture(prisma, service, actor.user.id, actor.identity.subject, {
        repositorySourceId: source.id,
        sourceGeneration: source.synchronizationGeneration,
        rawPermission: "read",
        prototypeRole: "viewer",
        admissionEligible: true,
        confirmedAt: new Date(),
      })
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })))

      await expect(
        service.evaluateAdmission({
          subject: actor.identity.subject,
          username: actor.identity.username!,
          displayName: actor.user.displayName,
          avatarUrl: null,
        }),
      ).rejects.toMatchObject({
        status: 503,
        code: "source_integration_unavailable",
      })
    },
  )

  it.each([
    { membershipSource: "manual", expected: "preserved" },
    { membershipSource: "synchronized", expected: "closed" },
  ] as const)(
    "fails $expected when stored source credentials cannot be decrypted for a $membershipSource membership",
    async ({ membershipSource }) => {
      const { prisma, service, store } = await database({
        HUB_GITHUB_CREDENTIAL_PROVIDER: "database",
        HUB_GITHUB_CREDENTIAL_KEY: "ab".repeat(32),
      })
      const actor = await createUser(store, { subject: "42", membershipSource })
      await prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "100",
          appId: "12345",
          installationId: "7",
          owner: "owner",
          name: "repository",
          defaultBranch: "main",
          admissionEnabled: true,
        },
      })
      await store.lock((records) =>
        records.saveGitHubIntegrationCredentials("invalid-encrypted-credentials"),
      )
      const admission = service.evaluateAdmission({
        subject: actor.identity.subject,
        username: actor.identity.username!,
        displayName: actor.user.displayName,
        avatarUrl: null,
      })

      if (membershipSource === "manual") {
        await expect(admission).resolves.toBeNull()
      } else {
        await expect(admission).rejects.toMatchObject({
          status: 503,
          code: "source_integration_unavailable",
        })
      }
    },
  )

  it("rejects baseline saves from a stale source generation or older confirmation", async () => {
    const { prisma, service, store } = await database()
    const actor = await createUser(store, { subject: "42" })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        admissionEnabled: true,
      },
    })
    const confirmedAt = new Date("2026-10-28T18:00:00.000Z")
    await saveAdmissionFixture(prisma, service, actor.user.id, actor.identity.subject, {
      repositorySourceId: source.id,
      sourceGeneration: source.synchronizationGeneration,
      rawPermission: "write",
      prototypeRole: "editor",
      admissionEligible: true,
      confirmedAt,
    })
    const currentSource = await prisma.gitHubRepositorySource.update({
      where: { id: source.id },
      data: { synchronizationGeneration: { increment: 1 } },
    })

    await expect(
      service.saveAdmissionBaseline(prisma, actor.user.id, {
        repositorySourceId: source.id,
        sourceGeneration: source.synchronizationGeneration,
        subject: actor.identity.subject,
        admissionGeneration: 1,
        persist: true,
        rawPermission: "read",
        prototypeRole: "viewer",
        admissionEligible: true,
        confirmedAt: new Date(confirmedAt.getTime() + 1_000),
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "github_authorization_changed",
    })
    await expect(
      service.saveAdmissionBaseline(prisma, actor.user.id, {
        repositorySourceId: source.id,
        sourceGeneration: currentSource.synchronizationGeneration,
        subject: actor.identity.subject,
        admissionGeneration: 1,
        persist: true,
        rawPermission: "read",
        prototypeRole: "viewer",
        admissionEligible: true,
        confirmedAt: new Date(confirmedAt.getTime() - 1_000),
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "github_authorization_changed",
    })
    expect(
      await prisma.gitHubSynchronizedAccess.findUnique({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: actor.user.id,
          },
        },
      }),
    ).toMatchObject({
      rawPermission: "write",
      mappedPrototypeRole: "editor",
      lastConfirmedAt: confirmedAt,
    })
  })

  it.each([
    {
      permission: "read",
      roleName: "triage",
      rawPermission: "triage",
      prototypeRole: "commenter",
    },
    {
      permission: "write",
      roleName: "release-manager",
      rawPermission: "write",
      prototypeRole: "editor",
    },
  ] as const)(
    "resolves immutable repository metadata and maps role $roleName as $rawPermission",
    async ({ permission, roleName, rawPermission, prototypeRole }) => {
      const { prisma, service, store } = await database()
      await store.lock(() => Promise.resolve())
      const source = await prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "100",
          appId: "12345",
          installationId: "7",
          owner: "old-owner",
          name: "old-name",
          defaultBranch: "main",
          admissionEnabled: true,
        },
      })
      const request = vi.fn((input: string | URL | Request): Promise<Response> => {
        const url = requestUrl(input)
        if (url.endsWith("/access_tokens")) {
          return Promise.resolve(
            new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
          )
        }
        if (url.endsWith("/repositories/100")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 100,
                full_name: "renamed-owner/renamed-repository",
                name: "renamed-repository",
                owner: { login: "renamed-owner" },
                default_branch: "trunk",
                visibility: "private",
              }),
              { status: 200 },
            ),
          )
        }
        if (
          url.endsWith("/repos/renamed-owner/renamed-repository/collaborators/octocat/permission")
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                user: { id: 42 },
                permission,
                role_name: roleName,
              }),
              { status: 200 },
            ),
          )
        }
        throw new Error(`Unexpected request: ${url}`)
      })
      vi.stubGlobal("fetch", request)

      await expect(
        service.evaluateAdmission({
          subject: "42",
          username: "octocat",
          displayName: "Octocat",
          avatarUrl: null,
        }),
      ).resolves.toMatchObject({
        repositorySourceId: source.id,
        sourceGeneration: source.synchronizationGeneration,
        subject: "42",
        admissionGeneration: 1,
        persist: true,
        rawPermission,
        prototypeRole,
        admissionEligible: true,
      })
      expect(request.mock.calls.map(([input]) => requestUrl(input))).toEqual([
        "https://api.github.com/app/installations/7/access_tokens",
        "https://api.github.com/repositories/100",
        "https://api.github.com/repos/renamed-owner/renamed-repository/collaborators/octocat/permission",
      ])
    },
  )

  it.each([
    { visibility: "public", collaboratorStatus: 204, admitted: true },
    { visibility: "public", collaboratorStatus: 404, admitted: false },
    { visibility: "internal", collaboratorStatus: 204, admitted: true },
    { visibility: "internal", collaboratorStatus: 404, admitted: false },
  ] as const)(
    "$visibility repository admission is $admitted when collaborator membership returns $collaboratorStatus",
    async ({ visibility, collaboratorStatus, admitted }) => {
      const { prisma, service, store } = await database()
      await store.lock(() => Promise.resolve())
      const source = await prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "100",
          appId: "12345",
          installationId: "7",
          owner: "owner",
          name: "repository",
          defaultBranch: "main",
          visibility,
          admissionEnabled: true,
        },
      })
      const request = vi.fn((input: string | URL | Request): Promise<Response> => {
        const url = requestUrl(input)
        if (url.endsWith("/access_tokens")) {
          return Promise.resolve(
            new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
          )
        }
        if (url.endsWith("/repositories/100")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 100,
                full_name: "owner/repository",
                name: "repository",
                owner: { login: "owner" },
                default_branch: "main",
                visibility,
              }),
              { status: 200 },
            ),
          )
        }
        if (url.endsWith("/repos/owner/repository/collaborators/octocat")) {
          return Promise.resolve(new Response(null, { status: collaboratorStatus }))
        }
        if (url.endsWith("/repos/owner/repository/collaborators/octocat/permission")) {
          return Promise.resolve(
            new Response(JSON.stringify({ user: { id: 42 }, permission: "read" }), {
              status: 200,
            }),
          )
        }
        throw new Error(`Unexpected request: ${url}`)
      })
      vi.stubGlobal("fetch", request)

      const admission = await service.evaluateAdmission({
        subject: "42",
        username: "octocat",
        displayName: "Octocat",
        avatarUrl: null,
      })

      if (admitted) {
        expect(admission).toMatchObject({
          repositorySourceId: source.id,
          subject: "42",
          admissionGeneration: 1,
          persist: true,
          rawPermission: "read",
          prototypeRole: "viewer",
          admissionEligible: true,
        })
      } else {
        expect(admission).toBeNull()
      }
      expect(request.mock.calls.map(([input]) => requestUrl(input))).toEqual([
        "https://api.github.com/app/installations/7/access_tokens",
        "https://api.github.com/repositories/100",
        "https://api.github.com/repos/owner/repository/collaborators/octocat",
        ...(admitted
          ? ["https://api.github.com/repos/owner/repository/collaborators/octocat/permission"]
          : []),
      ])
    },
  )

  it("invalidates a cached grant and session after an immutable repository 404", async () => {
    const { prisma, service, store } = await database()
    const actor = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      token: "synchronized-token",
    })
    await createUser(store, {
      subject: "43",
      role: "administrator",
      token: "administrator-token",
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        admissionEnabled: true,
      },
    })
    await saveAdmissionFixture(prisma, service, actor.user.id, actor.identity.subject, {
      repositorySourceId: source.id,
      sourceGeneration: source.synchronizationGeneration,
      rawPermission: "write",
      prototypeRole: "editor",
      admissionEligible: true,
      confirmedAt: new Date(),
    })
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) =>
        Promise.resolve(
          requestUrl(input).endsWith("/access_tokens")
            ? new Response(JSON.stringify({ token: "installation-token" }), { status: 200 })
            : new Response(null, { status: 404 }),
        ),
      ),
    )

    await expect(
      service.evaluateAdmission({
        subject: actor.identity.subject,
        username: actor.identity.username!,
        displayName: actor.user.displayName,
        avatarUrl: null,
      }),
    ).resolves.toBeNull()

    expect(
      await prisma.gitHubRepositorySource.findUnique({ where: { id: source.id } }),
    ).toMatchObject({ status: "removed", synchronizationStatus: "removed" })
    expect(
      await prisma.gitHubSynchronizedAccess.findUnique({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: actor.user.id,
          },
        },
      }),
    ).toMatchObject({ status: "removed", admissionEligible: true })
    expect(
      await prisma.installationMembership.findUnique({ where: { id: actor.membership.id } }),
    ).toMatchObject({ source: "synchronized", status: "removed" })
    expect(await prisma.session.findUnique({ where: { id: actor.session!.id } })).toBeNull()

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 100,
              full_name: "owner/repository",
              name: "repository",
              owner: { login: "owner" },
              default_branch: "main",
              visibility: "private",
            }),
            { status: 200 },
          ),
        ),
    )
    await service.linkRepository("administrator-token", {
      githubRepositoryId: source.githubRepositoryId,
      admissionEnabled: true,
    })

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) =>
        Promise.resolve(
          requestUrl(input).endsWith("/access_tokens")
            ? new Response(JSON.stringify({ token: "installation-token" }), { status: 200 })
            : new Response(null, { status: 503 }),
        ),
      ),
    )
    await expect(
      service.evaluateAdmission({
        subject: actor.identity.subject,
        username: actor.identity.username!,
        displayName: actor.user.displayName,
        avatarUrl: null,
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: "source_integration_unavailable",
    })
  })

  it("records source configuration mismatch as failed without refreshing confirmation", async () => {
    const { prisma, service, store } = await database()
    await store.lock(() => Promise.resolve())
    const lastConfirmedAt = new Date("2026-10-28T18:00:00.000Z")
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "99999",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        synchronizationStatus: "current",
        lastConfirmedAt,
      },
    })

    await expect(service.reconcileDue()).resolves.toBeUndefined()

    expect(
      await prisma.gitHubRepositorySource.findUnique({ where: { id: source.id } }),
    ).toMatchObject({
      synchronizationStatus: "failed",
      synchronizationError: "repository_source_configuration_changed",
      lastConfirmedAt,
    })
  })

  it("records credential reconciliation failure without refreshing confirmation", async () => {
    const { prisma, service, store } = await database()
    await store.lock(() => Promise.resolve())
    const lastConfirmedAt = new Date("2026-10-28T18:00:00.000Z")
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        synchronizationStatus: "current",
        lastConfirmedAt,
      },
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })))

    await expect(service.reconcileDue()).resolves.toBeUndefined()

    expect(
      await prisma.gitHubRepositorySource.findUnique({ where: { id: source.id } }),
    ).toMatchObject({
      synchronizationStatus: "failed",
      synchronizationError: "github_503",
      lastConfirmedAt,
    })
  })

  it("records a malformed provider response separately from provider availability", async () => {
    const { prisma, service } = await database()
    await prisma.gitHubIntegrationState.create({
      data: { id: "00000000-0000-4000-8000-000000000001" },
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
      },
    })
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 100, full_name: "owner/repository" }), {
            status: 200,
          }),
        ),
    )

    await expect(service.reconcileDue()).resolves.toBeUndefined()

    expect(
      await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: source.id } }),
    ).toMatchObject({
      synchronizationStatus: "failed",
      synchronizationError: "provider_response_invalid",
    })
  })

  it("records an apply failure and propagates the original internal error", async () => {
    const { prisma, service, store } = await database()
    await createUser(store, {
      subject: "41",
      role: "administrator",
      token: "administrator-token",
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
      },
    })
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION reject_reconciliation_apply() RETURNS trigger AS $$
      BEGIN
        IF NEW.synchronization_status = 'current' THEN
          RAISE EXCEPTION 'synthetic reconciliation apply failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_reconciliation_apply
      BEFORE UPDATE ON github_repository_sources
      FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_apply();
    `)
    onTestFinished(async () => {
      await prisma.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS reject_reconciliation_apply ON github_repository_sources",
      )
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS reject_reconciliation_apply()")
    })
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input)
        if (url.endsWith("/access_tokens")) {
          return Promise.resolve(
            new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
          )
        }
        if (url.endsWith("/repositories/100")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 100,
                full_name: "owner/repository",
                name: "repository",
                owner: { login: "owner" },
                default_branch: "main",
                visibility: "private",
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 41 }, permission: "write" }), { status: 200 }),
        )
      }),
    )

    await expect(service.reconcileRepository("administrator-token", source.id)).rejects.toThrow(
      "synthetic reconciliation apply failure",
    )
    expect(
      await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: source.id } }),
    ).toMatchObject({
      synchronizationStatus: "failed",
      synchronizationError: "apply_failed",
    })
  })

  it("lists repository sources for an administrator without fresh verification", async () => {
    const { prisma, service, store } = await database()
    const administrator = await createUser(store, {
      subject: "42",
      role: "administrator",
      token: "administrator-token",
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
      },
    })
    await prisma.session.update({
      where: { id: administrator.session!.id },
      data: { freshAuthorizedAt: new Date(Date.now() - 10 * 60_000) },
    })

    await expect(service.listRepositories("administrator-token")).resolves.toEqual([
      expect.objectContaining({ id: source.id }),
    ])
  })

  it("relinks a repository without changing its existing admission switch", async () => {
    const { prisma, service, store } = await database()
    await createUser(store, {
      subject: "42",
      role: "administrator",
      token: "administrator-token",
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "old-owner",
        name: "old-name",
        defaultBranch: "main",
        admissionEnabled: true,
        status: "removed",
        removedAt: new Date(),
      },
    })
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 100,
              full_name: "new-owner/new-name",
              name: "new-name",
              owner: { login: "new-owner" },
              default_branch: "trunk",
              visibility: "private",
            }),
            { status: 200 },
          ),
        ),
    )

    await expect(
      service.linkRepository("administrator-token", { githubRepositoryId: "100" }),
    ).resolves.toMatchObject({
      id: source.id,
      status: "active",
      admissionEnabled: true,
      owner: "new-owner",
      name: "new-name",
    })
  })

  it.each([
    {
      name: "an inaccessible repository",
      response: new Response(null, { status: 404 }),
      expected: { status: 422, code: "repository_source_inaccessible" },
    },
    {
      name: "a provider authorization failure",
      response: new Response(null, { status: 401 }),
      expected: { status: 503, code: "source_integration_unavailable" },
    },
    {
      name: "a malformed provider response",
      response: new Response(JSON.stringify({ id: 100 }), { status: 200 }),
      expected: { status: 503, code: "source_integration_unavailable" },
    },
  ])("returns a stable linking error for $name", async ({ response, expected }) => {
    const { service, store } = await database()
    await createUser(store, {
      subject: "42",
      role: "administrator",
      token: "administrator-token",
    })
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
        )
        .mockResolvedValueOnce(response),
    )

    await expect(
      service.linkRepository("administrator-token", { githubRepositoryId: "100" }),
    ).rejects.toMatchObject(expected)
  })

  it("revokes synchronized access immediately for a deleted repository but preserves compatibility membership", async () => {
    const { prisma, service, store } = await database()
    const synchronized = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      token: "synchronized-token",
    })
    const compatibility = await createUser(store, {
      subject: "43",
      membershipSource: "legacy-synchronized",
      token: "compatibility-token",
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        admissionEnabled: true,
      },
    })
    await saveAdmissionFixture(
      prisma,
      service,
      synchronized.user.id,
      synchronized.identity.subject,
      {
        repositorySourceId: source.id,
        sourceGeneration: source.synchronizationGeneration,
        rawPermission: "read",
        prototypeRole: "viewer",
        admissionEligible: true,
        confirmedAt: new Date(),
      },
    )

    await expect(
      service.processWebhook(
        webhook(
          {
            action: "deleted",
            installation: { id: 7 },
            repository: {
              id: 100,
              name: "repository",
              owner: { login: "owner" },
              default_branch: "main",
              visibility: "private",
            },
          },
          "repository",
          "deleted-repository",
        ),
      ),
    ).resolves.toBe("accepted")

    expect(
      await prisma.gitHubRepositorySource.findUnique({ where: { id: source.id } }),
    ).toMatchObject({ status: "removed", synchronizationStatus: "removed" })
    expect(
      await prisma.installationMembership.findUnique({ where: { id: synchronized.membership.id } }),
    ).toMatchObject({ source: "synchronized", status: "removed" })
    expect(
      await prisma.installationMembership.findUnique({
        where: { id: compatibility.membership.id },
      }),
    ).toMatchObject({ source: "legacy-synchronized", status: "active" })
    expect(await prisma.session.findUnique({ where: { id: synchronized.session!.id } })).toBeNull()
    expect(
      await prisma.session.findUnique({ where: { id: compatibility.session!.id } }),
    ).not.toBeNull()
  })

  it("bounds permission requests and isolates an immutable identity mismatch to that identity", async () => {
    const { prisma, service, store } = await database()
    const users = []
    for (let index = 0; index < 12; index += 1) {
      users.push(await createUser(store, { subject: String(1_000 + index) }))
    }
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
      },
    })
    let activeRequests = 0
    let maximumActiveRequests = 0
    let permissionRequestCount = 0
    const permissionGates: { resolve: () => void }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input)
        if (url.endsWith("/access_tokens")) {
          return Promise.resolve(
            new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
          )
        }
        if (url.endsWith("/repositories/100")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 100,
                full_name: "owner/repository",
                name: "repository",
                owner: { login: "owner" },
                default_branch: "main",
                visibility: "private",
              }),
              { status: 200 },
            ),
          )
        }
        const subject = url.match(/collaborators\/user-(\d+)\/permission$/)?.[1]
        if (!subject) throw new Error(`Unexpected request: ${url}`)
        permissionRequestCount += 1
        activeRequests += 1
        maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests)
        const gate = deferred<Response>()
        permissionGates.push({
          resolve: () => {
            activeRequests -= 1
            gate.resolve(
              new Response(
                JSON.stringify({
                  user: { id: subject === "1000" ? 999_999 : Number(subject) },
                  permission: "read",
                }),
                { status: 200 },
              ),
            )
          },
        })
        return gate.promise
      }),
    )

    const reconciliation = service.reconcileDue()
    await vi.waitFor(() => {
      expect(permissionRequestCount).toBe(10)
      expect(activeRequests).toBe(10)
    })
    expect(maximumActiveRequests).toBe(10)
    permissionGates.slice(0, 10).forEach(({ resolve }) => resolve())
    await vi.waitFor(() => expect(permissionRequestCount).toBe(12))
    permissionGates.slice(10).forEach(({ resolve }) => resolve())
    await reconciliation

    expect(maximumActiveRequests).toBe(10)
    expect(
      await prisma.gitHubSynchronizedAccess.findUnique({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: users[0]!.user.id,
          },
        },
      }),
    ).toMatchObject({
      rawPermission: "none",
      admissionEligible: false,
      mappedPrototypeRole: null,
    })
    expect(
      await prisma.gitHubSynchronizedAccess.findUnique({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: users[1]!.user.id,
          },
        },
      }),
    ).toMatchObject({
      rawPermission: "read",
      admissionEligible: true,
      mappedPrototypeRole: "viewer",
    })
  })

  it("keeps a newer denied sign-in authoritative when an older grant responds later", async () => {
    const { prisma, service, store } = await database()
    const target = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      status: "removed",
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        admissionEnabled: true,
      },
    })
    const provider = await store.read.currentAuthenticationProviderRevision("github")
    await store.lock(async (records) => {
      for (const suffix of ["older", "newer"]) {
        await records.createAuthorizationAttempt({
          authenticationProviderRevisionId: provider!.id,
          originatingSessionId: null,
          stateDigest: digestSecret(`${suffix}-state`),
          browserDigest: digestSecret(`${suffix}-browser`),
          pkceVerifier: `${suffix}-verifier`,
          nonce: null,
          purpose: "sign-in",
          expiresAt: new Date(Date.now() + 60_000),
        })
      }
    })
    const olderPermission = deferred<Response>()
    const olderPermissionRequested = deferred<void>()
    let permissionRequests = 0
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input)
        if (url.endsWith("/access_tokens")) {
          return Promise.resolve(
            new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
          )
        }
        if (url.endsWith("/repositories/100")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 100,
                full_name: "owner/repository",
                name: "repository",
                owner: { login: "owner" },
                default_branch: "main",
                visibility: "private",
              }),
              { status: 200 },
            ),
          )
        }
        permissionRequests += 1
        if (permissionRequests === 1) {
          olderPermissionRequested.resolve()
          return olderPermission.promise
        }
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 42 }, permission: "none" }), { status: 200 }),
        )
      }),
    )
    const authentication = createAuthenticationService({
      store,
      github: {
        authorizationUrl: vi.fn(),
        identify: vi.fn().mockResolvedValue({
          subject: target.identity.subject,
          username: target.identity.username!,
          displayName: target.user.displayName,
          avatarUrl: null,
        }),
      },
      configuration: {
        clientId: "github-client",
        clientSecret: "github-client-secret-fixture",
        callbackUrl: "https://hub.example/api/auth/github/callback",
        issuer: "https://github.com",
      },
      providerRevisionId: provider!.id,
      admissionPolicy: {
        name: "github-synchronized",
        admit: (profile) => service.evaluateAdmission(profile),
        saveBaseline: (database, userId, baseline) =>
          service.saveAdmissionBaseline(database, userId, baseline),
      },
    })

    const olderSignIn = authentication.complete("older-code", "older-state", "older-browser")
    await olderPermissionRequested.promise
    await expect(
      authentication.complete("newer-code", "newer-state", "newer-browser"),
    ).rejects.toMatchObject({
      status: 403,
      code: "admission_denied",
    })
    olderPermission.resolve(
      new Response(JSON.stringify({ user: { id: 42 }, permission: "write" }), { status: 200 }),
    )
    await expect(olderSignIn).rejects.toMatchObject({
      status: 409,
      code: "github_authorization_changed",
    })

    expect(permissionRequests).toBe(2)
    expect(
      await prisma.gitHubSynchronizedAccess.findUnique({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: target.user.id,
          },
        },
      }),
    ).toMatchObject({
      rawPermission: "none",
      admissionEligible: false,
      status: "removed",
    })
    expect(await prisma.session.count({ where: { userId: target.user.id } })).toBe(0)
  })

  it("keeps a reconciliation denial authoritative when an earlier sign-in responds later", async () => {
    const { prisma, service, store } = await database()
    const target = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      status: "removed",
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        admissionEnabled: true,
      },
    })
    const provider = await store.read.currentAuthenticationProviderRevision("github")
    await store.lock((records) =>
      records.createAuthorizationAttempt({
        authenticationProviderRevisionId: provider!.id,
        originatingSessionId: null,
        stateDigest: digestSecret("state"),
        browserDigest: digestSecret("browser-token"),
        pkceVerifier: "pkce-verifier",
        nonce: null,
        purpose: "sign-in",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    )
    const signInPermission = deferred<Response>()
    const signInPermissionRequested = deferred<void>()
    let permissionRequests = 0
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input)
        if (url.endsWith("/access_tokens")) {
          return Promise.resolve(
            new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
          )
        }
        if (url.endsWith("/repositories/100")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 100,
                full_name: "owner/repository",
                name: "repository",
                owner: { login: "owner" },
                default_branch: "main",
                visibility: "private",
              }),
              { status: 200 },
            ),
          )
        }
        permissionRequests += 1
        if (permissionRequests === 1) {
          signInPermissionRequested.resolve()
          return signInPermission.promise
        }
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 42 }, permission: "none" }), { status: 200 }),
        )
      }),
    )
    const authentication = createAuthenticationService({
      store,
      github: {
        authorizationUrl: vi.fn(),
        identify: vi.fn().mockResolvedValue({
          subject: target.identity.subject,
          username: target.identity.username!,
          displayName: target.user.displayName,
          avatarUrl: null,
        }),
      },
      configuration: {
        clientId: "github-client",
        clientSecret: "github-client-secret-fixture",
        callbackUrl: "https://hub.example/api/auth/github/callback",
        issuer: "https://github.com",
      },
      providerRevisionId: provider!.id,
      admissionPolicy: {
        name: "github-synchronized",
        admit: (profile) => service.evaluateAdmission(profile),
        saveBaseline: (database, userId, baseline) =>
          service.saveAdmissionBaseline(database, userId, baseline),
      },
    })

    const signIn = authentication.complete("code", "state", "browser-token")
    await signInPermissionRequested.promise
    await service.reconcileDue()
    signInPermission.resolve(
      new Response(JSON.stringify({ user: { id: 42 }, permission: "write" }), { status: 200 }),
    )

    await expect(signIn).rejects.toMatchObject({
      status: 409,
      code: "github_authorization_changed",
    })
    expect(permissionRequests).toBe(2)
    expect(
      await prisma.gitHubSynchronizedAccess.findUniqueOrThrow({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: target.user.id,
          },
        },
      }),
    ).toMatchObject({
      rawPermission: "none",
      admissionEligible: false,
      status: "removed",
    })
    expect(
      await prisma.installationMembership.findUnique({ where: { id: target.membership.id } }),
    ).toMatchObject({ source: "synchronized", status: "removed" })
    expect(await prisma.session.count({ where: { userId: target.user.id } })).toBe(0)
  })

  it("does not overwrite an administrator suspension while reconciliation is waiting", async () => {
    const { prisma, service, store } = await database()
    await createUser(store, {
      subject: "41",
      role: "administrator",
      token: "administrator-token",
    })
    const target = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      token: "target-token",
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        admissionEnabled: true,
      },
    })
    await saveAdmissionFixture(prisma, service, target.user.id, target.identity.subject, {
      repositorySourceId: source.id,
      sourceGeneration: source.synchronizationGeneration,
      rawPermission: "read",
      prototypeRole: "viewer",
      admissionEligible: true,
      confirmedAt: new Date(),
    })
    const targetPermission = deferred<Response>()
    const targetPermissionRequested = deferred<void>()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input)
        if (url.endsWith("/access_tokens")) {
          return Promise.resolve(
            new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
          )
        }
        if (url.endsWith("/repositories/100")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 100,
                full_name: "owner/repository",
                name: "repository",
                owner: { login: "owner" },
                default_branch: "main",
                visibility: "private",
              }),
              { status: 200 },
            ),
          )
        }
        if (url.includes("user-42")) {
          targetPermissionRequested.resolve()
          return targetPermission.promise
        }
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 41 }, permission: "write" }), {
            status: 200,
          }),
        )
      }),
    )
    const administration = createAdministrationService({ store })

    const reconciliation = service.reconcileDue()
    await targetPermissionRequested.promise
    await administration.changeMembership("administrator-token", target.membership.id, {
      status: "suspended",
    })
    targetPermission.resolve(
      new Response(JSON.stringify({ user: { id: 42 }, permission: "none" }), { status: 200 }),
    )
    await reconciliation

    expect(
      await prisma.installationMembership.findUnique({ where: { id: target.membership.id } }),
    ).toMatchObject({ source: "manual", status: "suspended" })
    expect(await prisma.session.findUnique({ where: { id: target.session!.id } })).toBeNull()
  })

  it("skips a superseded baseline while still applying another user's permission loss", async () => {
    const { prisma, service, store } = await database()
    const target = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      status: "removed",
    })
    const lost = await createUser(store, {
      subject: "43",
      membershipSource: "synchronized",
      token: "lost-token",
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        admissionEnabled: true,
      },
    })
    await saveAdmissionFixture(prisma, service, lost.user.id, lost.identity.subject, {
      repositorySourceId: source.id,
      sourceGeneration: source.synchronizationGeneration,
      rawPermission: "read",
      prototypeRole: "viewer",
      admissionEligible: true,
      confirmedAt: new Date(),
    })
    const targetPermission = deferred<Response>()
    const targetPermissionRequested = deferred<void>()
    let targetPermissionRequests = 0
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input)
        if (url.endsWith("/access_tokens")) {
          return Promise.resolve(
            new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
          )
        }
        if (url.endsWith("/repositories/100")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 100,
                full_name: "owner/repository",
                name: "repository",
                owner: { login: "owner" },
                default_branch: "main",
                visibility: "private",
              }),
              { status: 200 },
            ),
          )
        }
        if (url.includes("user-42")) {
          targetPermissionRequests += 1
          if (targetPermissionRequests === 1) {
            targetPermissionRequested.resolve()
            return targetPermission.promise
          }
          return Promise.resolve(
            new Response(JSON.stringify({ user: { id: 42 }, permission: "write" }), {
              status: 200,
            }),
          )
        }
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 43 }, permission: "none" }), { status: 200 }),
        )
      }),
    )

    const reconciliation = service.reconcileDue()
    await targetPermissionRequested.promise
    const now = new Date()
    const provider = await store.read.currentAuthenticationProviderRevision("github")
    await store.lock((records) =>
      records.createAuthorizationAttempt({
        authenticationProviderRevisionId: provider!.id,
        originatingSessionId: null,
        stateDigest: digestSecret("state"),
        browserDigest: digestSecret("browser-token"),
        pkceVerifier: "pkce-verifier",
        nonce: null,
        purpose: "sign-in",
        expiresAt: new Date(now.getTime() + 60_000),
      }),
    )
    const authentication = createAuthenticationService({
      store,
      github: {
        authorizationUrl: vi.fn(),
        identify: vi.fn().mockResolvedValue({
          subject: target.identity.subject,
          username: target.identity.username!,
          displayName: target.user.displayName,
          avatarUrl: null,
        }),
      },
      configuration: {
        clientId: "github-client",
        clientSecret: "github-client-secret-fixture",
        callbackUrl: "https://hub.example/api/auth/github/callback",
        issuer: "https://github.com",
      },
      providerRevisionId: provider!.id,
      admissionPolicy: {
        name: "github-synchronized",
        admit: (profile) => service.evaluateAdmission(profile),
        saveBaseline: (database, userId, baseline) =>
          service.saveAdmissionBaseline(database, userId, baseline),
      },
    })

    await expect(authentication.complete("code", "state", "browser-token")).resolves.toMatchObject({
      purpose: "sign-in",
    })
    targetPermission.resolve(
      new Response(JSON.stringify({ user: { id: 42 }, permission: "none" }), { status: 200 }),
    )
    await reconciliation

    expect(
      await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: source.id } }),
    ).toMatchObject({
      synchronizationGeneration: source.synchronizationGeneration + 1,
      synchronizationStatus: "current",
    })
    expect(
      await prisma.installationMembership.findUnique({ where: { id: target.membership.id } }),
    ).toMatchObject({ source: "synchronized", status: "active" })
    expect(
      await prisma.gitHubSynchronizedAccess.findUnique({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: target.user.id,
          },
        },
      }),
    ).toMatchObject({
      rawPermission: "write",
      admissionEligible: true,
      status: "active",
    })
    expect(await prisma.session.count({ where: { userId: target.user.id } })).toBe(1)
    expect(
      await prisma.installationMembership.findUnique({ where: { id: lost.membership.id } }),
    ).toMatchObject({ source: "synchronized", status: "removed" })
    expect(await prisma.session.findUnique({ where: { id: lost.session!.id } })).toBeNull()
    expect(
      await prisma.gitHubSynchronizedAccess.findUnique({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: lost.user.id,
          },
        },
      }),
    ).toMatchObject({
      rawPermission: "none",
      admissionEligible: false,
      status: "removed",
    })
  })

  it("rejects a non-ASCII signature with equal character length as unauthorized", async () => {
    const { service } = await database()
    const input = webhook({}, "ping", "non-ascii-signature")
    const signature = `${input.signature.slice(0, -1)}é`
    expect(signature).toHaveLength(input.signature.length)

    await expect(service.processWebhook({ ...input, signature })).rejects.toMatchObject({
      status: 401,
      code: "invalid_github_webhook",
    })
  })

  it("ignores a signed GitHub ping without an installation payload", async () => {
    const { prisma, service } = await database({
      GITHUB_APP_ID: "",
      GITHUB_INSTALLATION_ID: "",
      GITHUB_PRIVATE_KEY: "",
    })

    await expect(
      service.processWebhook(
        webhook({ zen: "Keep it logically awesome.", hook_id: 1 }, "ping", "github-ping"),
      ),
    ).resolves.toBe("ignored")
    expect(await prisma.gitHubWebhookDelivery.count()).toBe(0)
  })

  it.each([
    {
      name: "installation deletion",
      event: "installation",
      payload: { action: "deleted", installation: { id: 7 } },
    },
    {
      name: "repository removal",
      event: "installation_repositories",
      payload: {
        action: "removed",
        installation: { id: 7 },
        repositories_removed: [{ id: 100 }],
      },
    },
  ])("removes suspended sources after $name", async ({ event, payload }) => {
    const { prisma, service, store } = await database()
    await store.lock(() => Promise.resolve())
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        admissionEnabled: true,
        status: "suspended",
        synchronizationStatus: "removed",
      },
    })

    await expect(
      service.processWebhook(webhook(payload, event, `suspended-${event}-removal`)),
    ).resolves.toBe("accepted")
    await expect(
      service.processWebhook(
        webhook(
          { action: "unsuspend", installation: { id: 7 } },
          "installation",
          `suspended-${event}-later-unsuspend`,
        ),
      ),
    ).resolves.toBe("accepted")

    expect(
      await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: source.id } }),
    ).toMatchObject({
      status: "removed",
      admissionEnabled: false,
      synchronizationStatus: "removed",
    })
  })

  it("enforces synchronized memberships once after removing multiple sources", async () => {
    const { prisma, store } = await database()
    const actor = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      token: "synchronized-token",
    })
    const sources = await Promise.all(
      ["100", "200"].map((githubRepositoryId) =>
        prisma.gitHubRepositorySource.create({
          data: {
            githubRepositoryId,
            appId: "12345",
            installationId: "7",
            owner: "owner",
            name: `repository-${githubRepositoryId}`,
            defaultBranch: "main",
            admissionEnabled: true,
          },
        }),
      ),
    )
    let membershipEnforcementQueries = 0
    const observedDatabase = prisma.$extends({
      query: {
        installationMembership: {
          findMany({ args, query }) {
            if (args.where?.source === "synchronized" && args.where.status === "active") {
              membershipEnforcementQueries += 1
            }
            return query(args)
          },
        },
      },
    })
    const observedStore = createIdentityStore(observedDatabase as unknown as PrismaClient)
    const observedService = createGitHubAuthorizationService({
      database: observedDatabase as unknown as PrismaClient,
      environment: environment(),
      store: observedStore,
    })
    for (const source of sources) {
      await saveAdmissionFixture(prisma, observedService, actor.user.id, actor.identity.subject, {
        repositorySourceId: source.id,
        sourceGeneration: source.synchronizationGeneration,
        rawPermission: "read",
        prototypeRole: "viewer",
        admissionEligible: true,
        confirmedAt: new Date(),
      })
    }

    await expect(
      observedService.processWebhook(
        webhook(
          { action: "deleted", installation: { id: 7 } },
          "installation",
          "multi-source-installation-delete",
        ),
      ),
    ).resolves.toBe("accepted")

    expect(membershipEnforcementQueries).toBe(1)
    expect(
      await prisma.gitHubRepositorySource.findMany({
        where: { id: { in: sources.map(({ id }) => id) } },
        select: { status: true },
      }),
    ).toEqual([{ status: "removed" }, { status: "removed" }])
    expect(
      await prisma.installationMembership.findUnique({ where: { id: actor.membership.id } }),
    ).toMatchObject({ source: "synchronized", status: "removed" })
    expect(await prisma.session.findUnique({ where: { id: actor.session!.id } })).toBeNull()
  })

  it("suspends linked sources without losing policy and resumes them dirty without baselines", async () => {
    const { prisma, service, store } = await database()
    const actor = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      token: "synchronized-token",
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        admissionEnabled: true,
        synchronizationStatus: "current",
      },
    })
    await saveAdmissionFixture(prisma, service, actor.user.id, actor.identity.subject, {
      repositorySourceId: source.id,
      sourceGeneration: source.synchronizationGeneration,
      rawPermission: "read",
      prototypeRole: "viewer",
      admissionEligible: true,
      confirmedAt: new Date(),
    })

    await expect(
      service.processWebhook(
        webhook(
          { action: "suspend", installation: { id: 7 } },
          "installation",
          "installation-suspend",
        ),
      ),
    ).resolves.toBe("accepted")

    expect(
      await prisma.gitHubRepositorySource.findUnique({ where: { id: source.id } }),
    ).toMatchObject({
      status: "suspended",
      admissionEnabled: true,
      synchronizationStatus: "removed",
    })
    expect(
      await prisma.gitHubSynchronizedAccess.findUnique({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: actor.user.id,
          },
        },
      }),
    ).toMatchObject({ status: "removed", synchronizationStatus: "removed" })
    expect(
      await prisma.installationMembership.findUnique({ where: { id: actor.membership.id } }),
    ).toMatchObject({ source: "synchronized", status: "removed" })
    expect(await prisma.session.findUnique({ where: { id: actor.session!.id } })).toBeNull()

    await expect(
      service.processWebhook(
        webhook(
          { action: "unsuspend", installation: { id: 7 } },
          "installation",
          "installation-unsuspend",
        ),
      ),
    ).resolves.toBe("accepted")

    expect(
      await prisma.gitHubRepositorySource.findUnique({ where: { id: source.id } }),
    ).toMatchObject({
      status: "active",
      admissionEnabled: true,
      synchronizationStatus: "dirty",
      synchronizationError: null,
      removedAt: null,
    })
    expect(
      await prisma.gitHubSynchronizedAccess.findUnique({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: actor.user.id,
          },
        },
      }),
    ).toMatchObject({ status: "removed", synchronizationStatus: "removed" })
    expect(
      await prisma.installationMembership.findUnique({ where: { id: actor.membership.id } }),
    ).toMatchObject({ source: "synchronized", status: "removed" })
    expect(await prisma.session.count({ where: { userId: actor.user.id } })).toBe(0)
  })

  it("unlinks a suspended source and clears its admission policy and baselines", async () => {
    const { prisma, service, store } = await database()
    const administrator = await createUser(store, {
      subject: "41",
      role: "administrator",
      token: "administrator-token",
    })
    const actor = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        admissionEnabled: true,
        synchronizationStatus: "current",
      },
    })
    await saveAdmissionFixture(prisma, service, actor.user.id, actor.identity.subject, {
      repositorySourceId: source.id,
      sourceGeneration: source.synchronizationGeneration,
      rawPermission: "read",
      prototypeRole: "viewer",
      admissionEligible: true,
      confirmedAt: new Date(),
    })
    await service.processWebhook(
      webhook(
        { action: "suspend", installation: { id: 7 } },
        "installation",
        "installation-suspend-before-unlink",
      ),
    )

    await expect(
      service.unlinkRepository("administrator-token", source.id),
    ).resolves.toBeUndefined()

    expect(
      await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: source.id } }),
    ).toMatchObject({
      status: "removed",
      admissionEnabled: false,
      synchronizationStatus: "removed",
    })
    expect(
      await prisma.gitHubSynchronizedAccess.findUniqueOrThrow({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: actor.user.id,
          },
        },
      }),
    ).toMatchObject({
      status: "removed",
      synchronizationStatus: "removed",
    })
    expect(
      await prisma.securityAudit.findFirst({
        where: { event: "github.repository.unlink", githubRepositorySourceId: source.id },
      }),
    ).toMatchObject({ actorUserId: administrator.user.id })
  })

  it("keeps the synchronized authorization migration constraints and compatibility backfill", () => {
    const migration = readFileSync(
      new URL(
        "../../../../schema/migrations/20261027230000_github_synchronized_authorization/migration.sql",
        import.meta.url,
      ),
      "utf8",
    )

    expect(migration).toMatch(
      /CONSTRAINT "github_repository_sources_status" CHECK \(\s*"status" IN \('active', 'removed', 'suspended'\)\s*\)/,
    )
    expect(migration).toContain("'legacy-synchronized'")
    expect(migration).toMatch(
      /UPDATE "installation_memberships"\s+SET "source" = 'legacy-synchronized'\s+WHERE "source" = 'synchronized';/,
    )
  })

  it("rolls back webhook mutations when the required revocation audit fails", async () => {
    const { prisma, service, store } = await database()
    const actor = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      token: "session-token",
    })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        admissionEnabled: true,
      },
    })
    await saveAdmissionFixture(prisma, service, actor.user.id, actor.identity.subject, {
      repositorySourceId: source.id,
      sourceGeneration: source.synchronizationGeneration,
      rawPermission: "read",
      prototypeRole: "viewer",
      admissionEligible: true,
      confirmedAt: new Date(),
    })
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION reject_github_revocation_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.event = 'membership.synchronized.remove' THEN
          RAISE EXCEPTION 'audit unavailable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_github_revocation_audit
      BEFORE INSERT ON security_audits
      FOR EACH ROW EXECUTE FUNCTION reject_github_revocation_audit();
    `)
    onTestFinished(async () => {
      await prisma.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS reject_github_revocation_audit ON security_audits",
      )
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS reject_github_revocation_audit()")
    })

    await expect(
      service.processWebhook(
        webhook(
          {
            action: "removed",
            installation: { id: 7 },
            repositories_removed: [{ id: 100 }],
          },
          "installation_repositories",
          "delivery-audit-failure",
        ),
      ),
    ).rejects.toThrow("audit unavailable")

    expect(
      await prisma.gitHubRepositorySource.findUnique({ where: { id: source.id } }),
    ).toMatchObject({ status: "active", admissionEnabled: true })
    expect(
      await prisma.installationMembership.findUnique({ where: { id: actor.membership.id } }),
    ).toMatchObject({ status: "active" })
    expect(await prisma.session.findUnique({ where: { id: actor.session!.id } })).not.toBeNull()
    expect(await prisma.gitHubWebhookDelivery.count()).toBe(0)
  })
})
