import { AsyncLocalStorage } from "node:async_hooks"
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
import { logger } from "#server/integrations/pino"
import { AuthenticationError } from "#server/utils/authentication-error"
import { digestSecret } from "#server/utils/digest-secret"

import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

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

function currentGitHubUserResponse(url: string): Response | null {
  const subject = url.match(/\/user\/(\d+)$/)?.[1]
  return subject
    ? new Response(JSON.stringify({ id: Number(subject), login: `user-${subject}` }), {
        status: 200,
      })
    : null
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
      { id: 42, login: "user-42" },
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
      "https://api.github.com/user/42",
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

  it("resolves the current GitHub login from the immutable subject before reconciling permission", async () => {
    const { prisma, service, store } = await database()
    const actor = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      token: "synchronized-session",
    })
    await prisma.externalIdentity.update({
      where: { id: actor.identity.id },
      data: { username: "stale-login" },
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
    const request = vi.fn((input: string | URL | Request) => {
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
      if (url.endsWith("/user/42")) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 42, login: "current-login" }), { status: 200 }),
        )
      }
      if (url.endsWith("/collaborators/current-login/permission")) {
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 42 }, permission: "read" }), {
            status: 200,
          }),
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", request)

    await expect(service.reconcileDue()).resolves.toBeUndefined()

    expect(request.mock.calls.map(([input]) => requestUrl(input))).toEqual([
      "https://api.github.com/app/installations/7/access_tokens",
      "https://api.github.com/repositories/100",
      "https://api.github.com/user/42",
      "https://api.github.com/repos/owner/repository/collaborators/current-login/permission",
    ])
    expect(
      await prisma.installationMembership.findUniqueOrThrow({
        where: { id: actor.membership.id },
      }),
    ).toMatchObject({ source: "synchronized", status: "active" })
    expect(await prisma.session.findUnique({ where: { id: actor.session!.id } })).not.toBeNull()
    expect(
      await prisma.gitHubSynchronizedAccess.findUniqueOrThrow({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: actor.user.id,
          },
        },
      }),
    ).toMatchObject({ rawPermission: "read", admissionEligible: true, status: "active" })
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

  it("reports a source generation change instead of treating admission as denied", async () => {
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
          action: "renamed",
          installation: { id: 7 },
          repository: {
            id: 100,
            name: "renamed",
            owner: { login: "new-owner" },
            default_branch: "main",
            visibility: "private",
          },
        },
        "repository",
        "source-generation-changed-before-claim",
      ),
    )
    continueAdmission.resolve()

    await expect(admission).rejects.toMatchObject({
      status: 409,
      code: "github_authorization_changed",
    })
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

  it("claims reconciliation attempts without waiting for the identity-store lock", async () => {
    const { prisma, service, store } = await database()
    await createUser(store, { subject: "42" })
    await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
      },
    })
    const lockHeld = deferred<void>()
    const releaseLock = deferred<void>()
    let permissionRequested = false
    const lock = store.lock(async () => {
      lockHeld.resolve()
      await releaseLock.promise
    })
    await lockHeld.promise
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
        permissionRequested = true
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 42 }, permission: "read" }), { status: 200 }),
        )
      }),
    )

    const reconciliation = service.reconcileDue()
    await vi.waitFor(() => expect(permissionRequested).toBe(true))
    await expect(prisma.gitHubRepositorySource.count()).resolves.toBe(1)

    releaseLock.resolve()
    await Promise.all([lock, reconciliation])
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
        const user = currentGitHubUserResponse(url)
        if (user) return Promise.resolve(user)
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
        const user = currentGitHubUserResponse(url)
        if (user) return Promise.resolve(user)
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
        const user = currentGitHubUserResponse(url)
        if (user) return Promise.resolve(user)
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
        const user = currentGitHubUserResponse(url)
        if (user) return Promise.resolve(user)
        if (
          url.endsWith("/repos/renamed-owner/renamed-repository/collaborators/user-42/permission")
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
        "https://api.github.com/user/42",
        "https://api.github.com/repos/renamed-owner/renamed-repository/collaborators/user-42/permission",
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
        const user = currentGitHubUserResponse(url)
        if (user) return Promise.resolve(user)
        if (url.endsWith("/repos/owner/repository/collaborators/user-42")) {
          return Promise.resolve(new Response(null, { status: collaboratorStatus }))
        }
        if (url.endsWith("/repos/owner/repository/collaborators/user-42/permission")) {
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
        "https://api.github.com/user/42",
        "https://api.github.com/repos/owner/repository/collaborators/user-42",
        ...(admitted
          ? ["https://api.github.com/repos/owner/repository/collaborators/user-42/permission"]
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
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined)
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
    expect(errorLog).toHaveBeenCalledWith(
      {
        repositorySourceId: source.id,
        reason: "repository_source_configuration_changed",
      },
      "GitHub authorization reconciliation failed",
    )
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
      },
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
            new Response(JSON.stringify({ id: 100, full_name: "owner/repository" }), {
              status: 200,
            }),
          )
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
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
        const user = currentGitHubUserResponse(url)
        if (user) return Promise.resolve(user)
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
        const user = currentGitHubUserResponse(url)
        if (user) return Promise.resolve(user)
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

  it("keeps successful confirmations when another identity permission check fails", async () => {
    const { prisma, service, store } = await database()
    const confirmed = await createUser(store, { subject: "42" })
    const failed = await createUser(store, { subject: "43" })
    const lastConfirmedAt = new Date("2026-10-28T18:00:00.000Z")
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
        lastConfirmedAt,
      },
    })
    await saveAdmissionFixture(prisma, service, failed.user.id, failed.identity.subject, {
      repositorySourceId: source.id,
      sourceGeneration: source.synchronizationGeneration,
      rawPermission: "write",
      prototypeRole: "editor",
      admissionEligible: true,
      confirmedAt: lastConfirmedAt,
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
        const user = currentGitHubUserResponse(url)
        if (user) return Promise.resolve(user)
        if (url.includes("user-42")) {
          return Promise.resolve(
            new Response(JSON.stringify({ user: { id: 42 }, permission: "read" }), {
              status: 200,
            }),
          )
        }
        return Promise.resolve(new Response(null, { status: 503 }))
      }),
    )

    await expect(service.reconcileDue()).resolves.toBeUndefined()

    expect(
      await prisma.gitHubSynchronizedAccess.findUniqueOrThrow({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: confirmed.user.id,
          },
        },
      }),
    ).toMatchObject({
      rawPermission: "read",
      admissionEligible: true,
      mappedPrototypeRole: "viewer",
      status: "active",
    })
    expect(
      await prisma.gitHubSynchronizedAccess.findUniqueOrThrow({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: failed.user.id,
          },
        },
      }),
    ).toMatchObject({
      rawPermission: "write",
      mappedPrototypeRole: "editor",
      lastConfirmedAt,
      status: "active",
    })
    expect(
      await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: source.id } }),
    ).toMatchObject({
      synchronizationStatus: "failed",
      synchronizationError: "permission_partial_failure",
      lastConfirmedAt,
    })
  })

  it("rolls back first synchronized enrollment when its baseline is superseded", async () => {
    const { prisma, service, store } = await database()
    const target = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      status: "removed",
    })
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
    const provider = await store.lock((records) =>
      records.currentAuthenticationProviderRevision("github"),
    )
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
        const user = currentGitHubUserResponse(url)
        if (user) return Promise.resolve(user)
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 42 }, permission: "write" }), { status: 200 }),
        )
      }),
    )
    const saveBaseline = vi.fn(async (transaction: Prisma.TransactionClient) => {
      await expect(
        transaction.installationMembership.findUnique({
          where: { id: target.membership.id },
        }),
      ).resolves.toMatchObject({ source: "synchronized", status: "active" })
      throw new AuthenticationError(
        409,
        "github_authorization_changed",
        "GitHub authorization changed.",
      )
    })
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
        saveBaseline,
      },
    })

    await expect(authentication.complete("code", "state", "browser-token")).rejects.toMatchObject({
      status: 409,
      code: "github_authorization_changed",
    })

    expect(saveBaseline).toHaveBeenCalledOnce()
    expect(
      await prisma.installationMembership.findUniqueOrThrow({
        where: { id: target.membership.id },
      }),
    ).toMatchObject({ source: "synchronized", status: "removed" })
    expect(await prisma.session.count({ where: { userId: target.user.id } })).toBe(0)
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
    const provider = await store.lock((records) =>
      records.currentAuthenticationProviderRevision("github"),
    )
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
        const user = currentGitHubUserResponse(url)
        if (user) return Promise.resolve(user)
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
    const provider = await store.lock((records) =>
      records.currentAuthenticationProviderRevision("github"),
    )
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
        const user = currentGitHubUserResponse(url)
        if (user) return Promise.resolve(user)
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
        const user = currentGitHubUserResponse(url)
        if (user) return Promise.resolve(user)
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
        const user = currentGitHubUserResponse(url)
        if (user) return Promise.resolve(user)
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
    const provider = await store.lock((records) =>
      records.currentAuthenticationProviderRevision("github"),
    )
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
      name: "repository removal",
      event: "repository",
      payload: {
        action: "deleted",
        installation: { id: 7 },
        repository: {
          id: 100,
          name: "relinked",
          owner: { login: "owner" },
          default_branch: "main",
        },
      },
    },
    {
      name: "permission change",
      event: "member",
      payload: {
        action: "edited",
        installation: { id: 7 },
        repository: {
          id: 100,
          name: "relinked",
          owner: { login: "owner" },
          default_branch: "main",
        },
      },
    },
  ])(
    "does not apply a delayed old-installation $name to a relinked repository",
    async ({ event, payload }) => {
      const { prisma, service, store } = await database()
      await store.lock(() => Promise.resolve())
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
      await prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "999",
          appId: "12345",
          installationId: "7",
          owner: "owner",
          name: "retained-old-installation-source",
          defaultBranch: "main",
        },
      })
      const relinked = await prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "100",
          appId: "12345",
          installationId: "8",
          owner: "owner",
          name: "relinked",
          defaultBranch: "main",
          admissionEnabled: true,
          synchronizationStatus: "current",
        },
      })
      const fetchMock = vi.fn()
      vi.stubGlobal("fetch", fetchMock)

      await expect(
        service.processWebhook(webhook(payload, event, `old-installation-${event}`)),
      ).resolves.toBe("accepted")
      await vi.advanceTimersByTimeAsync(1_000)

      expect(
        await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: relinked.id } }),
      ).toMatchObject({
        status: "active",
        admissionEnabled: true,
        synchronizationStatus: "current",
        synchronizationGeneration: relinked.synchronizationGeneration,
        dirtyAt: null,
      })
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).endsWith(`/repositories/${relinked.githubRepositoryId}`),
        ),
      ).toBe(false)
    },
  )

  it.each(["team", "organization"] as const)(
    "accepts a signed %s event, marks the installation dirty, and schedules reconciliation",
    async (event) => {
      const { prisma, service } = await database()
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
      const source = await prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "100",
          appId: "12345",
          installationId: "7",
          owner: "owner",
          name: "repository",
          defaultBranch: "main",
          synchronizationStatus: "current",
        },
      })
      const request = vi.fn((input: string | URL | Request) => {
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
        throw new Error(`Unexpected request: ${url}`)
      })
      vi.stubGlobal("fetch", request)

      await expect(
        service.processWebhook(
          webhook({ action: "edited", installation: { id: 7 } }, event, `${event}-dirty`),
        ),
      ).resolves.toBe("accepted")
      expect(
        await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: source.id } }),
      ).toMatchObject({
        synchronizationStatus: "dirty",
        synchronizationGeneration: source.synchronizationGeneration,
      })

      await vi.advanceTimersByTimeAsync(1_000)
      await vi.waitFor(() =>
        expect(
          request.mock.calls.filter(([input]) => requestUrl(input).endsWith("/repositories/100")),
        ).toHaveLength(1),
      )
    },
  )

  it.each([
    {
      event: "repository",
      payload: {
        action: "renamed",
        installation: { id: 7 },
        repository: {
          id: 100,
          name: "renamed",
          owner: { login: "owner" },
          default_branch: "main",
        },
      },
    },
    {
      event: "installation_repositories",
      payload: {
        action: "added",
        installation: { id: 7 },
        repositories_added: [{ id: 100 }],
      },
    },
  ])(
    "advances source generation and schedules reconciliation for an identity-changing $event event",
    async ({ event, payload }) => {
      const { prisma, service } = await database()
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
      const source = await prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "100",
          appId: "12345",
          installationId: "7",
          owner: "owner",
          name: "repository",
          defaultBranch: "main",
          synchronizationStatus: "current",
        },
      })
      const request = vi.fn((input: string | URL | Request) => {
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
        throw new Error(`Unexpected request: ${url}`)
      })
      vi.stubGlobal("fetch", request)

      await expect(
        service.processWebhook(webhook(payload, event, `identity-change-${event}`)),
      ).resolves.toBe("accepted")
      expect(
        await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: source.id } }),
      ).toMatchObject({
        synchronizationStatus: "dirty",
        synchronizationGeneration: source.synchronizationGeneration + 1,
      })

      await vi.advanceTimersByTimeAsync(1_000)
      await vi.waitFor(() =>
        expect(
          request.mock.calls.filter(([input]) => requestUrl(input).endsWith("/repositories/100")),
        ).toHaveLength(1),
      )
    },
  )

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

  it("excludes fresh eligible users in the initial membership enforcement query", async () => {
    const { prisma, store } = await database()
    const actor = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      token: "synchronized-token",
    })
    const [removedSource, eligibleSource] = await Promise.all([
      prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "100",
          appId: "12345",
          installationId: "7",
          owner: "owner",
          name: "removed",
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
          name: "eligible",
          defaultBranch: "main",
          admissionEnabled: true,
        },
      }),
    ])
    let membershipQueries = 0
    let membershipCandidates = -1
    let baselineLookupQueries = 0
    let membershipWhere: unknown
    const observedDatabase = prisma.$extends({
      query: {
        installationMembership: {
          async findMany({ args, query }) {
            membershipQueries += 1
            membershipWhere = args.where
            const result = await query(args)
            membershipCandidates = result.length
            return result
          },
        },
        gitHubSynchronizedAccess: {
          findFirst({ args, query }) {
            baselineLookupQueries += 1
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
    await saveAdmissionFixture(prisma, observedService, actor.user.id, actor.identity.subject, {
      repositorySourceId: eligibleSource.id,
      sourceGeneration: eligibleSource.synchronizationGeneration,
      rawPermission: "read",
      prototypeRole: "viewer",
      admissionEligible: true,
      confirmedAt: new Date(),
    })

    await expect(
      observedService.processWebhook(
        webhook(
          {
            action: "removed",
            installation: { id: 7 },
            repositories_removed: [{ id: Number(removedSource.githubRepositoryId) }],
          },
          "installation_repositories",
          "preserve-fresh-eligible-membership",
        ),
      ),
    ).resolves.toBe("accepted")

    expect(membershipQueries).toBe(1)
    expect(membershipCandidates).toBe(0)
    expect(baselineLookupQueries).toBe(0)
    expect(JSON.stringify(membershipWhere)).toContain('"source":"synchronized"')
    expect(JSON.stringify(membershipWhere)).toContain('"status":"active"')
    expect(JSON.stringify(membershipWhere)).toContain('"admissionEligible":true')
    expect(JSON.stringify(membershipWhere)).toContain('"admissionEnabled":true')
    expect(
      await prisma.installationMembership.findUniqueOrThrow({
        where: { id: actor.membership.id },
      }),
    ).toMatchObject({ source: "synchronized", status: "active" })
    expect(await prisma.session.findUnique({ where: { id: actor.session!.id } })).not.toBeNull()
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

  it("revalidates cached fallback in the callback transaction after synchronized revocation", async () => {
    const { prisma, service, store } = await database()
    const actor = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      token: "existing-session",
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
    const provider = await store.lock((records) =>
      records.currentAuthenticationProviderRevision("github"),
    )
    await store.lock((records) =>
      records.createAuthorizationAttempt({
        authenticationProviderRevisionId: provider!.id,
        originatingSessionId: null,
        stateDigest: digestSecret("fallback-state"),
        browserDigest: digestSecret("fallback-browser"),
        pkceVerifier: "fallback-verifier",
        nonce: null,
        purpose: "sign-in",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    )
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    const authentication = createAuthenticationService({
      store,
      github: {
        authorizationUrl: vi.fn(),
        identify: vi.fn().mockResolvedValue({
          subject: actor.identity.subject,
          username: actor.identity.username!,
          displayName: actor.user.displayName,
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
        admit: async (profile) => {
          const baseline = await service.evaluateAdmission(profile)
          await service.processWebhook(
            webhook(
              { action: "deleted", installation: { id: 7 } },
              "installation",
              "fallback-revocation",
            ),
          )
          return baseline
        },
        saveBaseline: (database, userId, baseline) =>
          service.saveAdmissionBaseline(database, userId, baseline),
      },
    })

    await expect(
      authentication.complete("code", "fallback-state", "fallback-browser"),
    ).rejects.toMatchObject({
      status: 409,
      code: "github_authorization_changed",
    })
    expect(
      await prisma.installationMembership.findUniqueOrThrow({
        where: { id: actor.membership.id },
      }),
    ).toMatchObject({ source: "synchronized", status: "removed" })
    expect(
      await prisma.gitHubSynchronizedAccess.findUniqueOrThrow({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: source.id,
            userId: actor.user.id,
          },
        },
      }),
    ).toMatchObject({ status: "removed" })
    expect(await prisma.session.count({ where: { userId: actor.user.id } })).toBe(0)
  })

  it("removes matching sources and synchronized membership before rejecting token 404 fallback", async () => {
    const { prisma, service, store } = await database()
    const actor = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      token: "synchronized-session",
    })
    const [matchingSource, otherSource] = await Promise.all([
      prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "100",
          appId: "12345",
          installationId: "7",
          owner: "owner",
          name: "matching",
          defaultBranch: "main",
          admissionEnabled: true,
        },
      }),
      prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "200",
          appId: "99999",
          installationId: "8",
          owner: "owner",
          name: "other",
          defaultBranch: "main",
          admissionEnabled: true,
        },
      }),
    ])
    await saveAdmissionFixture(prisma, service, actor.user.id, actor.identity.subject, {
      repositorySourceId: matchingSource.id,
      sourceGeneration: matchingSource.synchronizationGeneration,
      rawPermission: "read",
      prototypeRole: "viewer",
      admissionEligible: true,
      confirmedAt: new Date(),
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })))

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
      await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: matchingSource.id } }),
    ).toMatchObject({ status: "removed", admissionEnabled: false })
    expect(
      await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: otherSource.id } }),
    ).toMatchObject({ status: "active", admissionEnabled: true })
    expect(
      await prisma.gitHubSynchronizedAccess.findUniqueOrThrow({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: matchingSource.id,
            userId: actor.user.id,
          },
        },
      }),
    ).toMatchObject({ status: "removed" })
    expect(
      await prisma.installationMembership.findUniqueOrThrow({
        where: { id: actor.membership.id },
      }),
    ).toMatchObject({ source: "synchronized", status: "removed" })
    expect(await prisma.session.findUnique({ where: { id: actor.session!.id } })).toBeNull()
  })

  it("removes every unchanged source for an installation-token 404, including prototype-only sources", async () => {
    const { prisma, service, store } = await database()
    const actor = await createUser(store, {
      subject: "42",
      membershipSource: "synchronized",
      token: "synchronized-session",
    })
    const [admissionSource, prototypeSource, otherInstallation] = await Promise.all([
      prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "100",
          appId: "12345",
          installationId: "7",
          owner: "owner",
          name: "admission",
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
          name: "prototype-only",
          defaultBranch: "main",
          admissionEnabled: true,
        },
      }),
      prisma.gitHubRepositorySource.create({
        data: {
          githubRepositoryId: "300",
          appId: "12345",
          installationId: "8",
          owner: "owner",
          name: "other-installation",
          defaultBranch: "main",
          admissionEnabled: true,
        },
      }),
    ])
    for (const source of [admissionSource, prototypeSource]) {
      const currentSource = await prisma.gitHubRepositorySource.findUniqueOrThrow({
        where: { id: source.id },
      })
      await saveAdmissionFixture(prisma, service, actor.user.id, actor.identity.subject, {
        repositorySourceId: source.id,
        sourceGeneration: currentSource.synchronizationGeneration,
        rawPermission: "read",
        prototypeRole: "viewer",
        admissionEligible: true,
        confirmedAt: new Date(),
      })
    }
    await prisma.gitHubRepositorySource.update({
      where: { id: prototypeSource.id },
      data: { admissionEnabled: false },
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })))

    await expect(service.reconcileDue()).resolves.toBeUndefined()

    expect(
      await prisma.gitHubRepositorySource.findMany({
        where: { id: { in: [admissionSource.id, prototypeSource.id] } },
        orderBy: { id: "asc" },
        select: { status: true, admissionEnabled: true },
      }),
    ).toEqual([
      { status: "removed", admissionEnabled: false },
      { status: "removed", admissionEnabled: false },
    ])
    expect(
      await prisma.gitHubSynchronizedAccess.findMany({
        where: { repositorySourceId: { in: [admissionSource.id, prototypeSource.id] } },
        select: { status: true },
      }),
    ).toEqual([{ status: "removed" }, { status: "removed" }])
    expect(
      await prisma.gitHubRepositorySource.findUniqueOrThrow({
        where: { id: otherInstallation.id },
      }),
    ).toMatchObject({ status: "active", admissionEnabled: true })
    expect(
      await prisma.installationMembership.findUniqueOrThrow({
        where: { id: actor.membership.id },
      }),
    ).toMatchObject({ source: "synchronized", status: "removed" })
    expect(await prisma.session.findUnique({ where: { id: actor.session!.id } })).toBeNull()
  })

  it("preserves a newer source when installation-token 404 removal starts from a stale snapshot", async () => {
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
      },
    })
    const tokenRequested = deferred<void>()
    const tokenResponse = deferred<Response>()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = requestUrl(input)
        if (!url.endsWith("/access_tokens")) throw new Error(`Unexpected request: ${url}`)
        tokenRequested.resolve()
        return tokenResponse.promise
      }),
    )
    const admission = service.evaluateAdmission({
      subject: "42",
      username: "user-42",
      displayName: "User 42",
      avatarUrl: null,
    })
    await tokenRequested.promise
    await prisma.gitHubRepositorySource.update({
      where: { id: source.id },
      data: {
        installationId: "8",
        synchronizationGeneration: { increment: 1 },
        synchronizationStatus: "dirty",
      },
    })
    tokenResponse.resolve(new Response(null, { status: 404 }))
    await expect(admission).rejects.toMatchObject({
      status: 503,
      code: "source_integration_unavailable",
    })

    expect(
      await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: source.id } }),
    ).toMatchObject({
      status: "active",
      installationId: "8",
      admissionEnabled: true,
      synchronizationGeneration: source.synchronizationGeneration + 1,
    })
  })

  it.each([
    { action: "deleted", expectedSourceStatus: "removed" },
    { action: "suspend", expectedSourceStatus: "suspended" },
  ] as const)(
    "uses the trusted linked installation for a signed $action webhook when credentials are unreadable",
    async ({ action, expectedSourceStatus }) => {
      const { prisma, service, store } = await database({
        HUB_GITHUB_CREDENTIAL_PROVIDER: "database",
        HUB_GITHUB_CREDENTIAL_KEY: "ab".repeat(32),
      })
      const actor = await createUser(store, {
        subject: "42",
        membershipSource: "synchronized",
        token: `${action}-session`,
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
      await store.lock((records) =>
        records.saveGitHubIntegrationCredentials("invalid-encrypted-credentials"),
      )

      await expect(
        service.processWebhook(
          webhook(
            { action, installation: { id: 7 } },
            "installation",
            `unreadable-credentials-${action}`,
          ),
        ),
      ).resolves.toBe("accepted")

      expect(
        await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: source.id } }),
      ).toMatchObject({ status: expectedSourceStatus })
      expect(
        await prisma.gitHubSynchronizedAccess.findUniqueOrThrow({
          where: {
            repositorySourceId_userId: {
              repositorySourceId: source.id,
              userId: actor.user.id,
            },
          },
        }),
      ).toMatchObject({ status: "removed" })
      expect(
        await prisma.installationMembership.findUniqueOrThrow({
          where: { id: actor.membership.id },
        }),
      ).toMatchObject({ source: "synchronized", status: "removed" })
      expect(await prisma.session.findUnique({ where: { id: actor.session!.id } })).toBeNull()
    },
  )

  it("reconciles only GitHub identities with an active installation membership", async () => {
    const { prisma, service, store } = await database()
    const active = await createUser(store, { subject: "42" })
    await createUser(store, { subject: "43", status: "suspended" })
    await createUser(store, { subject: "44", status: "removed" })
    await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
      },
    })
    const permissionRequests: string[] = []
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
        const user = currentGitHubUserResponse(url)
        if (user) return Promise.resolve(user)
        permissionRequests.push(url)
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 42 }, permission: "read" }), { status: 200 }),
        )
      }),
    )

    await service.reconcileDue()

    expect(permissionRequests).toHaveLength(1)
    expect(permissionRequests[0]).toContain(active.identity.username!)
    expect(permissionRequests[0]).not.toContain("user-43")
    expect(permissionRequests[0]).not.toContain("user-44")
  })

  it("uses each result confirmation time so a later reconciliation denial beats sign-in", async () => {
    const { prisma, service, store } = await database()
    const users = []
    for (let index = 0; index < 11; index += 1) {
      users.push(await createUser(store, { subject: String(100 + index) }))
    }
    users.sort((left, right) => left.identity.id.localeCompare(right.identity.id))
    const target = users.at(-1)!
    await prisma.installationMembership.update({
      where: { id: target.membership.id },
      data: { source: "synchronized" },
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
    const provider = await store.lock((records) =>
      records.currentAuthenticationProviderRevision("github"),
    )
    await store.lock((records) =>
      records.createAuthorizationAttempt({
        authenticationProviderRevisionId: provider!.id,
        originatingSessionId: null,
        stateDigest: digestSecret("later-denial-state"),
        browserDigest: digestSecret("later-denial-browser"),
        pkceVerifier: "later-denial-verifier",
        nonce: null,
        purpose: "sign-in",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    )
    const subjectByUsername = new Map(
      users.map(({ identity }) => [identity.username!, identity.subject]),
    )
    const firstPermissionBatch: Array<{
      subject: string
      response: ReturnType<typeof deferred<Response>>
    }> = []
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
        const user = currentGitHubUserResponse(url)
        if (user) return Promise.resolve(user)
        const username = decodeURIComponent(
          url.match(/collaborators\/([^/]+)\/permission$/)?.[1] ?? "",
        )
        const subject = subjectByUsername.get(username)
        if (!subject) throw new Error(`Unexpected request: ${url}`)
        if (username === target.identity.username) {
          targetPermissionRequests += 1
          return Promise.resolve(
            new Response(
              JSON.stringify({
                user: { id: Number(subject) },
                permission: targetPermissionRequests === 1 ? "write" : "none",
              }),
              { status: 200 },
            ),
          )
        }
        const response = deferred<Response>()
        firstPermissionBatch.push({ subject, response })
        return response.promise
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

    const reconciliation = service.reconcileDue()
    await vi.waitFor(() => expect(firstPermissionBatch).toHaveLength(10))
    const laterSignIn = await authentication.complete(
      "code",
      "later-denial-state",
      "later-denial-browser",
    )
    expect(laterSignIn.purpose).toBe("sign-in")
    expect(typeof laterSignIn.sessionToken).toBe("string")
    firstPermissionBatch.forEach(({ subject, response }) =>
      response.resolve(
        new Response(JSON.stringify({ user: { id: Number(subject) }, permission: "read" }), {
          status: 200,
        }),
      ),
    )
    await reconciliation

    expect(targetPermissionRequests).toBe(2)
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
      await prisma.installationMembership.findUniqueOrThrow({
        where: { id: target.membership.id },
      }),
    ).toMatchObject({ source: "synchronized", status: "removed" })
    expect(await prisma.session.count({ where: { userId: target.user.id } })).toBe(0)
  })

  it("applies confirmed identities in bounded transactions outside the identity lock", async () => {
    const { prisma, store } = await database()
    for (let index = 0; index < 51; index += 1) {
      await createUser(store, { subject: String(1_000 + index) })
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
    const transactionState = new AsyncLocalStorage<{ baselineWrites: number }>()
    let identityLockDepth = 0
    let baselineWritesInsideIdentityLock = 0
    const observedDatabase = prisma.$extends({
      query: {
        gitHubSynchronizedAccess: {
          upsert({ args, query }) {
            const state = transactionState.getStore()
            if (state) state.baselineWrites += 1
            if (identityLockDepth > 0) baselineWritesInsideIdentityLock += 1
            return query(args)
          },
        },
      },
    }) as unknown as PrismaClient
    const originalTransaction = observedDatabase.$transaction.bind(observedDatabase) as unknown as (
      operation: (transaction: Prisma.TransactionClient) => Promise<unknown>,
    ) => Promise<unknown>
    const batchWriteCounts: number[] = []
    vi.spyOn(observedDatabase, "$transaction").mockImplementation(
      async (operation: (transaction: Prisma.TransactionClient) => Promise<unknown>) => {
        const state = { baselineWrites: 0 }
        const result = await originalTransaction((transaction) =>
          transactionState.run(state, () => operation(transaction)),
        )
        if (state.baselineWrites > 0) batchWriteCounts.push(state.baselineWrites)
        return result
      },
    )
    const observedStore = createIdentityStore(observedDatabase)
    const originalLock = observedStore.lock.bind(observedStore)
    vi.spyOn(observedStore, "lock").mockImplementation((operation) =>
      originalLock(async (...args) => {
        identityLockDepth += 1
        try {
          return await operation(...args)
        } finally {
          identityLockDepth -= 1
        }
      }),
    )
    const observedService = createGitHubAuthorizationService({
      database: observedDatabase,
      environment: environment(),
      store: observedStore,
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
        const user = currentGitHubUserResponse(url)
        if (user) return Promise.resolve(user)
        const subject = url.match(/collaborators\/user-(\d+)\/permission$/)?.[1]
        if (!subject) throw new Error(`Unexpected request: ${url}`)
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: Number(subject) }, permission: "read" }), {
            status: 200,
          }),
        )
      }),
    )

    await observedService.reconcileDue()

    expect(batchWriteCounts).toEqual([50, 1])
    expect(baselineWritesInsideIdentityLock).toBe(0)
    expect(
      await prisma.gitHubSynchronizedAccess.count({ where: { repositorySourceId: source.id } }),
    ).toBe(51)
    expect(
      await prisma.securityAudit.count({
        where: {
          event: "github.repository.reconcile.batch",
          githubRepositorySourceId: source.id,
        },
      }),
    ).toBe(2)
    expect(
      await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: source.id } }),
    ).toMatchObject({
      synchronizationGeneration: source.synchronizationGeneration + 1,
      synchronizationStatus: "current",
    })
  })

  it("rolls back a reconciliation baseline batch when its required audit cannot be saved", async () => {
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
      },
    })
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION reject_reconciliation_batch_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.event = 'github.repository.reconcile.batch' THEN
          RAISE EXCEPTION 'synthetic reconciliation batch audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_reconciliation_batch_audit
      BEFORE INSERT ON security_audits
      FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_batch_audit();
    `)
    onTestFinished(async () => {
      await prisma.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS reject_reconciliation_batch_audit ON security_audits",
      )
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS reject_reconciliation_batch_audit()")
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
        if (url.endsWith("/user/42")) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 42, login: "user-42" }), { status: 200 }),
          )
        }
        if (url.endsWith("/collaborators/user-42/permission")) {
          return Promise.resolve(
            new Response(JSON.stringify({ user: { id: 42 }, permission: "read" }), {
              status: 200,
            }),
          )
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )

    await expect(service.reconcileDue()).resolves.toBeUndefined()

    expect(
      await prisma.gitHubSynchronizedAccess.count({
        where: { repositorySourceId: source.id, userId: actor.user.id },
      }),
    ).toBe(0)
    expect(
      await prisma.securityAudit.count({
        where: {
          event: "github.repository.reconcile.batch",
          githubRepositorySourceId: source.id,
        },
      }),
    ).toBe(0)
    expect(
      await prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: source.id } }),
    ).toMatchObject({
      synchronizationStatus: "failed",
      synchronizationError: "apply_failed",
    })
  })

  it("logs a returned partial reconciliation status without requiring a thrown error", async () => {
    const { prisma, service, store } = await database()
    await createUser(store, { subject: "42" })
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
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined)
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

    await expect(service.reconcileDue()).resolves.toBeUndefined()

    expect(errorLog).toHaveBeenCalledWith(
      {
        repositorySourceId: source.id,
        reason: "permission_partial_failure",
      },
      "GitHub authorization reconciliation failed",
    )
  })

  it("coalesces repeated dirty webhooks into one bounded reconciliation retry", async () => {
    const { prisma, service } = await database()
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const source = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "100",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository",
        defaultBranch: "main",
        synchronizationStatus: "current",
      },
    })
    const repositoryRequested = deferred<void>()
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url.endsWith("/access_tokens")) {
        return Promise.resolve(
          new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
        )
      }
      if (url.endsWith("/repositories/100")) {
        repositoryRequested.resolve()
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
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    for (const deliveryId of ["dirty-one", "dirty-two", "dirty-three"]) {
      await expect(
        service.processWebhook(
          webhook({ action: "edited", installation: { id: 7 } }, "membership", deliveryId),
        ),
      ).resolves.toBe("accepted")
    }

    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await repositoryRequested.promise

    expect(
      fetchMock.mock.calls.filter(([input]) => requestUrl(input).endsWith("/access_tokens")),
    ).toHaveLength(1)
    expect(
      fetchMock.mock.calls.filter(([input]) => requestUrl(input).endsWith("/repositories/100")),
    ).toHaveLength(1)
    await vi.waitFor(async () => {
      await expect(
        prisma.gitHubRepositorySource.findUniqueOrThrow({ where: { id: source.id } }),
      ).resolves.toMatchObject({ synchronizationStatus: "current" })
    })
  })

  it("keeps the dirty retry guard through a bounded batch, retains new IDs, and logs failures", async () => {
    const { prisma, service } = await database()
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout")
    const initialSources = await Promise.all(
      ["100", "200", "300", "400"].map((githubRepositoryId) =>
        prisma.gitHubRepositorySource.create({
          data: {
            githubRepositoryId,
            appId: "12345",
            installationId: "7",
            owner: "owner",
            name: `repository-${githubRepositoryId}`,
            defaultBranch: "main",
            synchronizationStatus: "current",
          },
        }),
      ),
    )
    type PendingRepositoryRequest = {
      githubRepositoryId: string
      response: ReturnType<typeof deferred<Response>>
    }
    const firstRepositoryRequests: PendingRepositoryRequest[] = []
    const secondRepositoryRequests: PendingRepositoryRequest[] = []
    const thirdRepositoryRequests: string[] = []
    const firstBatchStarted = deferred<void>()
    const secondBatchStarted = deferred<void>()
    const thirdBatchStarted = deferred<void>()
    const requestedRepositoryIds: string[] = []
    let pendingRepositoryRequests: PendingRepositoryRequest[] | null = firstRepositoryRequests
    let concurrentRepositoryRequests = 0
    let maximumConcurrentRepositoryRequests = 0
    function successfulRepositoryResponse(githubRepositoryId: string) {
      return new Response(
        JSON.stringify({
          id: Number(githubRepositoryId),
          full_name: `owner/repository-${githubRepositoryId}`,
          name: `repository-${githubRepositoryId}`,
          owner: { login: "owner" },
          default_branch: "main",
          visibility: "private",
        }),
        { status: 200 },
      )
    }
    const request = vi.fn((input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url.endsWith("/access_tokens")) {
        return Promise.resolve(
          new Response(JSON.stringify({ token: "installation-token" }), { status: 200 }),
        )
      }
      const githubRepositoryId = url.match(/\/repositories\/(\d+)$/)?.[1]
      if (!githubRepositoryId) throw new Error(`Unexpected request: ${url}`)
      requestedRepositoryIds.push(githubRepositoryId)
      concurrentRepositoryRequests += 1
      maximumConcurrentRepositoryRequests = Math.max(
        maximumConcurrentRepositoryRequests,
        concurrentRepositoryRequests,
      )
      if (pendingRepositoryRequests) {
        const response = deferred<Response>()
        const batch = pendingRepositoryRequests
        batch.push({ githubRepositoryId, response })
        if (batch.length === 4) {
          if (batch === firstRepositoryRequests) firstBatchStarted.resolve()
          if (batch === secondRepositoryRequests) secondBatchStarted.resolve()
        }
        return response.promise.finally(() => {
          concurrentRepositoryRequests -= 1
        })
      }
      thirdRepositoryRequests.push(githubRepositoryId)
      thirdBatchStarted.resolve()
      concurrentRepositoryRequests -= 1
      return Promise.resolve(successfulRepositoryResponse(githubRepositoryId))
    })
    vi.stubGlobal("fetch", request)
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined)
    async function waitForCurrentSources(githubRepositoryIds: string[]) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const sources = await prisma.gitHubRepositorySource.findMany({
          where: { githubRepositoryId: { in: githubRepositoryIds } },
          select: { synchronizationStatus: true },
        })
        if (
          sources.length === githubRepositoryIds.length &&
          sources.every(({ synchronizationStatus }) => synchronizationStatus === "current")
        ) {
          return
        }
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      throw new Error(`Sources did not become current: ${githubRepositoryIds.join(", ")}`)
    }
    function scheduledDirtyRetryCount() {
      return setTimeoutSpy.mock.calls.filter(([, timeout]) => timeout === 1_000).length
    }
    async function waitForScheduledBatch(
      scheduledRetryCountWhileRunning: number,
      startedRequests: readonly unknown[],
    ) {
      for (let attempt = 0; attempt < 1_000; attempt += 1) {
        if (
          scheduledDirtyRetryCount() > scheduledRetryCountWhileRunning ||
          startedRequests.length > 0
        ) {
          return
        }
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      throw new Error("The next dirty retry batch was not scheduled.")
    }

    await service.processWebhook(
      webhook({ action: "edited", installation: { id: 7 } }, "membership", "initial-dirty-batch"),
    )
    await vi.advanceTimersByTimeAsync(1_000)
    await firstBatchStarted.promise
    const initialGithubRepositoryIds = initialSources.map(
      ({ githubRepositoryId }) => githubRepositoryId,
    )
    expect(firstRepositoryRequests.map(({ githubRepositoryId }) => githubRepositoryId)).toEqual(
      expect.arrayContaining(initialGithubRepositoryIds),
    )
    const laterSource = await prisma.gitHubRepositorySource.create({
      data: {
        githubRepositoryId: "500",
        appId: "12345",
        installationId: "7",
        owner: "owner",
        name: "repository-500",
        defaultBranch: "main",
        synchronizationStatus: "current",
      },
    })
    await service.processWebhook(
      webhook(
        {
          action: "edited",
          installation: { id: 7 },
          repository: {
            id: 500,
            name: "repository-500",
            owner: { login: "owner" },
            default_branch: "main",
          },
        },
        "member",
        "dirty-during-running-batch",
      ),
    )

    await vi.advanceTimersByTimeAsync(10_000)
    expect(firstRepositoryRequests).toHaveLength(4)
    expect(secondRepositoryRequests).toHaveLength(0)
    expect(thirdRepositoryRequests).toHaveLength(0)
    expect(requestedRepositoryIds).not.toContain("500")
    expect(maximumConcurrentRepositoryRequests).toBe(4)

    const scheduledRetryCountDuringFirstBatch = scheduledDirtyRetryCount()
    pendingRepositoryRequests = secondRepositoryRequests
    firstRepositoryRequests.forEach(({ githubRepositoryId, response }, index) => {
      response.resolve(
        index === 0
          ? new Response(null, { status: 503 })
          : successfulRepositoryResponse(githubRepositoryId),
      )
    })
    const failedGithubRepositoryId = firstRepositoryRequests[0]!.githubRepositoryId
    const failedSource = initialSources.find(
      ({ githubRepositoryId }) => githubRepositoryId === failedGithubRepositoryId,
    )
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const settledSources = await prisma.gitHubRepositorySource.findMany({
        where: { id: { in: initialSources.map(({ id }) => id) } },
        select: { id: true, synchronizationStatus: true },
      })
      if (
        settledSources.length === initialSources.length &&
        settledSources.every(({ id, synchronizationStatus }) =>
          id === failedSource!.id
            ? synchronizationStatus === "failed"
            : synchronizationStatus === "current",
        )
      ) {
        break
      }
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    for (let attempt = 0; attempt < 100 && errorLog.mock.calls.length === 0; attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    expect(
      errorLog.mock.calls.some(
        ([fields, message]) =>
          message === "GitHub authorization dirty retry failed" &&
          typeof fields === "object" &&
          fields !== null &&
          Reflect.get(fields, "repositorySourceId") === failedSource!.id &&
          Reflect.get(fields, "reason") === "reconciliation_failed",
      ),
    ).toBe(true)
    await waitForScheduledBatch(scheduledRetryCountDuringFirstBatch, secondRepositoryRequests)
    expect(secondRepositoryRequests).toHaveLength(0)
    expect(scheduledDirtyRetryCount()).toBe(scheduledRetryCountDuringFirstBatch + 1)

    await vi.advanceTimersByTimeAsync(999)
    expect(secondRepositoryRequests).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    await secondBatchStarted.promise

    const queuedGithubRepositoryIds = [
      ...initialGithubRepositoryIds,
      laterSource.githubRepositoryId,
    ]
    const secondBatchIds = secondRepositoryRequests.map(
      ({ githubRepositoryId }) => githubRepositoryId,
    )
    expect(secondBatchIds).toHaveLength(4)
    expect(new Set(secondBatchIds).size).toBe(4)
    expect(secondBatchIds.every((sourceId) => queuedGithubRepositoryIds.includes(sourceId))).toBe(
      true,
    )
    const runningSecondBatchSources = await prisma.gitHubRepositorySource.findMany({
      where: { githubRepositoryId: { in: secondBatchIds } },
      select: { synchronizationStatus: true },
    })
    expect(runningSecondBatchSources).toHaveLength(4)
    expect(
      runningSecondBatchSources.every(
        ({ synchronizationStatus }) => synchronizationStatus === "dirty",
      ),
    ).toBe(true)
    expect(thirdRepositoryRequests).toHaveLength(0)
    expect(maximumConcurrentRepositoryRequests).toBe(4)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(secondRepositoryRequests).toHaveLength(4)
    expect(thirdRepositoryRequests).toHaveLength(0)

    const scheduledRetryCountDuringSecondBatch = scheduledDirtyRetryCount()
    pendingRepositoryRequests = null
    secondRepositoryRequests.forEach(({ githubRepositoryId, response }) => {
      response.resolve(successfulRepositoryResponse(githubRepositoryId))
    })
    await waitForCurrentSources(secondBatchIds)
    await waitForScheduledBatch(scheduledRetryCountDuringSecondBatch, thirdRepositoryRequests)
    expect(thirdRepositoryRequests).toHaveLength(0)
    expect(scheduledDirtyRetryCount()).toBe(scheduledRetryCountDuringSecondBatch + 1)

    const thirdBatchIds = queuedGithubRepositoryIds.filter(
      (sourceId) => !secondBatchIds.includes(sourceId),
    )
    expect(thirdBatchIds).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(thirdRepositoryRequests).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    await thirdBatchStarted.promise

    expect(thirdRepositoryRequests).toEqual(thirdBatchIds)
    expect(new Set([...secondBatchIds, ...thirdRepositoryRequests])).toEqual(
      new Set(queuedGithubRepositoryIds),
    )
    expect(maximumConcurrentRepositoryRequests).toBe(4)
    await waitForCurrentSources(queuedGithubRepositoryIds)
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
