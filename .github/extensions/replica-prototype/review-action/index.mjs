import { randomUUID } from "node:crypto"

import { uuidInputPattern as UUID } from "../identity-patterns/index.mjs"
import { checkThread, validMessageBody } from "../improvement-note-thread/index.mjs"

const THREAD_LIMIT = 10
const REPLY_LIMIT = 10
const RESPONSE_MAXIMUM_BYTES = 64 * 1024
const REVIEW_CONTENT_TRUST = Object.freeze({
  source: "hub_review_comments",
  untrusted: true,
  treatAs: "data",
  appliesTo: "comment bodies, anchors and user-controlled display metadata",
})

function fail(code, message, statusCode) {
  throw Object.assign(new Error(message), { code, statusCode })
}

function invalid() {
  fail("invalid_comment_request", "Invalid comment input or Hub response.", 400)
}

function positive(value) {
  return Number.isSafeInteger(value) && value > 0
}

function noteId(value) {
  return (
    typeof value === "string" &&
    /^improvement_note-[1-9]\d*$/.test(value) &&
    positive(Number(value.slice("improvement_note-".length)))
  )
}

function text(value, bytes, nullable = false) {
  if (nullable && value === null) return value
  if (typeof value !== "string" || Buffer.byteLength(value) > bytes) invalid()
  return value
}

function date(value, nullable = false) {
  if (nullable && value === null) return null
  text(value, 40)
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    invalid()
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  if (day.toISOString().slice(0, 10) !== value.slice(0, 10)) invalid()
  return value
}

function instant(value) {
  const fraction = value.match(/\.(\d+)(?=Z|[+-])/)?.[1] ?? ""
  return BigInt(Date.parse(value.replace(/\.\d+/, ""))) * 1000n + BigInt(fraction.padEnd(6, "0"))
}

function chronological(left, right) {
  const a = instant(left.createdAt)
  const b = instant(right.createdAt)
  if (a !== b) return a < b ? -1 : 1
  const leftId =
    typeof left.id === "number" ? left.id : Number(left.id.slice("improvement_note-".length))
  const rightId =
    typeof right.id === "number" ? right.id : Number(right.id.slice("improvement_note-".length))
  return leftId - rightId || left.kind.localeCompare(right.kind, "en")
}

function author(value) {
  if (!value || typeof value !== "object") invalid()
  return {
    login: text(value.login, 256),
    name: text(value.name, 1024, true),
    avatarUrl: text(value.avatarUrl, 2048, true),
  }
}

function message(value, repositoryScope = false) {
  if (!value || !positive(value.id) || !["root", "reply", "improvement_note"].includes(value.kind))
    invalid()
  const improvement = value.kind === "improvement_note"
  const deletedAt = date(value.deletedAt, true)
  const body = text(value.body, 10000, deletedAt !== null)
  if (deletedAt && body !== null) invalid()
  const result = {
    id: improvement ? `improvement_note-${value.id}` : value.id,
    kind: value.kind,
    body,
    author: author(value.author),
    createdAt: date(value.createdAt),
    updatedAt: date(value.updatedAt),
    ...(!improvement ? { editedAt: date(value.editedAt, true) } : {}),
    deletedAt,
  }
  if (repositoryScope) {
    if (!value.prototype || !positive(value.prototype.id)) invalid()
    result.prototype = {
      id: value.prototype.id,
      name: text(value.prototype.name, 1024, true),
      branch: text(value.prototype.branch, 1024),
    }
    if (!result.prototype.branch) invalid()
  }
  if (value.kind === "reply") {
    if (!positive(value.rootId)) invalid()
    return { ...result, rootId: value.rootId }
  }
  if (
    !positive(value.buildNumber) ||
    !value.anchor ||
    typeof value.anchor !== "object" ||
    Array.isArray(value.anchor) ||
    Buffer.byteLength(JSON.stringify(value.anchor)) > 16384
  )
    invalid()
  if (improvement) {
    if (
      !UUID.test(value.localId ?? "") ||
      !positive(value.revision) ||
      !["open", "sent", "ready", "blocked", "resolved"].includes(value.status) ||
      (deletedAt ? value.thread !== null : !validMessageBody(body, "author"))
    )
      invalid()
    if (!deletedAt) {
      try {
        checkThread(value.thread, value.localId)
      } catch (error) {
        if (error.statusCode !== 422) throw error
        invalid()
      }
    }
    return {
      ...result,
      localId: value.localId,
      revision: value.revision,
      status: value.status,
      buildNumber: value.buildNumber,
      anchor: value.anchor,
      thread: value.thread,
    }
  }
  if (
    !positive(value.activityVersion) ||
    !(value.viewerLastSeenActivityVersion === null || positive(value.viewerLastSeenActivityVersion))
  )
    invalid()
  return {
    ...result,
    buildNumber: value.buildNumber,
    anchor: value.anchor,
    resolvedAt: date(value.resolvedAt, true),
    resolvedBy: value.resolvedBy === null ? null : author(value.resolvedBy),
    activityVersion: value.activityVersion,
    viewerLastSeenActivityVersion: value.viewerLastSeenActivityVersion,
    unread: value.activityVersion > (value.viewerLastSeenActivityVersion ?? 0),
  }
}

async function completeComments(hub, base, options) {
  const collection = await hub.request(base, options)
  if (
    !Array.isArray(collection?.comments) ||
    collection.hasMore !== false ||
    collection.nextCursor !== null
  )
    invalid()
  return collection.comments
}

function directContinuation(page, records, pageSize) {
  if (
    !page ||
    !Array.isArray(records) ||
    records.length > pageSize ||
    typeof page.hasMore !== "boolean" ||
    (page.hasMore
      ? typeof page.nextCursor !== "string" || !page.nextCursor || records.length === 0
      : page.nextCursor !== null)
  )
    invalid()
  return page.nextCursor === null ? null : text(page.nextCursor, 4096)
}

function compactContext(value) {
  if (!value || !["element", "area"].includes(value.kind) || !value.route) invalid()
  const route = {
    pathname: text(value.route.pathname, 2048),
    search: text(value.route.search, 2048),
    hash: text(value.route.hash, 1024),
  }
  if (!route.pathname.startsWith("/")) invalid()
  if (value.kind === "element")
    return {
      kind: value.kind,
      route,
      accessibleName: text(value.accessibleName, 1000),
      tagName: text(value.tagName, 64),
      selectedText: text(value.selectedText, 2000),
    }
  if (!Array.isArray(value.elements) || value.elements.length > 8) invalid()
  return {
    kind: value.kind,
    route,
    elements: value.elements.map((element) => {
      if (!element || typeof element !== "object" || Array.isArray(element)) invalid()
      return {
        accessibleName: text(element.accessibleName, 1000),
        tagName: text(element.tagName, 64),
        role: text(element.role, 64),
        textExcerpt: text(element.textExcerpt, 500),
      }
    }),
  }
}

function summary(value) {
  if (
    !value ||
    !positive(value.id) ||
    !positive(value.buildNumber) ||
    !Number.isSafeInteger(value.replyCount) ||
    value.replyCount < 0 ||
    !value.prototype ||
    !positive(value.prototype.id) ||
    !value.targetContext ||
    typeof value.targetContext !== "object" ||
    Array.isArray(value.targetContext) ||
    Buffer.byteLength(JSON.stringify(value.targetContext)) > 16384
  )
    invalid()
  const screenshotReference = text(value.screenshotReference, 2048, true)
  if (
    screenshotReference !== null &&
    (!screenshotReference.startsWith("/") || screenshotReference.startsWith("//"))
  )
    invalid()
  return {
    id: value.id,
    body: text(value.body, 10000),
    authorLogin: text(value.authorLogin, 256),
    createdAt: date(value.createdAt),
    editedAt: date(value.editedAt, true),
    prototype: {
      id: value.prototype.id,
      name: text(value.prototype.name, 1024, true),
      branch: text(value.prototype.branch, 1024),
    },
    buildNumber: value.buildNumber,
    buildPath: text(value.buildPath, 2048),
    resolvedAt: date(value.resolvedAt, true),
    replyCount: value.replyCount,
    targetContext: compactContext(value.targetContext),
    screenshotReference,
  }
}

function filters(input, improvements = false) {
  const result = {
    resolution: input.resolution ?? "all",
    read: input.read ?? "all",
    from: input.from ?? null,
    to: input.to ?? null,
    ...(improvements
      ? {
          improvementNotes:
            input.improvementNotes === undefined ? "exclude" : input.improvementNotes,
        }
      : {}),
  }
  if (
    !["all", "unresolved", "resolved"].includes(result.resolution) ||
    !["all", "unread", "read"].includes(result.read) ||
    (improvements && !["exclude", "include", "only"].includes(result.improvementNotes))
  )
    invalid()
  for (const key of ["from", "to"]) {
    if (result[key] !== null) {
      const value = result[key]
      if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      )
        invalid()
      date(value)
      const fraction = value.match(/\.(\d+)(?=Z|[+-])/)?.[1] ?? ""
      result[key] = `${new Date(value).toISOString().slice(0, 19)}.${fraction.padEnd(6, "0")}Z`
    }
  }
  if (result.from && result.to && instant(result.from) >= instant(result.to)) invalid()
  return result
}

function sameTarget(left, right) {
  return (
    left &&
    typeof left === "object" &&
    !Array.isArray(left) &&
    Object.keys(left).length === Object.keys(right).length &&
    Object.entries(right).every(([key, value]) => left[key] === value)
  )
}

function cursor(value) {
  text(value, 4096)
  const [id, kind, first, second, ...extra] = value.split(":")
  if (!UUID.test(id) || extra.length || !["scan", "list", "reply"].includes(kind)) invalid()
  if (kind === "scan") {
    if (first !== undefined || second !== undefined) invalid()
    return { id, kind }
  }
  if (
    !noteId(first) &&
    (!/^(0|[1-9]\d*)$/.test(first ?? "") || !Number.isSafeInteger(Number(first)))
  )
    invalid()
  if (kind === "list") {
    if (second !== undefined || noteId(first)) invalid()
    return { id, kind, offset: Number(first) }
  }
  if (
    !(positive(Number(first)) || noteId(first)) ||
    !/^(0|[1-9]\d*)$/.test(second ?? "") ||
    !Number.isSafeInteger(Number(second))
  )
    invalid()
  return { id, kind, threadId: noteId(first) ? first : Number(first), offset: Number(second) }
}

function activity(root) {
  if (root.kind !== "improvement_note") return root.activityVersion
  const note = { ...root }
  delete note.prototype
  return JSON.stringify(note)
}

function commentsRoute(base, improvementNotes = "exclude") {
  return improvementNotes === "exclude" ? base : `${base}?improvement_notes=${improvementNotes}`
}

async function snapshot(store, id, target) {
  if (!UUID.test(id)) invalid()
  const value = await store.read(`snapshot-${id}.json`)
  if (
    !value ||
    value.scanVersion !== 2 ||
    value.id !== id ||
    !sameTarget(value.target, target) ||
    !Array.isArray(value.comments) ||
    typeof value.complete !== "boolean"
  )
    fail("comment_snapshot_expired", "Retrieve comments again to start a new snapshot.", 409)
  return value
}

async function scan(hub, store, value, base, options) {
  if (value.complete) return
  const repositoryScope = value.target.scope === "repository"
  const first = (await completeComments(hub, base, options)).map((record) =>
    message(record, repositoryScope),
  )
  const versions = new Map(
    first.filter((item) => item.kind !== "reply").map((root) => [root.id, activity(root)]),
  )
  // A second read checks that collected messages belong to unchanged root versions.
  const comments = (await completeComments(hub, base, options)).map((record) =>
    message(record, repositoryScope),
  )
  const roots = new Map(
    comments.filter((item) => item.kind !== "reply").map((root) => [root.id, root]),
  )
  if (
    roots.size !== versions.size ||
    [...roots.values()].some((root) => versions.get(root.id) !== activity(root))
  )
    fail("comment_conflict", "Threads changed during collection. Retrieve comments again.", 409)
  const ids = new Set()
  for (const record of comments) {
    if (
      ids.has(record.id) ||
      (record.kind === "reply" &&
        (!roots.has(record.rootId) ||
          (repositoryScope && roots.get(record.rootId).prototype.id !== record.prototype.id)))
    )
      fail(
        "comment_conflict",
        "Conversations changed during collection. Retrieve comments again.",
        409,
      )
    ids.add(record.id)
  }
  value.comments = comments
  value.complete = true
  await store.write(`snapshot-${value.id}.json`, value)
}

function replies(value, threadId) {
  if (noteId(threadId))
    return value.comments.find((item) => item.id === threadId)?.thread?.messages ?? []
  return value.comments
    .filter((item) => item.kind === "reply" && item.rootId === threadId)
    .sort(chronological)
}

function fitsResponse(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8") <= RESPONSE_MAXIMUM_BYTES
}

function boundedResponse(value) {
  if (!fitsResponse(value))
    fail(
      "comment_response_limit",
      "The comment response cannot fit within 64 KiB without losing content.",
      413,
    )
  return value
}

function thread(value, root, offset, all, count, replyRequestId) {
  if (offset > all.length) invalid()
  const hasMore = offset + count < all.length
  return {
    ...root,
    ...(root.kind === "improvement_note"
      ? {
          thread:
            root.thread === null
              ? null
              : { ...root.thread, messages: all.slice(offset, offset + count) },
        }
      : { replies: all.slice(offset, offset + count) }),
    threadComplete: offset === 0 && !hasMore,
    repliesHasMore: hasMore,
    repliesNextCursor: hasMore ? `${value.id}:reply:${root.id}:${offset + count}` : null,
    ...(replyRequestId ? { replyRequestId } : {}),
  }
}

function boundedThread(value, root, offset, all, envelope) {
  if (offset > all.length) invalid()
  const replyRequestId =
    value.target.scope === "repository" || root.kind === "improvement_note"
      ? undefined
      : randomUUID()
  const maximum = Math.min(REPLY_LIMIT, all.length - offset)
  // A reply continuation must consume a message, never return its own cursor unchanged.
  const minimum = maximum === 0 ? 0 : 1
  for (let count = maximum; count >= minimum; count--) {
    const result = envelope(thread(value, root, offset, all, count, replyRequestId))
    if (fitsResponse(result)) return result
  }
  fail(
    "comment_response_limit",
    "The thread root and next reply cannot fit within 64 KiB without losing content.",
    413,
  )
}

function list(value, offset = 0) {
  const grouped = new Map()
  for (const item of value.comments) {
    if (item.kind !== "reply") continue
    if (!grouped.has(item.rootId)) grouped.set(item.rootId, [])
    grouped.get(item.rootId).push(item)
  }
  for (const records of grouped.values()) records.sort(chronological)
  const roots = value.comments
    .filter((item) => {
      if (item.kind === "reply") return false
      const filter = value.filters
      const improvement = item.kind === "improvement_note"
      if (
        (improvement && filter.improvementNotes === "exclude") ||
        (!improvement && filter.improvementNotes === "only")
      )
        return false
      const resolved = improvement ? item.status === "resolved" : !!item.resolvedAt
      if (filter.resolution !== "all" && (filter.resolution === "resolved") !== resolved)
        return false
      if (improvement && filter.read !== "all") return false
      if (filter.read !== "all" && (filter.read === "unread") !== item.unread) return false
      if (filter.from || filter.to) {
        const from = filter.from ? instant(filter.from) : null
        const to = filter.to ? instant(filter.to) : null
        if (
          ![item, ...(grouped.get(item.id) ?? [])].some((record) => {
            const created = instant(record.createdAt)
            return (from === null || created >= from) && (to === null || created < to)
          })
        )
          return false
      }
      return true
    })
    .sort((a, b) => chronological(b, a))
  if (offset > roots.length) invalid()
  function envelope(threads) {
    const consumed = offset + threads.length
    const hasMore = consumed < roots.length
    return {
      contentTrust: REVIEW_CONTENT_TRUST,
      target: value.target,
      snapshotId: value.id,
      capturedAt: value.capturedAt,
      scanComplete: true,
      threads,
      hasMore,
      nextCursor: hasMore ? `${value.id}:list:${consumed}` : null,
    }
  }
  const threads = []
  for (const root of roots.slice(offset, offset + THREAD_LIMIT)) {
    const all =
      root.kind === "improvement_note"
        ? (root.thread?.messages ?? [])
        : (grouped.get(root.id) ?? [])
    const replyRequestId =
      value.target.scope === "repository" || root.kind === "improvement_note"
        ? undefined
        : randomUUID()
    const candidate = thread(value, root, 0, all, Math.min(REPLY_LIMIT, all.length), replyRequestId)
    if (fitsResponse(envelope([...threads, candidate]))) {
      threads.push(candidate)
    } else {
      if (threads.length) break
      return boundedThread(value, root, 0, all, (item) => envelope([item]))
    }
  }
  return boundedResponse(envelope(threads))
}

async function freshRoot(hub, base, threadId, options) {
  const comments = await completeComments(
    hub,
    commentsRoute(base, noteId(threadId) ? "only" : "exclude"),
    options,
  )
  const root = comments.find((item) =>
    noteId(threadId)
      ? item.kind === "improvement_note" && `improvement_note-${item.id}` === threadId
      : item.kind === "root" && item.id === threadId,
  )
  if (root) return message(root)

  fail("comments_not_found", "The thread no longer exists in this prototype.", 404)
}

export async function reviewAction(hub, action, input = {}, store) {
  if (!hub) fail("hub_disconnected", "Connect to Hub first.", 401)
  if (!store) throw new Error("Comment actions require private session storage.")
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid()
  const allowed = {
    list_comments: ["resolution", "read", "from", "to", "improvementNotes", "cursor", "target"],
    list_repository_comments: [
      "resolution",
      "read",
      "from",
      "to",
      "improvementNotes",
      "cursor",
      "target",
    ],
    get_comment_thread: ["target", "threadId", "snapshotId", "cursor"],
    get_repository_comment_thread: ["target", "threadId", "snapshotId", "cursor"],
    list_repository_comment_summaries: ["resolution", "from", "to", "pageSize", "cursor", "target"],
    get_repository_thread: ["target", "prototypeId", "threadId", "pageSize", "cursor"],
    mark_comment_read: ["target", "threadId", "activityVersion"],
    reply_to_comment: ["target", "threadId", "body", "requestId"],
    resolve_comment: ["target", "threadId", "activityVersion"],
  }[action]
  if (!allowed || Object.keys(input).some((key) => !allowed.includes(key))) invalid()
  const repositoryScope = [
    "list_repository_comments",
    "get_repository_comment_thread",
    "list_repository_comment_summaries",
    "get_repository_thread",
  ].includes(action)
  const compactListing = action === "list_repository_comment_summaries"
  const directThread = action === "get_repository_thread"
  const direct = compactListing || directThread
  const listing = [
    "list_comments",
    "list_repository_comments",
    "list_repository_comment_summaries",
  ].includes(action)
  const readingThread = ["get_comment_thread", "get_repository_comment_thread"].includes(action)
  if (input.target && (input.target.scope === "repository") !== repositoryScope) invalid()
  if (
    !listing &&
    (!(positive(input.threadId) || (readingThread && noteId(input.threadId))) || !input.target)
  )
    invalid()
  if (directThread && !positive(input.prototypeId)) invalid()
  const pageSize = input.pageSize ?? 200
  if (direct && (!positive(pageSize) || pageSize > 200)) invalid()
  if (direct && input.cursor !== undefined && !text(input.cursor, 4096)) invalid()
  if (["mark_comment_read", "resolve_comment"].includes(action) && !positive(input.activityVersion))
    invalid()
  if (readingThread && !UUID.test(input.snapshotId ?? "")) invalid()
  if (
    action === "reply_to_comment" &&
    (!text(input.body, 10000).trim() || !UUID.test(input.requestId ?? ""))
  )
    invalid()
  const filter = listing ? filters(input, !direct) : null
  const position = !direct && input.cursor !== undefined ? cursor(input.cursor) : null
  if (input.cursor !== undefined && !input.target) invalid()
  const checkout = await hub.checkout()
  if (!checkout.repository || !checkout.branch) invalid()
  if (
    input.target &&
    (input.target.hubOrigin !== hub.origin ||
      input.target.repository !== checkout.repository ||
      input.target.branch !== checkout.branch)
  )
    fail("stale_comment_target", "Checkout changed. Retrieve comments again.")
  const options = { expectedTarget: checkout, connectionScope: {} }
  const identity = await hub.request(
    repositoryScope
      ? "/api/canvas/connection"
      : `/api/canvas/prototype?branch=${encodeURIComponent(checkout.branch)}`,
    options,
  )
  if (
    !positive(identity.repositoryId) ||
    identity.repository?.toLowerCase() !== checkout.repository.toLowerCase() ||
    (!repositoryScope && (!positive(identity.id) || identity.branch !== checkout.branch))
  )
    invalid()
  const target = {
    hubOrigin: hub.origin,
    repository: checkout.repository,
    branch: checkout.branch,
    repositoryId: identity.repositoryId,
    ...(repositoryScope ? { scope: "repository" } : { prototypeId: identity.id }),
    viewerLogin: text(identity.viewerLogin, 256),
  }
  if (input.target && !sameTarget(input.target, target))
    fail("stale_comment_target", "Hub identity changed. Retrieve comments again.")
  if (direct) {
    const query = new URLSearchParams({ pageSize: String(pageSize) })
    if (input.cursor !== undefined) query.set("cursor", input.cursor)
    if (compactListing) {
      query.set("resolution", filter.resolution)
      if (filter.from) query.set("from", filter.from)
      if (filter.to) query.set("to", filter.to)
    }
    const route = compactListing
      ? `/api/canvas/repositories/${target.repositoryId}/review_comment_summaries`
      : `/api/canvas/repositories/${target.repositoryId}/prototypes/${input.prototypeId}/review_comments/${input.threadId}/thread`
    const page = await hub.request(`${route}?${query}`, options)
    const nextCursor = directContinuation(
      page,
      compactListing ? page?.comments : page?.replies,
      pageSize,
    )
    if (nextCursor && nextCursor === input.cursor) invalid()
    const envelope = {
      contentTrust: REVIEW_CONTENT_TRUST,
      target,
      capturedAt: new Date().toISOString(),
      hasMore: page.hasMore,
      nextCursor,
    }
    if (compactListing) {
      const comments = page.comments.map(summary)
      if (new Set(comments.map(({ id }) => id)).size !== comments.length) invalid()
      return boundedResponse({ ...envelope, comments })
    }
    const root = message(page.root, true)
    if (
      root.kind !== "root" ||
      root.id !== input.threadId ||
      root.prototype.id !== input.prototypeId ||
      !Number.isSafeInteger(page.replyCount) ||
      page.replyCount < page.replies.length
    )
      invalid()
    const records = page.replies.map((record) => {
      const reply = message(record)
      if (reply.kind !== "reply" || reply.rootId !== root.id) invalid()
      return reply
    })
    if (new Set(records.map(({ id }) => id)).size !== records.length) invalid()
    return boundedResponse({
      ...envelope,
      thread: { ...root, replyCount: page.replyCount, replies: records },
    })
  }
  const base = repositoryScope
    ? `/api/canvas/repositories/${target.repositoryId}/review_comments`
    : `/api/canvas/repositories/${target.repositoryId}/prototypes/${target.prototypeId}/review_comments`
  if (listing) {
    if (position && !["scan", "list"].includes(position.kind)) invalid()
    const id = position?.id ?? randomUUID()
    return store.lock(`snapshot-${id}.json`, async () => {
      const value = position
        ? await snapshot(store, id, target)
        : {
            id,
            scanVersion: 2,
            target,
            filters: filter,
            capturedAt: new Date().toISOString(),
            comments: [],
            complete: false,
          }
      const savedFilters = { improvementNotes: "exclude", ...value.filters }
      if (Object.entries(filter).some(([key, entry]) => savedFilters[key] !== entry)) invalid()
      if (position?.kind === "list" && !value.complete) invalid()
      await scan(hub, store, value, commentsRoute(base, filter.improvementNotes), options)
      return list(value, position?.kind === "list" ? position.offset : 0)
    })
  }
  if (readingThread) {
    if (
      position &&
      (position.kind !== "reply" ||
        position.id !== input.snapshotId ||
        position.threadId !== input.threadId)
    )
      invalid()
    const value = await snapshot(store, input.snapshotId, target)
    if (!value.complete) invalid()
    const root = value.comments.find((item) => item.kind !== "reply" && item.id === input.threadId)
    if (!root) fail("comments_not_found", "Thread not present in this snapshot.", 404)
    const threadBase = repositoryScope
      ? `/api/canvas/repositories/${target.repositoryId}/prototypes/${root.prototype.id}/review_comments`
      : base
    const current = await freshRoot(hub, threadBase, input.threadId, options)
    if (activity(current) !== activity(root))
      fail("comment_conflict", "Thread changed. Retrieve a new comment snapshot.", 409)
    return boundedThread(value, root, position?.offset ?? 0, replies(value, root.id), (item) => ({
      contentTrust: REVIEW_CONTENT_TRUST,
      target,
      snapshotId: value.id,
      capturedAt: value.capturedAt,
      thread: item,
    }))
  }
  if (action === "reply_to_comment") {
    const file = `reply-${input.requestId.toLowerCase()}.json`
    return store.lock(file, async () => {
      const previous = await store.read(file)
      if (previous) {
        if (
          !sameTarget(previous.target, target) ||
          previous.threadId !== input.threadId ||
          previous.body !== input.body
        )
          invalid()
        if (previous.state === "confirmed")
          return { ...previous.result, contentTrust: REVIEW_CONTENT_TRUST }
        if (previous.state === "uncertain")
          fail(
            "reply_delivery_unknown",
            "A previous reply attempt may have completed. Inspect Hub; do not resend it.",
          )
      }
      await freshRoot(hub, base, input.threadId, options)
      const receipt = {
        target,
        threadId: input.threadId,
        body: input.body,
        state: "uncertain",
      }
      await store.write(file, receipt)
      let response
      try {
        response = await hub.request(`${base}/${input.threadId}/replies`, {
          ...options,
          method: "POST",
          interactive: true,
          body: { review_comment: { body: input.body } },
        })
      } catch (error) {
        if (
          error.deliveryPhase === "before_dispatch" ||
          (error.code !== "stale_comment_target" &&
            [400, 401, 403, 404, 409, 413, 422, 429].includes(error.statusCode))
        )
          await store.write(file, { ...receipt, state: "rejected" })
        else
          fail(
            "reply_delivery_unknown",
            "Reply delivery is uncertain. Inspect Hub before posting anything again.",
          )
        throw error
      }
      const reply = Array.isArray(response.comments)
        ? response.comments.find((item) => item.kind === "reply" && item.rootId === input.threadId)
        : null
      let projected
      try {
        projected = message(reply)
        if (projected.body !== input.body) invalid()
      } catch (error) {
        if (error.code !== "invalid_comment_request") throw error
        fail(
          "reply_delivery_unknown",
          "Hub did not confirm the submitted reply. Inspect the thread before posting again.",
        )
      }
      const result = {
        contentTrust: REVIEW_CONTENT_TRUST,
        target,
        threadId: input.threadId,
        reply: projected,
        requestId: input.requestId,
      }
      await store.write(file, { ...receipt, state: "confirmed", result })
      return result
    })
  }
  if (action === "resolve_comment") {
    const root = await freshRoot(hub, base, input.threadId, options)
    if (root.resolvedAt) return { target, threadId: input.threadId, resolvedAt: root.resolvedAt }
    if (root.activityVersion !== input.activityVersion)
      fail("comment_conflict", "New activity arrived. Retrieve comments before resolving.", 409)
  }
  const suffix = action === "mark_comment_read" ? "read" : "resolution"
  const response = await hub.request(`${base}/${input.threadId}/${suffix}`, {
    ...options,
    method: "POST",
    interactive: action === "resolve_comment",
    ...(action === "mark_comment_read"
      ? {
          body: {
            review_thread_read: { activity_version: input.activityVersion },
          },
        }
      : {}),
  })
  const root = Array.isArray(response.comments)
    ? response.comments.find((item) => item.kind === "root" && item.id === input.threadId)
    : null
  const projected = message(root)
  if (action === "mark_comment_read") {
    if (
      !positive(projected.viewerLastSeenActivityVersion) ||
      projected.viewerLastSeenActivityVersion < input.activityVersion
    )
      invalid()
    return {
      target,
      threadId: input.threadId,
      viewerLastSeenActivityVersion: projected.viewerLastSeenActivityVersion,
      unread: projected.unread,
    }
  }
  if (!projected.resolvedAt) invalid()
  return { target, threadId: input.threadId, resolvedAt: projected.resolvedAt }
}
