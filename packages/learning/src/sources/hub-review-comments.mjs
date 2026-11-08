import { LearningError } from "../errors.mjs"
import { derivedId } from "../ids.mjs"
import { PRODUCER, SCHEMA_VERSIONS } from "../records.mjs"
import { normalizeTimestamp } from "../time.mjs"

/** The source kind of Hub review comments, used by episodes, evidence, and consent grants. */
export const HUB_SOURCE = "hub_review_comments"

/** The format of a collection log written by the agent that ran the canvas comment actions. */
export const HUB_COLLECTION_KIND = "replica.hub-review-collection/v1"

/**
 * The Hub comment ID of a stored comment version: in its payload, or in its redaction note once
 * the payload is gone.
 */
export function commentIdOf(event) {
  return event.payload !== undefined ? event.payload.commentId : event.redaction?.commentId
}

const LIST = "list_repository_comments"
const THREAD = "get_repository_comment_thread"
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/
const LOGIN = /^[A-Za-z0-9_-]{1,256}$/

/**
 * Read a log of Replica canvas comment calls and decide whether it is a complete collection.
 *
 * The log is { kind, calls: [{ action, input, result }] }, in the order the calls were made:
 * list_repository_comments from its first page to the page whose scanComplete is true and
 * hasMore is false, then get_repository_comment_thread for every thread whose replies have
 * more pages. Every result must come from one snapshot of the expected repository.
 *
 * Malformed results throw. Missing pages, broken cursor links, and changed filters do not
 * throw: they make the collection incomplete and are listed in problems.
 *
 * @param {unknown} log
 * @param {{ repository: string }} expected the caller's repository, owner/name in lowercase
 */
export function readHubReviewCollection(log, { repository }) {
  if (
    !isObject(log) ||
    log.kind !== HUB_COLLECTION_KIND ||
    !Array.isArray(log.calls) ||
    !log.calls.length
  )
    invalid(
      `A collection log must be { "kind": "${HUB_COLLECTION_KIND}", "calls": [...] } with at least one call.`,
    )
  if (Object.hasOwn(log, "reviewerIdentity") && log.reviewerIdentity !== "stable-user-id")
    invalid('reviewerIdentity must be "stable-user-id" when supplied.')
  for (const [index, call] of log.calls.entries()) {
    if (
      !isObject(call) ||
      ![LIST, THREAD].includes(call.action) ||
      !isObject(call.input) ||
      !isObject(call.result)
    )
      invalid(`Call ${index + 1} must be { action, input, result } from ${LIST} or ${THREAD}.`)
    const trust = call.result.contentTrust
    if (
      !isObject(trust) ||
      trust.source !== HUB_SOURCE ||
      trust.untrusted !== true ||
      trust.treatAs !== "data"
    )
      invalid(`Call ${index + 1} is not a Hub review comment result.`)
  }

  const lists = log.calls.filter((call) => call.action === LIST)
  if (!lists.length) invalid(`The log has no ${LIST} call.`)
  const first = lists[0].result
  const target = readTarget(first.target)
  if (target.repository.toLowerCase() !== repository)
    throw new LearningError(
      "scope_violation",
      `The comments belong to ${target.repository}, not to this repository (${repository}).`,
    )
  const snapshotId = text(first.snapshotId, 64)
  if (!UUID.test(snapshotId)) invalid("snapshotId must be a UUID.")
  const capturedAt = timestamp(first.capturedAt, "capturedAt")
  for (const [index, call] of log.calls.entries()) {
    if (!sameTarget(call.result.target, first.target) || call.result.snapshotId !== snapshotId)
      invalid(
        `Call ${index + 1} comes from a different snapshot or target. Import one snapshot per log.`,
      )
    if (call.result.capturedAt !== first.capturedAt)
      invalid(`Call ${index + 1} has a different capturedAt.`)
  }

  const problems = []
  const filters = readFilters(lists[0].input)
  if (lists[0].input.cursor !== undefined)
    problems.push(`The first ${LIST} call continued from a cursor, so earlier pages are missing.`)
  for (let index = 1; index < lists.length; index++) {
    if (JSON.stringify(readFilters(lists[index].input)) !== JSON.stringify(filters))
      problems.push(`${LIST} call ${index + 1} used different filters from the first call.`)
    if (lists[index].input.cursor !== lists[index - 1].result.nextCursor)
      problems.push(
        `${LIST} call ${index + 1} does not continue from the previous page's nextCursor.`,
      )
  }
  const last = lists.at(-1).result
  if (last.scanComplete !== true || last.hasMore !== false)
    problems.push("The last list page says more results remain, so the collection stops early.")

  const threads = new Map()
  let listed = 0
  for (const [index, { input, result }] of lists.entries()) {
    const label = `${LIST} call ${index + 1}`
    readListPage(result, label)
    if (!result.scanComplete) {
      if (result.threads.length) invalid(`${label} is still scanning but contains threads.`)
      if (!result.hasMore || result.nextCursor !== `${snapshotId}:scan`)
        problems.push(`${label} is still scanning but does not continue the scan.`)
      continue
    }
    const offset = listOffset(input.cursor, snapshotId)
    if (offset === null) problems.push(`${label} uses a cursor whose position cannot be checked.`)
    else if (offset !== listed)
      problems.push(`${label} starts after ${offset} threads, but ${listed} came before it.`)
    for (const value of result.threads) {
      const root = readMessage(value, "root")
      readReplyPage(value, `Thread ${root.id}`)
      if (threads.has(root.id)) {
        problems.push(`Thread ${root.id} appears on more than one list page.`)
        continue
      }
      listed++
      const replies = readReplies(value, root)
      const expected = value.repliesHasMore
        ? `${snapshotId}:reply:${root.id}:${replies.length}`
        : null
      if (value.repliesNextCursor !== expected)
        problems.push(`Thread ${root.id} has a reply cursor that does not follow its first page.`)
      threads.set(root.id, { root, replies, nextReplyCursor: value.repliesNextCursor })
    }
    if (result.hasMore && result.nextCursor !== `${snapshotId}:list:${listed}`)
      problems.push(`${label} returns a nextCursor that does not follow its threads.`)
  }

  const continuations = log.calls.filter((call) => call.action === THREAD)
  const used = new Set()
  for (const thread of threads.values()) {
    let cursor = thread.nextReplyCursor
    while (cursor) {
      const index = continuations.findIndex(
        (call, position) =>
          !used.has(position) &&
          call.input.threadId === thread.root.id &&
          call.input.snapshotId === snapshotId &&
          call.input.cursor === cursor,
      )
      if (index === -1) {
        problems.push(
          `Replies for thread ${thread.root.id} stop at cursor ${cursor}; the next page is missing.`,
        )
        break
      }
      used.add(index)
      const page = continuations[index].result.thread
      if (!isObject(page) || page.id !== thread.root.id)
        invalid(`A reply page for thread ${thread.root.id} names another thread.`)
      readReplyPage(page, `A reply page for thread ${thread.root.id}`)
      if (replyOffset(cursor, snapshotId, thread.root.id) !== thread.replies.length) {
        problems.push(
          `Replies for thread ${thread.root.id} skip or repeat messages at cursor ${cursor}.`,
        )
        break
      }
      thread.replies.push(...readReplies(page, thread.root))
      const expected = page.repliesHasMore
        ? `${snapshotId}:reply:${thread.root.id}:${thread.replies.length}`
        : null
      if (page.repliesNextCursor !== expected) {
        problems.push(`Replies for thread ${thread.root.id} continue from an unexpected cursor.`)
        break
      }
      cursor = page.repliesNextCursor
    }
    const ids = new Set()
    const before = thread.replies.length
    thread.replies = thread.replies.filter((reply) => !ids.has(reply.id) && ids.add(reply.id))
    if (thread.replies.length !== before)
      problems.push(`Thread ${thread.root.id} lists the same reply more than once.`)
    thread.replies.sort(chronological)
    delete thread.nextReplyCursor
  }
  if (used.size < continuations.length)
    problems.push(
      `${continuations.length - used.size} thread call(s) continue no listed thread and were ignored.`,
    )

  const messages = [...threads.values()].reduce(
    (total, thread) => total + 1 + thread.replies.length,
    0,
  )
  const identified = [...threads.values()].some(
    (thread) =>
      [thread.root, ...thread.replies].some(
        (message) => message.authorGithubId !== undefined || message.authorLocalId !== undefined,
      ) ||
      thread.root.resolvedByGithubId !== undefined ||
      thread.root.resolvedByLocalId !== undefined,
  )
  return {
    meta: {
      hubOrigin: target.hubOrigin,
      repository: target.repository.toLowerCase(),
      repositoryId: target.repositoryId,
      snapshotId: snapshotId.toLowerCase(),
      capturedAt,
      ...(identified || log.reviewerIdentity === "stable-user-id"
        ? { reviewerIdentity: "stable-user-id" }
        : {}),
    },
    filters,
    threads: [...threads.values()],
    complete: problems.length === 0,
    problems,
    counts: { threads: threads.size, messages },
  }
}

/**
 * The episode for one Hub review thread. Its ID depends only on the scope, Hub, repository,
 * prototype, and thread, so later imports find it again and two scopes never share it.
 */
export function hubThreadEpisode({ meta, thread, scope, grantIds, principal, importedAt }) {
  const { root } = thread
  return {
    schemaVersion: SCHEMA_VERSIONS.episode,
    id: hubEpisodeId(scope, meta, root),
    scope,
    source: {
      kind: HUB_SOURCE,
      hubOrigin: meta.hubOrigin,
      repository: meta.repository,
      repositoryId: meta.repositoryId,
      prototypeId: root.prototype.id,
      ...(root.prototype.name ? { prototypeName: root.prototype.name } : {}),
      branch: root.prototype.branch,
      buildNumber: root.buildNumber,
      threadId: root.id,
    },
    actors: [reviewer(root.authorLogin, root.authorGithubId, root.authorLocalId, scope, meta)],
    grants: [...grantIds],
    contentTrust: { untrusted: true, treatAs: "data", source: HUB_SOURCE },
    provenance: {
      producer: { ...PRODUCER },
      method: "import:hub_review_comments",
      createdAt: importedAt,
      createdBy: principal,
    },
    startedAt: root.createdAt,
  }
}

export function hubEpisodeId(scope, meta, root) {
  return derivedId("ep", {
    scope,
    source: HUB_SOURCE,
    hubOrigin: meta.hubOrigin,
    repositoryId: meta.repositoryId,
    prototypeId: root.prototype.id,
    threadId: root.id,
  })
}

/**
 * The events a thread adds to its episode, given the events already stored. Nothing is
 * rewritten: an edit adds a version that supersedes the last one, a deletion retracts every
 * earlier version, and a change in resolution adds a status_change.
 */
export function hubThreadEvents({ meta, thread, scope, episodeId, existing }) {
  const known = [...existing]
  const added = []
  function add(event) {
    known.push(event)
    added.push(event)
  }
  const ids = new Set(known.map((event) => event.id))
  const retracted = new Set(
    known.filter((event) => event.type === "retraction").map((event) => event.parentEventId),
  )
  // A version whose text was removed is still a version, so its comment is not imported anew.
  function versionsOf(commentId) {
    return known.filter(
      (event) => event.type === "human_comment" && commentIdOf(event) === commentId,
    )
  }

  let rootEventId = null
  for (const message of [thread.root, ...thread.replies]) {
    const versions = versionsOf(message.id)
    const actor = reviewer(
      message.authorLogin,
      message.authorGithubId,
      message.authorLocalId,
      scope,
      meta,
    )
    const stable = message.authorGithubId !== undefined || message.authorLocalId !== undefined
    const versionIds = new Set(versions.map((event) => event.id))
    const existingStable = [
      ...versions,
      ...known.filter(
        (event) =>
          event.type === "retraction" &&
          versionIds.has(event.parentEventId) &&
          event.id ===
            derivedId("ev", {
              episodeId,
              identityCorrects: event.parentEventId,
              actor: event.actor.id,
            }),
      ),
    ].filter((event) => stableReviewer(event.actor, scope, meta))
    if (!stable && existingStable.length)
      throw new LearningError(
        "conflict",
        `Hub comment ${message.id} already has a stable author. A new snapshot cannot downgrade it to a login-only identity.`,
      )
    if (stable && existingStable.some((event) => event.actor.id !== actor.id))
      throw new LearningError(
        "conflict",
        `Hub comment ${message.id} already names a different stable author. Nothing was imported.`,
      )
    if (stable) {
      for (const event of versions.filter((event) => !stableReviewer(event.actor, scope, meta))) {
        const id = derivedId("ev", { episodeId, identityCorrects: event.id, actor: actor.id })
        retracted.add(event.id)
        if (ids.has(id)) continue
        ids.add(id)
        add({
          schemaVersion: SCHEMA_VERSIONS.event,
          id,
          episodeId,
          scope,
          type: "retraction",
          at: meta.capturedAt,
          parentEventId: event.id,
          actor,
          payload: {
            target: { eventId: event.id },
            reason: "identity_corrected",
            at: meta.capturedAt,
          },
        })
      }
    }
    if (message.deletedAt) {
      const live = versions.filter(
        (event) =>
          event.payload !== undefined && event.payload.body !== null && !retracted.has(event.id),
      )
      for (const event of live) {
        const id = derivedId("ev", { episodeId, retracts: event.id })
        if (ids.has(id)) continue
        ids.add(id)
        retracted.add(event.id)
        add({
          schemaVersion: SCHEMA_VERSIONS.event,
          id,
          episodeId,
          scope,
          type: "retraction",
          at: message.deletedAt,
          parentEventId: event.id,
          actor: { kind: "system", id: `system:${HUB_SOURCE}` },
          payload: {
            target: { eventId: event.id },
            reason: "deleted_at_source",
            at: message.deletedAt,
          },
        })
      }
      if (versions.length) {
        if (message.kind === "root") rootEventId = versions.at(-1).id
        continue
      }
    }
    const version = message.deletedAt ?? message.editedAt ?? message.createdAt
    const id = derivedId("ev", {
      episodeId,
      commentId: message.id,
      version,
      ...(stable ? { actor: actor.id } : {}),
    })
    if (message.kind === "root") rootEventId = id
    if (ids.has(id)) continue
    // Identity migration must not recreate a payload a person already removed.
    if (versions.some((event) => event.payload === undefined && event.at === version)) {
      if (message.kind === "root") rootEventId = versions.at(-1).id
      continue
    }
    ids.add(id)
    const previous = versions.at(-1)
    add({
      schemaVersion: SCHEMA_VERSIONS.event,
      id,
      episodeId,
      scope,
      type: "human_comment",
      at: message.deletedAt ? message.createdAt : (message.editedAt ?? message.createdAt),
      actor,
      ...(message.kind === "reply" && rootEventId ? { parentEventId: rootEventId } : {}),
      ...(previous ? { supersedes: previous.id } : {}),
      payload: {
        source: "hub_review_comment",
        commentId: message.id,
        threadId: thread.root.id,
        role: message.kind,
        body: message.body,
        createdAt: message.createdAt,
        editedAt: message.editedAt,
        deletedAt: message.deletedAt,
        ...(message.kind === "root" ? { buildNumber: message.buildNumber } : {}),
        ...(message.kind === "root" && message.context ? { context: message.context } : {}),
      },
    })
  }

  const statuses = known.filter((event) => event.type === "status_change")
  const last = statuses.at(-1)
  const recorded = last?.payload?.status ?? "unresolved"
  const current = thread.root.resolvedAt ? "resolved" : "unresolved"
  function resolver() {
    return thread.root.resolvedByLogin
      ? reviewer(
          thread.root.resolvedByLogin,
          thread.root.resolvedByGithubId,
          thread.root.resolvedByLocalId,
          scope,
          meta,
        )
      : undefined
  }
  // A thread reopened and resolved again between imports is still resolved, so only a new
  // resolution time or another resolver shows that someone resolved it again.
  const resolvedAgain =
    current === "resolved" &&
    recorded === "resolved" &&
    (last.at !== thread.root.resolvedAt || !sameReviewer(last.payload.by, resolver(), scope, meta))
  if (current !== recorded || resolvedAgain) {
    const at = thread.root.resolvedAt ?? meta.capturedAt
    const by = resolver()
    // Two resolutions at the same time differ only in who resolved the thread.
    const id = derivedId("ev", {
      episodeId,
      status: current,
      at,
      ...(resolvedAgain && last.at === at ? { by: by?.id ?? null } : {}),
    })
    if (!ids.has(id))
      add({
        schemaVersion: SCHEMA_VERSIONS.event,
        id,
        episodeId,
        scope,
        type: "status_change",
        at,
        actor: by ? { ...by } : { kind: "system", id: `system:${HUB_SOURCE}` },
        payload: {
          subject: { kind: "thread", id: thread.root.id },
          status: current,
          at,
          ...(by ? { by } : {}),
        },
      })
  }
  return added
}

/**
 * Whether a resolver names the same person as the recorded one. A stable ID matches only the same
 * stable ID, because a login given without one may now belong to someone else. A login-only
 * identity, which keeps its login only in its ID, matches the same login, so a reviewer whose
 * login gains a stable ID stays the same person.
 */
function sameReviewer(recorded, current, scope, meta) {
  if (!recorded || !current) return recorded === current
  if (stableReviewer(recorded, scope, meta))
    return stableReviewer(current, scope, meta) && recorded.id === current.id
  return loginOf(recorded) === loginOf(current)
}

function loginOf(actor) {
  return actor.login ?? actor.id.replace(/^github:/, "")
}

function reviewer(login, githubId, localId, scope, meta) {
  if (githubId !== undefined) {
    if (!scope.host || scope.host === "local")
      invalid("A GitHub reviewer ID needs an explicit GitHub host in the scope.")
    return { kind: "human", id: `github-user:${scope.host}/${githubId}`, login, role: "reviewer" }
  }
  if (localId !== undefined) {
    if (scope.host !== "local") invalid("A local reviewer ID is allowed only in a local scope.")
    return {
      kind: "human",
      id: `hub-user:${new URL(meta.hubOrigin).origin}/${localId}`,
      login,
      role: "reviewer",
    }
  }
  return { kind: "human", id: `github:${login}`, role: "reviewer", asserted: true }
}

export function stableReviewer(actor, scope, source) {
  const prefix =
    scope.host === "local"
      ? source.hubOrigin
        ? `hub-user:${new URL(source.hubOrigin).origin}/`
        : null
      : scope.host
        ? `github-user:${scope.host}/`
        : null
  if (!prefix || !actor?.id?.startsWith(prefix)) return false
  const id = actor.id.slice(prefix.length)
  return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))
}

/** Check the pagination fields of a list page; a missing or contradictory flag is malformed. */
function readListPage(result, label) {
  if (
    typeof result.scanComplete !== "boolean" ||
    !Array.isArray(result.threads) ||
    typeof result.hasMore !== "boolean"
  )
    invalid(`${label} needs scanComplete, threads, and hasMore.`)
  if (
    result.hasMore
      ? typeof result.nextCursor !== "string" || !result.nextCursor
      : result.nextCursor !== null
  )
    invalid(`${label} has a nextCursor that contradicts hasMore.`)
}

/** Check the reply pagination fields of a thread; a missing or contradictory flag is malformed. */
function readReplyPage(value, label) {
  if (
    !Array.isArray(value.replies) ||
    typeof value.repliesHasMore !== "boolean" ||
    typeof value.threadComplete !== "boolean"
  )
    invalid(`${label} needs replies, repliesHasMore, and threadComplete.`)
  if (
    value.repliesHasMore
      ? typeof value.repliesNextCursor !== "string" || !value.repliesNextCursor
      : value.repliesNextCursor !== null
  )
    invalid(`${label} has a repliesNextCursor that contradicts repliesHasMore.`)
  if (value.threadComplete && value.repliesHasMore)
    invalid(`${label} says it is complete and has more replies.`)
}

/** How many threads a list cursor says came before its page, or null when it cannot be read. */
function listOffset(cursor, snapshotId) {
  if (cursor === undefined || cursor === `${snapshotId}:scan`) return 0
  const match = typeof cursor === "string" ? /^(.+):list:(0|[1-9]\d*)$/.exec(cursor) : null
  return match && match[1] === snapshotId ? Number(match[2]) : null
}

/** How many replies a reply cursor says came before its page, or null when it cannot be read. */
function replyOffset(cursor, snapshotId, threadId) {
  const match = /^(.+):reply:([1-9]\d*):(0|[1-9]\d*)$/.exec(cursor)
  return match && match[1] === snapshotId && Number(match[2]) === threadId ? Number(match[3]) : null
}

function readTarget(value) {
  if (
    !isObject(value) ||
    value.scope !== "repository" ||
    typeof value.hubOrigin !== "string" ||
    !ORIGIN.test(value.hubOrigin) ||
    typeof value.repository !== "string" ||
    !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value.repository) ||
    !positive(value.repositoryId)
  )
    invalid(
      "Results need a repository target from list_repository_comments. Prototype-scoped list_comments logs are not supported.",
    )
  try {
    new URL(value.hubOrigin)
  } catch {
    invalid("The Hub origin must be a valid HTTP or HTTPS origin.")
  }
  return value
}

function readFilters(input) {
  const filters = {
    resolution: input.resolution ?? "all",
    read: input.read ?? "all",
    from: input.from === undefined ? null : timestamp(input.from, "from"),
    to: input.to === undefined ? null : timestamp(input.to, "to"),
  }
  if (
    !["all", "unresolved", "resolved"].includes(filters.resolution) ||
    !["all", "unread", "read"].includes(filters.read)
  )
    invalid("Unknown resolution or read filter.")
  return filters
}

function readReplies(value, root) {
  if (!Array.isArray(value.replies)) invalid(`Thread ${root.id} has no replies array.`)
  return value.replies.map((reply) => {
    const message = readMessage(reply, "reply")
    if (message.rootId !== root.id)
      invalid(`Reply ${message.id} belongs to thread ${message.rootId}, not ${root.id}.`)
    if (message.prototype.id !== root.prototype.id)
      invalid(`Reply ${message.id} names another prototype.`)
    return message
  })
}

function readMessage(value, kind) {
  if (!isObject(value) || value.kind !== kind || !positive(value.id))
    invalid(`Expected a ${kind} comment.`)
  const deletedAt = value.deletedAt === null ? null : timestamp(value.deletedAt, "deletedAt")
  const body = deletedAt ? value.body : text(value.body, 10_000)
  if (deletedAt && body !== null) invalid(`Deleted comment ${value.id} still has text.`)
  if (!deletedAt && !body.trim()) invalid(`Comment ${value.id} is empty.`)
  if (!isObject(value.author) || !LOGIN.test(value.author.login ?? ""))
    invalid(`Comment ${value.id} needs an author login.`)
  const authorIdentity = readIdentity(value.author, `Comment ${value.id} author`)
  const resolverIdentity =
    value.resolvedBy === null || value.resolvedBy === undefined
      ? {}
      : readIdentity(value.resolvedBy, `Comment ${value.id} resolver`)
  if (
    !isObject(value.prototype) ||
    !positive(value.prototype.id) ||
    !text(value.prototype.branch, 1024)
  )
    invalid(`Comment ${value.id} needs its prototype ID and branch.`)
  const message = {
    id: value.id,
    kind,
    body,
    authorLogin: value.author.login,
    ...(authorIdentity.githubId !== undefined ? { authorGithubId: authorIdentity.githubId } : {}),
    ...(authorIdentity.localId !== undefined ? { authorLocalId: authorIdentity.localId } : {}),
    createdAt: timestamp(value.createdAt, "createdAt"),
    editedAt:
      value.editedAt === null || value.editedAt === undefined
        ? null
        : timestamp(value.editedAt, "editedAt"),
    deletedAt,
    prototype: {
      id: value.prototype.id,
      name:
        value.prototype.name === null || value.prototype.name === undefined
          ? null
          : text(value.prototype.name, 1024),
      branch: value.prototype.branch,
    },
  }
  if (kind === "reply") {
    if (!positive(value.rootId)) invalid(`Reply ${value.id} needs a rootId.`)
    return { ...message, rootId: value.rootId }
  }
  if (!positive(value.buildNumber))
    invalid(`Thread ${value.id} needs the Build number the reviewer saw.`)
  return {
    ...message,
    buildNumber: value.buildNumber,
    context: compactContext(value.anchor),
    resolvedAt:
      value.resolvedAt === null || value.resolvedAt === undefined
        ? null
        : timestamp(value.resolvedAt, "resolvedAt"),
    resolvedByLogin:
      isObject(value.resolvedBy) && LOGIN.test(value.resolvedBy.login ?? "")
        ? value.resolvedBy.login
        : null,
    ...(resolverIdentity.githubId !== undefined
      ? { resolvedByGithubId: resolverIdentity.githubId }
      : {}),
    ...(resolverIdentity.localId !== undefined
      ? { resolvedByLocalId: resolverIdentity.localId }
      : {}),
  }

  function readIdentity(value, label) {
    if (!isObject(value)) invalid(`${label} must be an actor.`)
    if (Object.hasOwn(value, "local")) invalid(`${label} uses localId, not a local flag.`)
    if (Object.hasOwn(value, "githubId") && Object.hasOwn(value, "localId"))
      invalid(`${label} cannot name both githubId and localId.`)
    const identity = {}
    for (const key of ["githubId", "localId"])
      if (Object.hasOwn(value, key)) {
        if (!positive(value[key])) invalid(`${label}.${key} must be a positive safe integer.`)
        if (!LOGIN.test(value.login ?? "")) invalid(`${label} needs a login for display.`)
        identity[key] = value[key]
      }
    return identity
  }
}

/** Keep only the saved target fields Hub itself shows: route and accessible element details. */
function compactContext(anchor) {
  if (!isObject(anchor) || !["element", "area"].includes(anchor.kind)) return undefined
  const context = { kind: anchor.kind }
  if (isObject(anchor.route)) {
    const route = {}
    for (const [key, limit] of [
      ["pathname", 2048],
      ["search", 2048],
      ["hash", 1024],
    ])
      if (typeof anchor.route[key] === "string" && anchor.route[key].length <= limit)
        route[key] = anchor.route[key]
    context.route = route
  }
  for (const [key, limit] of [
    ["accessibleName", 1000],
    ["tagName", 64],
    ["selectedText", 2000],
  ])
    if (anchor.kind === "element" && typeof anchor[key] === "string" && anchor[key].length <= limit)
      context[key] = anchor[key]
  if (anchor.kind === "area" && Array.isArray(anchor.elements))
    context.elements = anchor.elements
      .slice(0, 8)
      .filter(isObject)
      .map((element) => {
        const compact = {}
        for (const [key, limit] of [
          ["accessibleName", 1000],
          ["tagName", 64],
          ["role", 64],
          ["textExcerpt", 500],
        ])
          if (typeof element[key] === "string" && element[key].length <= limit)
            compact[key] = element[key]
        return compact
      })
  return context
}

function chronological(left, right) {
  return left.createdAt < right.createdAt
    ? -1
    : left.createdAt > right.createdAt
      ? 1
      : left.id - right.id
}

function timestamp(value, label) {
  try {
    return normalizeTimestamp(value)
  } catch {
    invalid(`${label} must be an RFC 3339 time.`)
  }
}

function text(value, limit) {
  if (typeof value !== "string" || value.length > limit)
    invalid("Expected text within its size limit.")
  return value
}

function positive(value) {
  return Number.isSafeInteger(value) && value > 0
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function sameTarget(left, right) {
  return (
    isObject(left) &&
    JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort())
  )
}

function invalid(message) {
  throw new LearningError("invalid_input", message)
}
