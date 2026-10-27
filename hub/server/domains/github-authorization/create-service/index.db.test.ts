import { createHmac, generateKeyPairSync } from "node:crypto"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createGitHubAuthorizationService } from "#server/domains/github-authorization/create-service"
import { createIdentityStore } from "#server/domains/identity/create-store"
import { digestSecret } from "#server/utils/digest-secret"

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

async function database() {
  vi.stubGlobal("prisma", undefined)
  const { prisma } = await import("../../../integrations/prisma")
  onTestFinished(() => prisma.$disconnect())
  const store = createIdentityStore(prisma)
  return {
    prisma,
    store,
    service: createGitHubAuthorizationService({
      database: prisma,
      environment: environment(),
      store,
    }),
  }
}

async function createUser(
  store: IdentityStore,
  {
    subject,
    membershipSource = "manual",
    token,
  }: {
    subject: string
    membershipSource?: "manual" | "synchronized"
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
      status: "active",
      role: "member",
      source: membershipSource,
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
    await service.saveAdmissionBaseline(prisma, actor.user.id, {
      repositorySourceId: source.id,
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
    await service.saveAdmissionBaseline(prisma, actor.user.id, {
      repositorySourceId: source.id,
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
    await service.saveAdmissionBaseline(prisma, actor.user.id, {
      repositorySourceId: source.id,
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

  it("keeps the newer result when overlapping reconciliations finish out of order", async () => {
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
          create: { userId: actor.user.id, effect: "deny", role: null },
        },
      },
    })
    const firstRepositoryResponse = deferred<Response>()
    const secondRepositoryResponse = deferred<Response>()
    const firstRepositoryRequested = deferred<void>()
    const secondRepositoryRequested = deferred<void>()
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
          if (repositoryRequests === 1) {
            firstRepositoryRequested.resolve()
            return firstRepositoryResponse.promise
          }
          secondRepositoryRequested.resolve()
          return secondRepositoryResponse.promise
        }
        const permission = url.includes("newer-owner") ? "read" : "write"
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 42 }, permission }), { status: 200 }),
        )
      }),
    )

    const olderReconciliation = service.reconcileDue()
    await firstRepositoryRequested.promise
    const newerReconciliation = service.reconcileDue()
    await secondRepositoryRequested.promise
    secondRepositoryResponse.resolve(
      new Response(
        JSON.stringify({
          id: 100,
          full_name: "newer-owner/newer-name",
          name: "newer-name",
          owner: { login: "newer-owner" },
          default_branch: "newer-branch",
        }),
        { status: 200 },
      ),
    )
    await newerReconciliation
    firstRepositoryResponse.resolve(
      new Response(
        JSON.stringify({
          id: 100,
          full_name: "older-owner/older-name",
          name: "older-name",
          owner: { login: "older-owner" },
          default_branch: "older-branch",
        }),
        { status: 200 },
      ),
    )
    await olderReconciliation

    expect(
      await prisma.gitHubRepositorySource.findUnique({ where: { id: source.id } }),
    ).toMatchObject({
      synchronizationGeneration: 2,
      synchronizationStatus: "current",
      owner: "newer-owner",
      name: "newer-name",
      defaultBranch: "newer-branch",
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
      rawPermission: "read",
      mappedPrototypeRole: "viewer",
      status: "active",
    })
    expect(
      await prisma.workspaceAccessGrant.findUnique({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: actor.user.id } },
      }),
    ).toMatchObject({ effect: "deny", role: null })
    expect(
      await prisma.securityAudit.count({
        where: { event: "github.repository.reconcile", githubRepositorySourceId: source.id },
      }),
    ).toBe(1)
  })

  it("does not use one repository's cached grant when another repository fails", async () => {
    const { prisma, service, store } = await database()
    const actor = await createUser(store, { subject: "42" })
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
    await service.saveAdmissionBaseline(prisma, actor.user.id, {
      repositorySourceId: sourceA.id,
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
        if (url.includes("repository-a")) {
          return Promise.resolve(new Response(null, { status: 404 }))
        }
        if (url.includes("repository-b")) {
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
    ).resolves.toBeNull()

    expect(
      await prisma.gitHubSynchronizedAccess.findUnique({
        where: {
          repositorySourceId_userId: {
            repositorySourceId: sourceA.id,
            userId: actor.user.id,
          },
        },
      }),
    ).toMatchObject({ rawPermission: "write", status: "active" })
    expect(sourceB.id).not.toBe(sourceA.id)
  })

  it("uses a fresh cached grant only when that same repository's live check fails", async () => {
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
    await service.saveAdmissionBaseline(prisma, actor.user.id, {
      repositorySourceId: source.id,
      rawPermission: "read",
      prototypeRole: "viewer",
      admissionEligible: true,
      confirmedAt,
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
    ).resolves.toEqual({
      repositorySourceId: source.id,
      rawPermission: "read",
      admissionEligible: true,
      prototypeRole: "viewer",
      confirmedAt,
    })
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
    await service.saveAdmissionBaseline(prisma, actor.user.id, {
      repositorySourceId: source.id,
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
