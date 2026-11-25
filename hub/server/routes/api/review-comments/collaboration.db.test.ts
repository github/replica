import { fork } from "node:child_process"
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { fileURLToPath } from "node:url"
import { describe, expect, it, onTestFinished } from "vitest"
import WebSocket from "ws"

import { deferred } from "../../../../test/ws/deferred"
import { createApp } from "../../../create-app"
import { captureRepositoryReviewSnapshot } from "../../../domains/review-comments/capture-repository-review-snapshot"
import { createReviewDirectory } from "../../../integrations/github/create-review-directory"
import type { GitHubReviewDirectory } from "../../../integrations/github/create-review-directory/types"
import { prisma } from "../../../integrations/prisma"
import { createAuthenticationRouteDependencies } from "../auth/create-authentication-route-dependencies"
import { createProductRouteDependencies } from "../product/create-product-route-dependencies"

const origin = "http://127.0.0.1:5173"
const inbox = "/api/notifications/inbox"
const anchor = {
  schemaVersion: 1,
  kind: "element",
  route: { pathname: "/review", search: "", hash: "" },
  selector: "#title",
  accessibleName: "Title",
  tagName: "h1",
  selectedText: "",
  rect: { x: 10, y: 10, width: 100, height: 24 },
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
  elementOffset: { x: 0.5, y: 0.5 },
}

function authEnvironment(provider: "local" | "github") {
  const shared = {
    HUB_APPLICATION_ORIGIN: origin,
    HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    HUB_BOOTSTRAP_SECRET: "synthetic-bootstrap-secret-at-least-32-characters",
  }
  if (provider === "local") return { ...shared, NODE_ENV: "development", HUB_LOCAL_SIGN_IN: "true" }
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  return {
    ...shared,
    GITHUB_CLIENT_ID: "synthetic-client",
    GITHUB_CLIENT_SECRET: "synthetic-secret",
    GITHUB_PROVIDER_REVISION: "1",
    GITHUB_APP_ID: "123",
    GITHUB_APP_INSTALLATION_ID: "456",
    GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(
      privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    ).toString("base64"),
    GITHUB_WEBHOOK_SECRET: "synthetic-webhook-secret-at-least-20-characters",
  }
}

async function member(
  provider: "local" | "github",
  login: string,
  subject = randomUUID() as string,
) {
  const revision = await prisma.authenticationProvider.findUniqueOrThrow({
    where: { key: provider },
  })
  const user = await prisma.user.create({ data: { profile: { create: { provider, login } } } })
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
      providerRevisionId: revision.selectedRevisionId,
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
      providerRevisionId: revision.selectedRevisionId,
      digest: createHash("sha256").update(token).digest("hex"),
      revocationRevision: 0,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    },
  })
  return { token, userId: user.id, membershipId: membership.id }
}

async function target(authorId: string, local: boolean, githubRepositoryId = 771) {
  const repository = await prisma.repository.create({
    data: {
      nameWithOwner: `review/example-${githubRepositoryId}`,
      defaultBranch: "main",
      ...(local ? { localPath: "/workspace/synthetic-review" } : { githubRepositoryId }),
    },
  })
  const prototype = await prisma.prototype.create({
    data: {
      repositoryId: repository.id,
      authorId,
      name: "Example",
      branchName: "prototype/example",
      registeredAt: new Date(),
    },
  })
  const build = await prisma.build.create({
    data: { prototypeId: prototype.id, state: "successful", number: 7 },
  })
  await prisma.prototype.update({ where: { id: prototype.id }, data: { currentBuildId: build.id } })
  return {
    repositoryId: repository.id,
    prototypeId: prototype.id,
    path: `/api/repositories/${repository.id}/prototypes/${prototype.id}/review-comments`,
    channel: `review:${repository.id}:${prototype.id}`,
  }
}

async function grant(repositoryId: string, membershipId: string) {
  return prisma.repositoryAccessGrant.create({
    data: { repositoryId, membershipId, observedAt: new Date() },
  })
}

async function api(
  provider: "local" | "github",
  directory?: GitHubReviewDirectory,
  observeResponse?: (response: ServerResponse) => void,
) {
  const authentication = await createAuthenticationRouteDependencies(authEnvironment(provider))
  const server = createServer(
    createApp({
      authentication,
      product: createProductRouteDependencies({
        scopeGitHubMembers: provider === "github",
        githubReviewDirectory: directory,
      }),
    }),
  )
  if (observeResponse)
    server.prependListener("request", (_request, response) => observeResponse(response))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function request(base: string, token: string, path: string, method = "GET", data?: object) {
  return fetch(`${base}${path}`, {
    method,
    headers: { origin, cookie: `hub_session=${token}`, "content-type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  })
}

function startThread(base: string, token: string, path: string, body: string) {
  return request(base, token, path, "POST", { review_comment: { build_number: 7, body, anchor } })
}

type Notice = { id: number; version: number; read: boolean; path: string; updatePath: string }
type Comments = {
  id: number
  activityVersion: number
  viewerLastSeenActivityVersion: number | null
  body: string
  mentions: { login: string }[]
}[]

async function json<T>(response: Response) {
  return (await response.json()) as T
}

async function reviewComments(response: Response) {
  return (await json<{ comments: Comments }>(response)).comments
}

async function inboxPage(response: Response) {
  return json<{ notifications: Notice[]; unreadCount: number; nextBefore: number | null }>(response)
}

function first<T>(records: T[]) {
  const record = records[0]
  if (!record) throw new Error("The API returned no records.")
  return record
}

describe("saved review collaboration", () => {
  it("keeps activity, reactions, thread receipts, and Inbox reads independent for real local members", async () => {
    const base = await api("local")
    const author = await member("local", "review-author")
    const owner = await member("local", "prototype-owner")
    const outsider = await member("local", "other-reviewer")
    const { path, repositoryId, prototypeId } = await target(owner.userId, true)
    const body =
      "  @prototype-owner @PROTOTYPE-OWNER @review-author @not-enrolled\nUnchanged source.  "
    const created = await startThread(base, author.token, path, body)
    expect(created.status).toBe(201)
    const root = first(await reviewComments(created))
    expect(root).toMatchObject({
      body,
      mentions: [{ login: "prototype-owner" }],
      viewerLastSeenActivityVersion: 1,
    })
    const candidateResponse = await request(
      base,
      author.token,
      `${path}/mention-candidates?q=owner`,
    )
    expect(await candidateResponse.json()).toEqual({
      candidates: [{ login: "prototype-owner", avatarUrl: null }],
    })

    const page = await inboxPage(await request(base, owner.token, `${inbox}?unread=true&limit=1`))
    const notice = first(page.notifications)
    expect(page.unreadCount).toBe(1)
    expect(notice).toMatchObject({
      kind: "mention",
      read: false,
      target: { prototypeId, threadId: root.id, commentId: root.id },
    })
    expect((await inboxPage(await request(base, author.token, inbox))).notifications).toEqual([])
    expect(
      (
        await request(base, outsider.token, notice.updatePath, "PATCH", {
          notification: { read: true, version: notice.version },
        })
      ).status,
    ).toBe(404)

    const markRead = await request(base, owner.token, `${path}/${root.id}/read`, "POST", {
      review_thread_read: { activity_version: root.activityVersion },
    })
    expect(first(await reviewComments(markRead)).viewerLastSeenActivityVersion).toBe(
      root.activityVersion,
    )
    const savedNotice = await request(base, owner.token, notice.updatePath, "PATCH", {
      notification: { read: true, version: notice.version },
    })
    expect(await savedNotice.json()).toEqual({
      read: true,
      version: notice.version + 1,
    })
    expect(
      (
        await request(base, owner.token, notice.updatePath, "PATCH", {
          notification: { read: false, version: notice.version },
        })
      ).status,
    ).toBe(409)

    const beforeReaction = (await captureRepositoryReviewSnapshot(prisma, repositoryId)).threads
    function add() {
      return request(base, owner.token, `${path}/${root.id}/reactions`, "POST", {
        review_comment_reaction: { content: "heart", activity_version: root.activityVersion },
      })
    }
    const added = first(await reviewComments(await add()))
    const [retry] = await reviewComments(await add())
    expect(retry).toMatchObject({
      activityVersion: added.activityVersion,
      viewerLastSeenActivityVersion: added.activityVersion,
      reactions: [{ content: "heart", count: 1, viewerHasReacted: true }],
    })
    expect((await captureRepositoryReviewSnapshot(prisma, repositoryId)).threads).toEqual(
      beforeReaction,
    )
    const authorComments = await reviewComments(await request(base, author.token, path))
    expect(authorComments[0]).toMatchObject({
      activityVersion: added.activityVersion,
      viewerLastSeenActivityVersion: root.activityVersion,
      reactions: [{ content: "heart", count: 1, viewerHasReacted: false }],
    })
    const reactions = await inboxPage(await request(base, author.token, inbox))
    expect(reactions.notifications).toHaveLength(1)
    expect(reactions.notifications[0]).toMatchObject({ kind: "reaction", reactionContent: "heart" })
    await request(base, owner.token, `${path}/${root.id}/reactions/heart`, "DELETE", {
      review_comment_reaction: { activity_version: added.activityVersion },
    })
    expect((await inboxPage(await request(base, author.token, inbox))).unreadCount).toBe(0)
    const markedUnread = await request(base, owner.token, `${path}/${root.id}/read`, "DELETE")
    expect(first(await reviewComments(markedUnread)).viewerLastSeenActivityVersion).toBeNull()
    expect((await json<Notice>(await request(base, owner.token, notice.updatePath))).read).toBe(
      true,
    )
  })

  it("cancels the collaborator request and skips the next page when the client disconnects", async () => {
    const firstPageStarted = deferred<AbortSignal | null | undefined>()
    const releaseFirstPage = deferred<void>()
    const disconnected = deferred<void>()
    const searchFinished = deferred<void>()
    const pages: string[] = []
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const directory = createReviewDirectory(
      { appId: "123", installationId: "456", privateKey },
      async (input, options) => {
        const url = new URL(input instanceof Request ? input.url : input)
        const author = { id: 500, login: "author_corp" }
        if (url.pathname === "/app/installations/456/access_tokens")
          return Response.json({
            token: "synthetic",
            expires_at: new Date(Date.now() + 600_000).toISOString(),
          })
        if (url.pathname === "/repositories/771")
          return Response.json({ id: 771, full_name: "review/example" })
        if (url.pathname === "/user/500") return Response.json(author)
        if (url.pathname === "/repos/review/example/collaborators/author_corp/permission")
          return Response.json({ user: author, permission: "read" })
        if (url.pathname === "/repos/review/example/collaborators") {
          const page = url.searchParams.get("page") ?? ""
          pages.push(page)
          if (page !== "1") return Response.json([])

          firstPageStarted.resolve(options?.signal)
          await releaseFirstPage.promise
          // A full page can arrive as the client disconnects and would normally start another page.
          return Response.json(
            Array.from({ length: 100 }, (_, index) => ({
              id: index + 1,
              login: `collaborator-${index}`,
            })),
          )
        }
        throw new Error(`Unexpected synthetic GitHub path: ${url.pathname}`)
      },
    )
    const base = await api(
      "github",
      {
        ...directory,
        search: (...args) => directory.search(...args).finally(() => searchFinished.resolve()),
      },
      (response) => response.once("close", () => disconnected.resolve()),
    )
    const author = await member("github", "author_corp", "500")
    const { path, repositoryId } = await target(author.userId, false)
    await grant(repositoryId, author.membershipId)

    const abort = new AbortController()
    const lookup = fetch(`${base}${path}/mention-candidates?q=target`, {
      headers: { origin, cookie: `hub_session=${author.token}` },
      signal: abort.signal,
    }).catch((error: unknown) => error)

    try {
      const providerSignal = await firstPageStarted.promise
      abort.abort()
      await disconnected.promise
      const providerAborted = providerSignal?.aborted
      releaseFirstPage.resolve()
      await searchFinished.promise

      expect({ providerAborted, pages }).toEqual({
        providerAborted: true,
        pages: ["1"],
      })
    } finally {
      abort.abort()
      releaseFirstPage.resolve()
      await lookup
    }
  })

  it.each(["initial", "final"] as const)(
    "cancels the %s access check if the mention client disconnects",
    async (phase) => {
      const checkStarted = deferred<AbortSignal | undefined>()
      const checkFinished = deferred<void>()
      const releaseCheck = deferred<void>()
      const disconnected = deferred<void>()
      let checks = 0
      let searches = 0
      const base = await api(
        "github",
        {
          async canRead(_repository, _login, _githubId, signal) {
            checks++
            if (checks === (phase === "initial" ? 1 : 2)) {
              checkStarted.resolve(signal)
              await releaseCheck.promise
              checkFinished.resolve()
              signal?.throwIfAborted()
            }
            return true
          },
          find: () => Promise.resolve(null),
          search() {
            searches++
            return Promise.resolve([])
          },
        },
        (response) => response.once("close", () => disconnected.resolve()),
      )
      const author = await member("github", "author_corp", "500")
      const { path, repositoryId } = await target(author.userId, false)
      await grant(repositoryId, author.membershipId)

      const controller = new AbortController()
      const lookup = fetch(`${base}${path}/mention-candidates?q=target`, {
        headers: { origin, cookie: `hub_session=${author.token}` },
        signal: controller.signal,
      }).catch((error: unknown) => error)

      try {
        const signal = await checkStarted.promise
        controller.abort()
        await disconnected.promise
        expect(signal?.aborted).toBe(true)
        expect(searches).toBe(phase === "initial" ? 0 : 1)
      } finally {
        controller.abort()
        releaseCheck.resolve()
        await lookup
      }
      await checkFinished.promise
    },
  )

  it("verifies new hosted mentions before saving and hides retained notices after the recipient loses access", async () => {
    let collaboratorCanRead = true
    let providerAvailable = true
    let reviewAccessAvailable = true
    let delayVerification = false
    let startCheck!: () => void
    let finishCheck!: (allowed: boolean) => void
    const checking = new Promise<"checking">((resolve) => (startCheck = () => resolve("checking")))
    const pending = new Promise<boolean>((resolve) => (finishCheck = resolve))
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const directory = createReviewDirectory(
      { appId: "123", installationId: "456", privateKey },
      async (input) => {
        await Promise.resolve()
        const url = new URL(input instanceof Request ? input.url : input)
        const author = { id: 500, login: "author_corp" }
        const collaborator = { id: 501, login: "collaborator_corp" }
        if (url.pathname === "/app/installations/456/access_tokens")
          return Response.json({
            token: "synthetic",
            expires_at: new Date(Date.now() + 600_000).toISOString(),
          })
        if (url.pathname === "/repositories/771")
          return Response.json({ id: 771, full_name: "review/example" })
        if (url.pathname === "/user/500")
          return reviewAccessAvailable ? Response.json(author) : new Response(null, { status: 503 })
        if (url.pathname === "/user/501" || url.pathname === "/users/collaborator_corp")
          return providerAvailable
            ? Response.json(collaborator)
            : new Response(null, { status: 503 })
        if (url.pathname === "/users/ineligible") return new Response(null, { status: 404 })
        if (url.pathname === "/repos/review/example/collaborators")
          return Response.json([author, collaborator])
        if (url.pathname === "/repos/review/example/collaborators/author_corp/permission")
          return reviewAccessAvailable
            ? Response.json({ user: author, permission: "read" })
            : new Response(null, { status: 503 })
        if (
          url.pathname ===
          "/repos/review/example/collaborators/renamed-collaborator_corp/permission"
        )
          return new Response(null, { status: 404 })
        if (url.pathname === "/repos/review/example/collaborators/collaborator_corp/permission") {
          if (!providerAvailable) return new Response(null, { status: 503 })
          let allowed = collaboratorCanRead
          if (delayVerification) {
            startCheck()
            allowed = await pending
          }
          return Response.json({
            user: collaborator,
            permission: allowed ? "read" : "none",
          })
        }
        throw new Error(`Unexpected synthetic GitHub path: ${url.pathname}`)
      },
    )
    const base = await api("github", directory)
    const author = await member("github", "author_corp", "500")
    const { path, repositoryId } = await target(author.userId, false)
    await grant(repositoryId, author.membershipId)
    const candidates = await request(
      base,
      author.token,
      `${path}/mention-candidates?q=collaborator_corp`,
    )
    expect(candidates.status).toBe(200)
    expect(
      first((await json<{ candidates: { githubId: number }[] }>(candidates)).candidates).githubId,
    ).toBe(501)
    providerAvailable = false
    expect(
      (await startThread(base, author.token, path, "Unavailable @collaborator_corp")).status,
    ).toBe(503)
    expect(await reviewComments(await request(base, author.token, path))).toEqual([])
    providerAvailable = true
    const created = await startThread(
      base,
      author.token,
      path,
      "@collaborator_corp and @ineligible stay in the source.",
    )
    expect(created.status).toBe(201)
    expect(first(await reviewComments(created)).mentions).toEqual([
      { login: "collaborator_corp", githubId: 501 },
    ])

    const recipient = await member("github", "renamed-collaborator_corp", "501")
    const recipientGrant = await grant(repositoryId, recipient.membershipId)
    const notice = first(
      (await inboxPage(await request(base, recipient.token, inbox))).notifications,
    )
    expect(notice).toMatchObject({ kind: "mention", read: false })
    collaboratorCanRead = false
    expect(await (await request(base, recipient.token, inbox)).json()).toEqual({
      notifications: [],
      unreadCount: 0,
      nextBefore: null,
    })
    expect(
      (
        await request(base, recipient.token, notice.updatePath, "PATCH", {
          notification: { read: true, version: notice.version },
        })
      ).status,
    ).toBe(404)
    expect((await request(base, recipient.token, path)).status).toBe(404)
    const destination = new URL(notice.path, base)
    expect(
      (await request(base, recipient.token, `/api${destination.pathname}?from=inbox`)).status,
    ).toBe(404)
    collaboratorCanRead = true

    delayVerification = true
    const raced = request(base, recipient.token, notice.updatePath, "PATCH", {
      notification: { read: true, version: notice.version },
    })
    try {
      expect(await Promise.race([checking, raced.then(({ status }) => status)])).toBe("checking")
      await prisma.repositoryAccessGrant.delete({ where: { id: recipientGrant.id } })
    } finally {
      finishCheck(true)
    }
    expect((await raced).status).toBe(404)
    delayVerification = false
    await grant(repositoryId, recipient.membershipId)
    expect((await json<Notice>(await request(base, recipient.token, notice.updatePath))).read).toBe(
      false,
    )
    reviewAccessAvailable = false
    expect((await request(base, author.token, path)).status).toBe(503)
    reviewAccessAvailable = true
    expect(await reviewComments(await request(base, author.token, path))).toHaveLength(1)
  })

  it("opens and updates an Inbox notice even when another eligible repository cannot be verified", async () => {
    let otherRepositoryAvailable = true
    const checkedRepositories = new Set<bigint>()
    function canRead(repositoryId: bigint) {
      checkedRepositories.add(repositoryId)
      return repositoryId === 772n && !otherRepositoryAvailable
        ? Promise.reject(new Error("Synthetic outage"))
        : Promise.resolve(true)
    }
    const directory: GitHubReviewDirectory = {
      search: () => Promise.resolve([]),
      async find(repositoryId: bigint, login: string, githubId?: number) {
        return githubId && (await canRead(repositoryId))
          ? { githubId, login, avatarUrl: null }
          : null
      },
      canRead,
    }
    const base = await api("github", directory)
    const author = await member("github", "author", "500")
    const recipient = await member("github", "recipient", "501")
    const other = await target(recipient.userId, false, 772)
    const selected = await target(recipient.userId, false)
    for (const { repositoryId, path } of [other, selected]) {
      await grant(repositoryId, author.membershipId)
      await grant(repositoryId, recipient.membershipId)
      expect((await startThread(base, author.token, path, "For the prototype owner")).status).toBe(
        201,
      )
    }
    const page = await inboxPage(
      await request(base, recipient.token, `${inbox}?unread=true&limit=1`),
    )
    expect(page.unreadCount).toBe(2)
    const notice = first(page.notifications)
    expect(notice).toMatchObject({ read: false, target: { prototypeId: selected.prototypeId } })

    otherRepositoryAvailable = false
    checkedRepositories.clear()
    const opened = await request(base, recipient.token, notice.updatePath)
    expect(opened.status).toBe(200)
    expect(await opened.json()).toMatchObject({ id: notice.id, read: false })
    expect(checkedRepositories).toEqual(new Set([771n]))

    checkedRepositories.clear()
    const saved = await request(base, recipient.token, notice.updatePath, "PATCH", {
      notification: { read: true, version: notice.version },
    })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ read: true, version: notice.version + 1 })
    expect(checkedRepositories).toEqual(new Set([771n]))

    otherRepositoryAvailable = true
    expect((await inboxPage(await request(base, recipient.token, inbox))).unreadCount).toBe(1)
  })
})

async function separateApi(environment: NodeJS.ProcessEnv) {
  const child = fork(
    fileURLToPath(new URL("../../../run-api/test/review-api.ts", import.meta.url)),
    {
      execArgv: [],
      env: { ...process.env, ...environment },
      silent: true,
    },
  )
  const exited = once(child, "exit")
  onTestFinished(async () => {
    if (child.connected) child.disconnect()
    await exited
  })
  const address = await Promise.race([
    once(child, "message").then(([value]) => value as { port: number }),
    exited.then(([code]) => {
      throw new Error(`Review API test process exited with status ${code}.`)
    }),
  ])
  return `http://127.0.0.1:${address.port}`
}

describe("live review across API processes", () => {
  it("delivers only a commit invalidation and rechecks authorization when a grant is withdrawn", async () => {
    const environment = authEnvironment("github")
    const writerApi = await separateApi(environment)
    const viewerApi = await separateApi(environment)
    const author = await member("github", "author", "500")
    const viewer = await member("github", "viewer", "501")
    const { path, channel, repositoryId } = await target(author.userId, false)
    await grant(repositoryId, author.membershipId)
    const viewerGrant = await grant(repositoryId, viewer.membershipId)
    const url = new URL("/api/realtime", viewerApi)
    url.protocol = "ws:"
    const socket = new WebSocket(url, {
      origin,
      headers: { cookie: `hub_session=${viewer.token}` },
    })
    onTestFinished(() => socket.terminate())
    await once(socket, "open")
    const subscription = once(socket, "message")
    socket.send(JSON.stringify({ type: "subscribe", channel }))
    const [ready] = (await subscription) as [Buffer]
    expect(JSON.parse(String(ready))).toEqual({ type: "subscribed", channel })

    const signal = once(socket, "message")
    const created = await startThread(writerApi, author.token, path, "Private review text")
    expect(created.status).toBe(201)
    const root = first(await reviewComments(created))
    const [changed] = (await signal) as [Buffer]
    expect(JSON.parse(String(changed))).toEqual({
      type: "event",
      channel,
      event: { type: "changed", payload: null },
    })
    expect(first(await reviewComments(await request(viewerApi, viewer.token, path))).body).toBe(
      "Private review text",
    )

    await prisma.repositoryAccessGrant.delete({ where: { id: viewerGrant.id } })
    const next = Promise.race([
      once(socket, "close").then((args) => (args as [number])[0]),
      once(socket, "message").then(() => "unverified signal"),
    ])
    const replied = await request(writerApi, author.token, `${path}/${root.id}/replies`, "POST", {
      review_comment: { body: "Do not deliver after revocation" },
    })
    expect(replied.status).toBe(201)
    await expect(next).resolves.toBe(4403)
    expect((await request(viewerApi, viewer.token, path)).status).toBe(404)
  }, 15_000)
})
