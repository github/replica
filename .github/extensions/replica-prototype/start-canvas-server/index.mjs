import { createHash, randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"

import { MAX_RELOAD_ADDRESS_LENGTH } from "../agent-commands/index.mjs"
import { projectControlsStatus } from "../controls-status/index.mjs"
import { currentCanvasContext } from "../create-canvas-context/index.mjs"
import { getPrototypeState } from "../get-prototype-state/index.mjs"
import { createHubConnection } from "../create-hub-connection/index.mjs"
import { InvalidHubOrigin } from "../invalid-hub-origin/index.mjs"
import { openBrowser } from "../open-browser/index.mjs"
import { readCanvasRepository } from "../read-canvas-repository/index.mjs"
import { readPrototypeStartPage } from "../read-prototype-start-page/index.mjs"
import { refreshPrototypeStatus } from "../refresh-prototype-status/index.mjs"
import { renderCanvasHtml } from "../render-canvas-html/index.mjs"
import { requestPublish } from "../request-publish/index.mjs"
import { preparePublish } from "../prepare-publish/index.mjs"
import { createPublishPreferences } from "../publish-preferences/index.mjs"
import { samePublishTarget } from "../publish-target/index.mjs"
import { requestCommentingFix } from "../request-commenting-fix/index.mjs"
import { requestControlsDiagnosis } from "../request-controls-diagnosis/index.mjs"
import { reviewAction } from "../review-action/index.mjs"
import { createCommentStore } from "../comment-store/index.mjs"
import { createImprovementNotes } from "../improvement-notes/index.mjs"
import { createShareLinks } from "../share-links/index.mjs"
import { startPreviewProxy } from "../start-preview-proxy/index.mjs"
import { captureReviewRevision } from "../capture-review-revision/index.mjs"
import { createLocalReviewComments } from "../create-local-review-comments/index.mjs"
import { uuidInputPattern } from "../identity-patterns/index.mjs"
import { createReviewerProfile } from "../create-reviewer-profile/index.mjs"

const ASSET_PATHS = new Map([
  [
    "/avatar-placeholder.svg",
    {
      contentType: "image/svg+xml",
      fileUrl: new URL("../assets/avatar-placeholder.svg", import.meta.url),
    },
  ],
  [
    "/assets/renderer.css",
    {
      contentType: "text/css; charset=utf-8",
      fileUrl: new URL("../assets/renderer.css", import.meta.url),
    },
  ],
  ...[
    "renderer.js",
    "renderer-vendor.js",
    "renderer-rolldown-runtime.js",
    "renderer-improvement-notes-prototype.js",
    "renderer-improvement-notes-vendor.js",
    "renderer-prototype-canvas-thread-sample.js",
    "renderer-prototype-canvas-improvement-threads.js",
  ].map((name) => [
    `/assets/${name}`,
    {
      contentType: "text/javascript; charset=utf-8",
      fileUrl: new URL(`../assets/${name}`, import.meta.url),
    },
  ]),
  ...["Hubot-Sans.woff2", "MonaSansMonoVF-wght.woff2", "MonaSansVF-wdth-wght-opsz.woff2"].map(
    (name) => [
      `/assets/${name}`,
      {
        contentType: "font/woff2",
        fileUrl: new URL(`../assets/${name}`, import.meta.url),
      },
    ],
  ),
])

export async function startCanvasServer(initialContext, session, options = {}) {
  let context = initialContext
  let preview
  const publishPreferences = createPublishPreferences(options.publishPreferencesDirectory)
  const comments = createCommentStore(initialContext.sessionWorkspacePath)
  const source = await readFile(new URL("../assets/canvas-bridge.js", import.meta.url), "utf8")
  const hubConnection = createHubConnection(() => context, options.hubOptions)
  const { hubClient, refreshDiscovery, selectHubOrigin, discoveries } = hubConnection
  const improvementNotes = createImprovementNotes(() => context, session, hubClient, {
    directory: options.improvementNotesDirectory,
  })
  const localComments = createLocalReviewComments(initialContext, {
    directory: options.localCommentsDirectory,
  })
  const reviewerProfile = createReviewerProfile(initialContext)
  async function localScope(hub, status) {
    const connectionId = await hub.connectionKey(status.repository)
    if (!connectionId || connectionId !== status.reviewConnectionId)
      throw httpError(409, "The Hub connection changed. Refresh before using local comments.")
    const scope = {
      hubOrigin: hub.origin,
      repository: status.repository,
      branch: status.branch,
      viewerLogin: status.prototype?.viewerLogin || status.viewerLogin,
      connectionId,
    }
    if (!scope.viewerLogin) throw new Error("Hub did not identify the connected reviewer.")
    const identity = await readCanvasRepository(context)
    const hubHostname = new URL(hub.origin).hostname
    const local =
      identity.local &&
      identity.repository === scope.repository &&
      (hubHostname === "localhost" ||
        hubHostname === "127.0.0.1" ||
        hubHostname.endsWith(".localhost"))
    const profile = local
      ? {
          author: { login: scope.viewerLogin, name: null, avatarUrl: null },
          error: null,
        }
      : await reviewerProfile.read(scope)
    if ((await hub.connectionKey(status.repository)) !== connectionId)
      throw httpError(409, "The Hub connection changed. Refresh before using local comments.")
    return { ...scope, author: profile.author, profileError: profile.error }
  }
  async function updateMetadata({ name, description, startPage }, expectedTarget) {
    const hub = await hubClient()
    if (!hub) throw httpError(409, "Enter a Hub URL before connecting.")
    const { branch, repository } = await hub.checkout()
    if (
      expectedTarget &&
      (branch !== expectedTarget.branch || repository !== expectedTarget.repository)
    ) {
      throw httpError(409, "The checkout changed while preparing to publish. Try again.")
    }
    let start_page = startPage
    if (typeof startPage === "string" && /^https?:\/\//i.test(startPage.trim())) {
      // URL parsing removes dot segments before Hub can validate the original path.
      const rawPath = startPage
        .trim()
        .replace(/^https?:\/\/[^/?#]*/i, "")
        .replace(/[?#].*$/s, "")
      if (
        rawPath
          .replace(/%2e/gi, ".")
          .split("/")
          .some((segment) => segment === "." || segment === "..")
      )
        throw httpError(422, "Start page must not contain dot path segments.")
      let url
      try {
        url = new URL(startPage.trim())
      } catch {
        throw httpError(422, "Start page must be a valid prototype URL or route.")
      }
      if (url.origin === new URL(context.normalizedUrl).origin) {
        if (
          url.username ||
          url.password ||
          startPage.includes("\\") ||
          Array.from(startPage).some(
            (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
          )
        )
          throw httpError(422, "Start page must not contain credentials or control characters.")
        start_page = `${url.pathname}${url.search}${url.hash}`
      }
    }
    return hub.request("/api/canvas/prototype", {
      method: "PATCH",
      interactive: true,
      body: { branch, name, description, start_page },
    })
  }
  async function registerForPublish(publishContext) {
    let status
    try {
      status = await hubStatus()
    } catch (error) {
      if (!(error instanceof InvalidHubOrigin)) throw error
      return { state: "unavailable", message: error.message }
    }
    if (status.state === "undiscovered" || status.state === "connected") {
      if (
        status.repository !== publishContext.target.repository ||
        status.branch !== publishContext.target.branch
      ) {
        throw httpError(409, "The checkout changed while preparing to publish. Try again.")
      }
    }
    if (status.state === "undiscovered") return { ...status, buildNumber: 0 }
    if (status.state !== "connected") return status
    if (status.prototype.registered) {
      return {
        state: "registered",
        alreadyRegistered: true,
        buildNumber: status.prototype.build?.number ?? 0,
      }
    }
    if (!status.prototype.canRegister) {
      throw httpError(403, "This branch is not eligible for registration in Hub.")
    }

    const branchName = status.branch.split("/").at(-1).replaceAll(/[-_]+/g, " ").trim()
    const canvasName =
      context.target.branch === publishContext.target.branch &&
      publishContext.name !== new URL(publishContext.normalizedUrl).hostname
        ? publishContext.name
        : null
    const name = status.prototype.name || canvasName || branchName || status.branch
    await updateMetadata(
      {
        name,
        description: status.prototype.description ?? undefined,
      },
      { branch: status.branch, repository: status.repository },
    )
    return {
      state: "registered",
      buildNumber: status.prototype.build?.number ?? 0,
    }
  }
  async function hubStatus() {
    const hub = await hubClient()
    const { repository } = await readCanvasRepository(context)
    const discovery = discoveries.get(repository)
    let status = hub
      ? await hub.status()
      : {
          state: "unconfigured",
          repository,
          message: "Enter a Hub URL to connect.",
        }
    if (
      hub &&
      status.repositoryAuthorized &&
      status.branch &&
      status.registrationReason !== "branch_not_reviewable"
    ) {
      try {
        const connectionId = await hub.connectionKey(status.repository)
        if (!connectionId) throw httpError(401, "Connect to Hub before commenting.")
        const snapshot = await captureReviewRevision(context)
        if (snapshot.commitSha !== status.commitSha)
          throw httpError(
            409,
            "The checkout changed while preparing local comments. Refresh again.",
          )
        const scope = await localScope(hub, status)
        if (scope.connectionId !== connectionId)
          throw httpError(409, "The Hub connection changed while preparing local comments.")
        if (scope.profileError) status = { ...status, localCommentsError: scope.profileError }
        if (status.prototype?.build) {
          try {
            await localComments.sync(
              scope,
              {
                ...status.prototype.build,
                repositoryId: status.prototype.repositoryId,
                prototypeId: status.prototype.id,
              },
              hub,
            )
          } catch (error) {
            status = {
              ...status,
              localCommentsError: `Local comments not synced: ${error.message}`,
            }
          }
        }
        const published =
          snapshot.clean && status.prototype?.build?.commitSha === snapshot.commitSha
        status = {
          ...status,
          reviewRevision: {
            ...snapshot,
            id: published
              ? null
              : Number.parseInt(
                  createHash("sha256").update(snapshot.treeSha).digest("hex").slice(0, 12),
                  16,
                ) + 1,
            prototypeId: status.prototype?.id ?? null,
            repository: status.repository,
            branch: status.branch,
            buildNumber: published ? status.prototype.build.number : null,
            hubOrigin: hub.origin,
            connectionId,
          },
        }
      } catch (error) {
        status = {
          ...status,
          reviewError: `Local comments unavailable: ${error.message}`,
        }
      }
    }
    const ownsStartPage =
      status.state === "connected" &&
      (status.prototype?.startPageSet ?? status.prototype?.startPage !== undefined)
    return {
      ...status,
      ...(ownsStartPage ? {} : await readPrototypeStartPage(context.repositoryPath)),
      hubOrigin: hub?.origin,
      discovery: {
        ...discovery,
        mismatch: Boolean(hub && discovery?.state === "valid" && discovery.origin !== hub.origin),
      },
    }
  }
  const streams = new Set()
  const shareLinks = createShareLinks(hubClient, options.openBrowser || openBrowser)
  const token = randomBytes(24).toString("base64url")
  const documentToken = randomBytes(32).toString("base64url")
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== `127.0.0.1:${request.socket.localPort}`) {
        throw httpError(403, "Invalid canvas host.")
      }
      await routeRequest(
        request,
        response,
        { ...context, previewUrl: preview.url },
        session,
        token,
        documentToken,
        hubClient,
        updateMetadata,
        registerForPublish,
        selectHubOrigin,
        streams,
        options,
        hubStatus,
        refreshDiscovery,
        options.openBrowser || openBrowser,
        options.agentCommands,
        shareLinks,
        publishPreferences,
        improvementNotes,
        localComments,
        localScope,
      )
    } catch (error) {
      sendJson(
        response,
        error?.statusCode || (error?.code === "stale_comment_target" ? 409 : 500),
        {
          error: error instanceof Error ? error.message : String(error),
          ...(request.url?.startsWith("/api/hub/share-links")
            ? {
                code: error.code,
                deliveryPhase: error.deliveryPhase,
                authorization: error.authorization,
              }
            : {}),
        },
      )
    }
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    await closeServer(server)
    throw new Error("Replica prototype server did not receive a loopback port.")
  }

  const url = `http://127.0.0.1:${address.port}/?document=${documentToken}`
  function connectPreview(current) {
    return startPreviewProxy({
      prototypeUrl: current.normalizedUrl,
      parentOrigin: new URL(url).origin,
      source,
    })
  }
  let previewUpdate = Promise.resolve()
  try {
    preview = await connectPreview(context)
  } catch (error) {
    await closeServer(server)
    throw error
  }
  return {
    url,
    setContext(nextContext) {
      // Each caller receives its own failure; a failed transition must not block later retries.
      previewUpdate = previewUpdate
        .catch(() => {})
        .then(async () => {
          const upstream = new URL(nextContext.normalizedUrl)
          if (upstream.username || upstream.password)
            throw new Error("Replica preview requires an unauthenticated loopback prototype URL.")
          let previous
          if (upstream.origin !== new URL(context.normalizedUrl).origin) {
            const nextPreview = await connectPreview(nextContext)
            previous = preview
            preview = nextPreview
          }
          options.agentCommands?.close()
          context = nextContext
          hubConnection.invalidate()
          await previous?.close()
        })
      return previewUpdate
    },
    getHubStatus: hubStatus,
    reviewAction: async (action, input) => reviewAction(await hubClient(), action, input, comments),
    updateMetadata,
    improvementNotes,
    close: async () => {
      options.agentCommands?.close()
      for (const stream of streams) stream.end()
      try {
        await previewUpdate
      } finally {
        try {
          await preview.close()
        } finally {
          await closeServer(server)
        }
      }
    },
  }
}

async function routeRequest(
  request,
  response,
  context,
  session,
  token,
  documentToken,
  hubClient,
  updateMetadata,
  registerForPublish,
  selectHubOrigin,
  streams,
  options,
  hubStatus,
  refreshDiscovery,
  launchBrowser,
  agentCommands,
  shareLinks,
  publishPreferences,
  improvementNotes,
  localComments,
  localScope,
) {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1")

  if (request.method === "GET" && requestUrl.pathname === "/") {
    if (
      requestUrl.searchParams.getAll("document").length !== 1 ||
      requestUrl.searchParams.get("document") !== documentToken
    ) {
      throw httpError(403, "Invalid canvas document token.")
    }
    sendHtml(response, renderCanvasHtml(context, token, options.setupUrl))
    return
  }
  if (request.method === "GET" && ASSET_PATHS.has(requestUrl.pathname)) {
    await sendAsset(response, ASSET_PATHS.get(requestUrl.pathname))
    return
  }
  if (request.method === "GET" && requestUrl.pathname === "/api/state") {
    sendJson(response, 200, await getPrototypeState(await currentCanvasContext(context)))
    return
  }

  requireToken(request, token)
  if (requestUrl.pathname === "/api/improvement-notes/capture" && request.method === "POST") {
    sendJson(response, 200, await improvementNotes.capture())
    return
  }
  if (requestUrl.pathname === "/api/improvement-notes" && request.method === "GET") {
    sendJson(response, 200, await improvementNotes.load())
    return
  }
  if (requestUrl.pathname === "/api/improvement-notes" && request.method === "POST") {
    sendJson(response, 200, await improvementNotes.save(await readJson(request, 1_550_000)))
    return
  }
  if (
    request.method === "POST" &&
    ["/api/improvement-notes/sync", "/api/improvement-notes/fix"].includes(requestUrl.pathname)
  ) {
    const action = requestUrl.pathname.endsWith("/fix") ? "fix" : "sync"
    sendJson(response, 200, await improvementNotes[action](await readJson(request)))
    return
  }
  const sharingRoute =
    /^\/api\/hub\/share-links\/(context|list|create|delete|open|controls-preference|authorize)$/.exec(
      requestUrl.pathname,
    )
  if (sharingRoute) {
    if (request.method !== "POST") throw httpError(405, "Sharing action not supported.")
    sendJson(
      response,
      sharingRoute[1] === "create" ? 201 : 200,
      await shareLinks(sharingRoute[1], await readJson(request)),
    )
    return
  }
  if (requestUrl.pathname === "/api/controls/diagnose" && request.method === "POST") {
    sendJson(
      response,
      200,
      await requestControlsDiagnosis(
        await currentCanvasContext(context),
        session,
        await readJson(request, 16_384),
        { directory: options.controlsDiagnosisDirectory },
      ),
    )
    return
  }
  if (agentCommands && request.method === "GET" && requestUrl.pathname === "/api/agent/next") {
    const rendererUrl = request.headers["x-replica-prototype-url"]
    sendJson(response, 200, {
      prototypeUrl: context.normalizedUrl,
      command:
        rendererUrl && rendererUrl !== context.normalizedUrl
          ? null
          : agentCommands.next(request.headers["x-replica-renderer-id"]),
    })
    return
  }
  if (agentCommands && request.method === "POST" && requestUrl.pathname === "/api/agent/progress") {
    const progress = await readJson(request, 1024)
    agentCommands.progress(progress, request.headers["x-replica-renderer-id"])
    sendJson(response, 200, { received: true })
    return
  }
  if (agentCommands && request.method === "POST" && requestUrl.pathname === "/api/agent/result") {
    const result = await readJson(request, 1_048_576)
    if (!validAgentResult(result)) throw httpError(422, "Invalid agent result payload.")
    agentCommands.complete(result, request.headers["x-replica-renderer-id"])
    sendJson(response, 200, { received: true })
    return
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/prototype/open") {
    const { url: value } = await readJson(request)
    if (typeof value !== "string" || value.length > 2048) {
      throw httpError(422, "Enter a valid prototype URL.")
    }
    let target
    try {
      target = new URL(value)
    } catch {
      throw httpError(422, "Enter a valid prototype URL.")
    }
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.origin !== new URL(context.normalizedUrl).origin ||
      target.username ||
      target.password
    ) {
      throw httpError(422, "The address must stay on this prototype's origin.")
    }
    const opened = await launchBrowser(target.href)
    if (!opened.ok) throw httpError(502, opened.error || "Could not open the browser.")
    sendJson(response, 200, { opened: true })
    return
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/commenting/fix") {
    sendJson(
      response,
      200,
      await requestCommentingFix(await currentCanvasContext(context), session, {
        directory: options.commentingDirectory,
      }),
    )
    return
  }
  if (
    request.method === "GET" &&
    requestUrl.pathname === "/api/prototype/status" &&
    options.prototypeStatus
  ) {
    sendJson(response, 200, await options.prototypeStatus())
    return
  }
  if (
    request.method === "POST" &&
    ["/api/hub/open", "/api/hub/activity", "/api/hub/discovery"].includes(requestUrl.pathname)
  ) {
    await refreshDiscovery(requestUrl.pathname === "/api/hub/discovery")
    const hub = await hubClient()
    if (hub && requestUrl.pathname === "/api/hub/activity") {
      try {
        await hub.activity()
      } catch (error) {
        const status = await hubStatus()
        sendJson(response, 200, {
          ...status,
          message: `Connection activity could not be verified: ${error.message}`,
        })
        return
      }
    }
    sendJson(response, 200, await hubStatus())
    return
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/hub/origin") {
    const { origin } = await readJson(request)
    sendJson(response, 200, await selectHubOrigin(origin))
    return
  }
  const hub = requestUrl.pathname.startsWith("/api/hub/") ? await hubClient() : null

  if (request.method === "GET" && requestUrl.pathname === "/api/hub/status") {
    sendJson(response, 200, await hubStatus())
    return
  }
  if (requestUrl.pathname.startsWith("/api/hub/") && !hub) {
    throw httpError(409, "Enter a Hub URL before connecting.")
  }
  if (
    request.method === "POST" &&
    ["/api/hub/pair", "/api/hub/connect"].includes(requestUrl.pathname)
  ) {
    const pairing = await hub.pair()
    let browserError
    if (requestUrl.pathname === "/api/hub/connect") {
      try {
        const result = await launchBrowser(pairing.verificationUrl)
        if (!result.ok) browserError = result.error
      } catch (error) {
        browserError = error instanceof Error ? error.message : String(error)
      }
    }
    sendJson(response, 201, {
      ...pairing,
      ...(browserError ? { browserError } : {}),
    })
    return
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/hub/poll") {
    sendJson(response, 200, await hub.poll())
    return
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/hub/disconnect") {
    await hub.disconnect()
    sendJson(response, 200, { state: "disconnected" })
    return
  }
  if (request.method === "PATCH" && requestUrl.pathname === "/api/hub/metadata") {
    sendJson(response, 200, await updateMetadata(await readJson(request)))
    return
  }
  if (requestUrl.pathname === "/api/hub/comments" && request.method === "GET") {
    const status = await hub.status()
    if (!status.repositoryAuthorized) throw httpError(403, "Connect to Hub before commenting.")
    const scope = await localScope(hub, status)
    const collection = status.prototype
      ? await hub.request(await reviewPath(hub))
      : { comments: [], hasMore: false, nextCursor: null }
    const revision = requestUrl.searchParams.get("local_revision_id")
    const drafts = (await localComments.list(scope)).filter(
      (comment) => !revision || comment.draftRevisionId === Number(revision),
    )
    sendJson(response, 200, {
      ...collection,
      comments: [...collection.comments, ...drafts],
    })
    return
  }
  if (requestUrl.pathname === "/api/hub/mention-candidates" && request.method === "GET") {
    const base = await reviewPath(hub)
    const expected = `/api/canvas/repositories/${requestUrl.searchParams.get("repositoryId")}/prototypes/${requestUrl.searchParams.get("prototypeId")}/review_comments`
    if (base !== expected)
      throw httpError(409, "The Hub prototype changed. Refresh before mentioning someone.")
    sendJson(
      response,
      200,
      await hub.request(base.replace(/\/review_comments$/, "/mention_candidates")),
    )
    return
  }
  if (requestUrl.pathname === "/api/hub/comments" && request.method === "POST") {
    const body = await readJson(request, 32_768)
    const expected = body.review_revision
    const status = await hub.status()
    if (
      !expected ||
      expected.hubOrigin !== hub.origin ||
      typeof expected.connectionId !== "string" ||
      !expected.connectionId ||
      !status.repositoryAuthorized ||
      (status.prototype?.id ?? null) !== expected.prototypeId ||
      status.repository !== expected.repository ||
      status.branch !== expected.branch ||
      expected.connectionId !== (await hub.connectionKey(status.repository))
    )
      throw httpError(
        409,
        "The Hub review target changed. Select a target again before commenting.",
      )
    const attributes = {
      body: body.review_comment?.body,
      anchor: body.review_comment?.anchor,
    }
    if (expected.id === null) {
      if (!Number.isSafeInteger(expected.buildNumber) || expected.buildNumber < 1)
        throw httpError(400, "Select a valid published Build before commenting.")
      attributes.build_number = expected.buildNumber
    } else {
      if (!Number.isSafeInteger(expected.id) || expected.id < 1)
        throw httpError(400, "Select a valid local revision before commenting.")
      const scope = await localScope(hub, status)
      if (scope.connectionId !== expected.connectionId)
        throw httpError(409, "The Hub connection changed. Select a target again.")
      const comment = await localComments.create(scope, expected, attributes)
      sendJson(response, 201, { comments: [comment] })
      return
    }
    const base = `/api/canvas/repositories/${status.prototype.repositoryId}/prototypes/${status.prototype.id}/review_comments`
    sendJson(
      response,
      201,
      await hub.request(base, {
        method: "POST",
        interactive: true,
        expectedTarget: status,
        connectionScope: { identity: expected.connectionId },
        body: { review_comment: attributes },
      }),
    )
    return
  }
  if (requestUrl.pathname === "/api/hub/events" && request.method === "GET") {
    const socket = await hub.subscribe(
      () => {
        if (!response.writableEnded) response.write("event: comments\ndata: {}\n\n")
      },
      (error) => {
        if (response.writableEnded) return
        response.write(`event: error\ndata: ${JSON.stringify(error.message)}\n\n`)
        response.end()
      },
    )
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    })
    response.write(": connected\n\n")
    streams.add(response)
    const heartbeat = setInterval(() => {
      if (!response.writableEnded) response.write(": keepalive\n\n")
    }, 25_000)
    response.on("close", () => {
      streams.delete(response)
      clearInterval(heartbeat)
      socket.close()
    })
    return
  }
  const commentRoute =
    /^\/api\/hub\/comments\/(\d+)(?:\/(replies|resolution|read|reactions)(?:\/(%2B1|\+1|-1|laugh|hooray|confused|heart|rocket|eyes))?)?$/i.exec(
      requestUrl.pathname,
    )
  if (commentRoute) {
    const [, id, operation, content] = commentRoute
    const method = request.method
    const valid = !operation
      ? ["PATCH", "DELETE"].includes(method)
      : operation === "replies"
        ? method === "POST" && !content
        : operation === "resolution" || operation === "read"
          ? ["POST", "DELETE"].includes(method) && !content
          : (method === "POST" && !content) || (method === "DELETE" && !!content)
    if (!valid) throw httpError(405, "Review action not supported.")
    const body =
      (!operation && method === "PATCH") ||
      operation === "replies" ||
      (operation === "read" && method === "POST") ||
      operation === "reactions"
        ? await readJson(request)
        : undefined
    const status = await hub.status()
    if (!status.repositoryAuthorized) throw httpError(403, "Connect to Hub before commenting.")
    const scope = await localScope(hub, status)
    if ((await localComments.list(scope)).some((comment) => comment.id === Number(id))) {
      if (operation === "read" && method === "POST") {
        sendJson(response, 200, {})
        return
      }
      if (operation) throw httpError(409, "Publish this comment before starting a conversation.")
      const comment =
        method === "PATCH"
          ? await localComments.update(scope, id, body?.review_comment?.body)
          : await localComments.remove(scope, id)
      sendJson(response, 200, { comments: [comment] })
      return
    }
    const suffix = operation ? `/${operation}${content ? `/${content}` : ""}` : ""
    sendJson(
      response,
      200,
      await hub.request(`${await reviewPath(hub)}/${id}${suffix}`, {
        method,
        body,
        interactive: operation !== "read" || method === "DELETE",
      }),
    )
    return
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/refresh") {
    sendJson(response, 200, await refreshPrototypeStatus(await currentCanvasContext(context)))
    return
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/publish") {
    const input = await readJson(request, 16_384, { allowEmpty: true })
    const publishContext = await currentCanvasContext(context)
    const preparation = await preparePublish(publishContext, publishPreferences)
    if (input.target && !samePublishTarget(input.target, preparation.target))
      throw httpError(409, "The checkout changed while preparing to publish. Try again.")
    if (
      input.workingTree !== undefined &&
      !["clean", "changed", "unavailable"].includes(input.workingTree)
    )
      throw httpError(422, "Invalid working tree state.")
    if (preparation.workingTree === "unavailable" && input.mode !== "committed-only")
      throw httpError(
        409,
        `Could not check local changes. Retry the check or choose Publish committed version only. ${preparation.workingTreeError}`,
      )
    if (input.workingTree === "clean" && preparation.workingTree === "changed")
      throw httpError(409, "Uncommitted changes appeared while preparing to publish. Try again.")
    const mode =
      input.mode ??
      (preparation.workingTree === "changed" && preparation.remember
        ? "commit-changes"
        : preparation.workingTree === "clean"
          ? "committed-only"
          : null)
    if (!mode)
      throw httpError(409, "Uncommitted changes exist. Choose how to publish before continuing.")
    if (!["commit-changes", "committed-only"].includes(mode))
      throw httpError(422, "Choose a supported publishing mode.")
    if (input.remember !== undefined && typeof input.remember !== "boolean")
      throw httpError(422, "Invalid publishing preference.")
    if (input.remember === true && mode !== "commit-changes")
      throw httpError(422, "Only Commit changes & publish can be remembered.")
    sendJson(
      response,
      202,
      await requestPublish(publishContext, session, {
        prepareRegistration: () => registerForPublish(publishContext),
        instanceId: options.instanceId,
        mode,
        expectedTarget: preparation.target,
        savePreference:
          input.remember !== undefined
            ? (target) => publishPreferences.write(target, input.remember)
            : undefined,
      }),
    )
    return
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/publish/prepare") {
    sendJson(
      response,
      200,
      await preparePublish(await currentCanvasContext(context), publishPreferences),
    )
    return
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/publish/preference") {
    const input = await readJson(request)
    const preparation = await preparePublish(
      await currentCanvasContext(context),
      publishPreferences,
    )
    if (!input.target || !samePublishTarget(input.target, preparation.target))
      throw httpError(409, "The checkout changed. Refresh Settings and try again.")
    await publishPreferences.write(preparation.target, input.remember)
    sendJson(response, 200, { remember: input.remember })
    return
  }

  sendJson(response, 404, { error: "Not found." })
}

function requireToken(request, token) {
  if (request.headers["x-replica-canvas-token"] !== token) {
    throw httpError(403, "Invalid canvas request token.")
  }
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": [
      "default-src 'none'",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "img-src 'self' data: https://avatars.githubusercontent.com",
      "frame-src http: https:",
      "font-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; "),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  })
  response.end(html)
}

async function sendAsset(response, asset) {
  const body = await readFile(asset.fileUrl)
  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Type": asset.contentType,
    "X-Content-Type-Options": "nosniff",
  })
  response.end(body)
}

function sendJson(response, statusCode, body) {
  if (response.headersSent) {
    return
  }

  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  })
  response.end(`${JSON.stringify(body)}\n`)
}

function httpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function hasKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  )
}

function boundedString(value, limit) {
  return typeof value === "string" && value.length <= limit
}

function validRoute(route) {
  return (
    hasKeys(route, ["pathname", "search", "hash"]) &&
    boundedString(route.pathname, 2048) &&
    boundedString(route.search, 2048) &&
    boundedString(route.hash, 1024)
  )
}

function validAgentResult(result) {
  if (!boundedString(result.id, 36) || !uuidInputPattern.test(result.id)) return false
  if (result.ok === false)
    return (
      hasKeys(result, ["id", "ok", "error"]) &&
      boundedString(result.error, 2048) &&
      result.error.length > 0
    )
  if (result.ok !== true || !hasKeys(result, ["id", "ok", "value"])) return false
  const value = result.value
  if (
    hasKeys(value, ["status", "url", "error", "controls"]) ||
    hasKeys(value, ["status", "url", "error", "controls", "runtime"])
  ) {
    try {
      projectControlsStatus(value)
      return true
    } catch {
      return false
    }
  }
  if (hasKeys(value, ["clicked", "route"])) return value.clicked === true && validRoute(value.route)
  if (hasKeys(value, ["reloaded", "address"]))
    return value.reloaded === true && boundedString(value.address, MAX_RELOAD_ADDRESS_LENGTH)
  return (
    hasKeys(value, [
      "address",
      "addressDraft",
      "appearance",
      "canGoBack",
      "canGoForward",
      "historyIndex",
      "historyLength",
      "route",
    ]) &&
    boundedString(value.address, 2048) &&
    boundedString(value.addressDraft, 2048) &&
    ["light", "dark"].includes(value.appearance) &&
    typeof value.canGoBack === "boolean" &&
    typeof value.canGoForward === "boolean" &&
    Number.isSafeInteger(value.historyIndex) &&
    Number.isSafeInteger(value.historyLength) &&
    (value.route === null || validRoute(value.route))
  )
}

async function reviewPath(hub) {
  const status = await hub.status()
  if (status.state !== "connected") throw httpError(409, "Connect to a discovered Hub prototype.")
  return `/api/canvas/repositories/${status.prototype.repositoryId}/prototypes/${status.prototype.id}/review_comments`
}

async function readJson(request, limit = 16_384, { allowEmpty = false } = {}) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > limit) throw httpError(413, "Canvas request is too large.")
    chunks.push(chunk)
  }
  if (bytes === 0 && allowEmpty) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
  } catch {
    // Report malformed JSON as an invalid request.
  }
  throw httpError(400, "Invalid canvas JSON.")
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
