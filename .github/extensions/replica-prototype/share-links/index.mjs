import { randomUUID } from "node:crypto"
import { createShareControlPreferences } from "../share-control-preferences/index.mjs"
import { readHubObject } from "../read-hub-object/index.mjs"
import { readHubError } from "../read-hub-error/index.mjs"
const EXPIRATIONS = new Set(["one_day", "seven_days", "thirty_days", "never"])
const PUBLIC_PATH = /^\/share\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/
function fail(statusCode, message, code) {
  throw Object.assign(new Error(message), { statusCode, code })
}
function positive(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}
function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}
function projectLink(input, origin, listed = false) {
  const value = readHubObject(input)
  if (
    !value ||
    !positive(value.id) ||
    !positive(value.buildNumber) ||
    typeof value.label !== "string" ||
    !value.label.trim() ||
    Buffer.byteLength(value.label) > 100 ||
    (value.expiresAt !== null && !validDate(value.expiresAt)) ||
    typeof value.url !== "string" ||
    !URL.canParse(value.url)
  )
    fail(502, "Hub returned an invalid share link.")
  const url = new URL(value.url)
  if (
    url.origin !== origin ||
    !PUBLIC_PATH.test(url.pathname) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    fail(502, "Hub returned an invalid public share URL.")
  const link = {
    id: value.id,
    url: url.href,
    buildNumber: value.buildNumber,
    label: value.label,
    expiresAt: value.expiresAt,
  }
  if (listed) {
    const createdBy = readHubObject(value.createdBy)
    if (
      !validDate(value.createdAt) ||
      !createdBy ||
      typeof createdBy.login !== "string" ||
      createdBy.login.length > 256 ||
      (createdBy.name !== null && typeof createdBy.name !== "string")
    )
      fail(502, "Hub returned invalid share-link metadata.")
    link.createdAt = value.createdAt
    link.createdBy = {
      login: createdBy.login,
      name: createdBy.name,
    }
  }
  return link
}
export function createShareLinks(
  hubClient,
  launchBrowser,
  preferences = createShareControlPreferences(),
) {
  let current
  let opening = false
  let mutating = false
  async function verify(target) {
    const hub = await hubClient()
    const checkout = hub && (await hub.checkout())
    if (
      !hub ||
      hub.origin !== target.origin ||
      checkout?.repository !== target.repository ||
      checkout?.branch !== target.branch ||
      current !== target
    )
      fail(
        409,
        "Hub or checkout changed. Return to preview and reopen Share prototype.",
        "stale_share_target",
      )
    return hub
  }
  function requireCurrentResponse(target, generation) {
    if (generation !== target.generation)
      fail(
        409,
        "Sharing access changed. Refresh active links before trying again.",
        "stale_share_target",
      )
  }
  // Keep the context, but prevent older replies from restoring access.
  function forgetAuthorization(target) {
    target.generation += 1
    target.links.clear()
    target.authorization = null
  }
  async function request(target, route, options = {}) {
    const generation = target.generation
    const hub = await verify(target)
    requireCurrentResponse(target, generation)
    const result = await hub
      .request(route, {
        expectedTarget: {
          repository: target.repository,
          branch: target.branch,
        },
        connectionScope: target.connectionScope,
        ...options,
      })
      .catch((caught) => {
        const error = readHubError(caught)
        if (generation !== target.generation) throw error
        if (
          error.code === "public_sharing_disabled" ||
          error.code === "public_sharing_changed" ||
          error.code === "creator_access_changed"
        ) {
          forgetAuthorization(target)
          if (error.code === "public_sharing_disabled") target.publicSharingEnabled = false
        }
        throw error
      })
    try {
      await verify(target)
      requireCurrentResponse(target, generation)
    } catch (caught) {
      const error = readHubError(caught)
      error.deliveryPhase = "after_dispatch"
      throw error
    }
    return result
  }
  function targetFor(input) {
    if (!current || input.target !== current.id || !current.base || !current.preferenceIdentity)
      fail(
        409,
        "Sharing context expired. Return to preview and reopen Share prototype.",
        "stale_share_target",
      )
    return current
  }
  function requirePublicSharing(target, prototype = target) {
    if (prototype.publicSharingEnabled !== false) return
    target.publicSharingEnabled = false
    forgetAuthorization(target)
    fail(403, "Public sharing is disabled for this Hub.", "public_sharing_disabled")
  }
  return async function shareLinks(action, rawInput = {}) {
    const input = readHubObject(rawInput)
    if (!input || Array.isArray(input)) fail(422, "Invalid sharing request.")
    if (action === "context") {
      if (opening || mutating)
        fail(409, "A sharing request is still in progress. Wait before reopening.")
      opening = true
      try {
        const hub = await hubClient()
        if (!hub) fail(409, "Enter a Hub URL and connect before sharing.")
        const checkout = await hub.checkout()
        if (!checkout.repository || !checkout.branch)
          fail(409, "Open a named prototype branch before sharing.")
        const target = {
          id: randomUUID(),
          origin: hub.origin,
          repository: checkout.repository,
          branch: checkout.branch,
          connectionScope: {},
          links: new Map(),
          generation: 0,
          expirations: new Set(),
        }
        current = target
        const prototype = await request(
          target,
          `/api/canvas/prototype?branch=${encodeURIComponent(target.branch)}`,
        )
        if (
          !positive(prototype.id) ||
          !positive(prototype.repositoryId) ||
          prototype.branch !== target.branch ||
          (prototype.canManageShareLinks !== undefined &&
            typeof prototype.canManageShareLinks !== "boolean")
        )
          fail(
            409,
            "This Hub cannot verify sharing support. Update Hub and reopen Share prototype.",
          )
        target.prototypeId = prototype.id
        target.base = `/api/canvas/repositories/${prototype.repositoryId}/prototypes/${prototype.id}/share_links`
        target.canManage = prototype.canManageShareLinks === true
        target.publicSharingEnabled = prototype.publicSharingEnabled
        if (
          prototype.shareLinkExpirationOptions !== undefined &&
          (!Array.isArray(prototype.shareLinkExpirationOptions) ||
            !prototype.shareLinkExpirationOptions.length ||
            !prototype.shareLinkExpirationOptions.every(
              (value) => typeof value === "string" && EXPIRATIONS.has(value),
            ) ||
            new Set(prototype.shareLinkExpirationOptions).size !==
              prototype.shareLinkExpirationOptions.length)
        )
          fail(502, "Hub returned an invalid share-link expiration policy.")
        target.expirations = new Set(
          Array.isArray(prototype.shareLinkExpirationOptions)
            ? prototype.shareLinkExpirationOptions
            : EXPIRATIONS,
        )
        target.buildNumber = prototype.published && readHubObject(prototype.build)?.number
        target.preferenceIdentity = JSON.stringify([
          target.origin,
          prototype.repositoryId,
          prototype.id,
        ])
        let controlSettingsIncluded = false
        let controlSettingsError = ""
        try {
          controlSettingsIncluded = await preferences.read(target.preferenceIdentity)
        } catch {
          controlSettingsError =
            "The share preference could not be read. Control settings are off by default."
        }
        await verify(target)
        return {
          target: target.id,
          hubOrigin: target.origin,
          repository: target.repository,
          branch: target.branch,
          prototype,
          controlSettingsIncluded,
          controlSettingsError,
        }
      } finally {
        opening = false
      }
    }
    const target = targetFor(input)
    const generation = target.generation
    if (action === "controls-preference") {
      if (typeof input.included !== "boolean") fail(422, "Invalid share preference.")
      if (opening || mutating) fail(409, "A sharing request is still in progress.")
      mutating = true
      try {
        await verify(target)
        requireCurrentResponse(target, generation)
        try {
          if (!target.preferenceIdentity) fail(409, "Sharing context expired.")
          await preferences.write(target.preferenceIdentity, input.included)
        } catch {
          fail(
            500,
            "This preference could not be saved. It will only apply while this page is open.",
          )
        }
        await verify(target)
        requireCurrentResponse(target, generation)
        return { included: input.included }
      } finally {
        mutating = false
      }
    }
    requirePublicSharing(target)
    if (!target.canManage) fail(403, "You do not have permission to manage share links.")
    if (action === "authorize") {
      if (!target.authorization || Date.parse(target.authorization.expiresAt) <= Date.now())
        fail(410, "Authorization expired. Submit the action again to request a fresh check.")
      const prototype = await request(
        target,
        `/api/canvas/prototype?branch=${encodeURIComponent(target.branch)}`,
      )
      requireCurrentResponse(target, generation)
      requirePublicSharing(target, prototype)
      const result = await launchBrowser(target.authorization.url)
      if (!result.ok) fail(502, result.error || "Could not open the browser.")
      return { opened: true }
    }
    if (action === "list") {
      if (input.cursor != null && (typeof input.cursor !== "string" || input.cursor.length > 4096))
        fail(422, "Invalid share-link page cursor.")
      const page = await request(
        target,
        `${target.base}${input.cursor ? `?cursor=${encodeURIComponent(input.cursor)}` : ""}`,
      )
      requireCurrentResponse(target, generation)
      if (
        !Array.isArray(page.shareLinks) ||
        page.shareLinks.length > 25 ||
        typeof page.hasMore !== "boolean" ||
        (page.hasMore
          ? typeof page.nextCursor !== "string" || !page.nextCursor || page.nextCursor.length > 4096
          : page.nextCursor !== null)
      )
        fail(502, "Hub returned an invalid share-link list.")
      const shareLinks = page.shareLinks.map((link) => projectLink(link, target.origin, true))
      if (!input.cursor) {
        target.links.clear()
        target.uncertain = false
      }
      for (const link of shareLinks) target.links.set(link.id, link)
      return { shareLinks, hasMore: page.hasMore, nextCursor: page.nextCursor }
    }
    if (action === "open") {
      const link = positive(input.id) ? target.links.get(input.id) : undefined
      if (!link) fail(404, "Refresh the share-link list before opening this link.")
      const prototype = await request(
        target,
        `/api/canvas/prototype?branch=${encodeURIComponent(target.branch)}`,
      )
      requireCurrentResponse(target, generation)
      if (prototype.id !== target.prototypeId || !prototype.canManageShareLinks)
        fail(403, "Sharing permission changed. Return to preview and reopen Share prototype.")
      requirePublicSharing(target, prototype)
      const destination = new URL(link.url)
      if (input.controlsQuery !== undefined) {
        if (
          typeof input.controlsQuery !== "string" ||
          Buffer.byteLength(input.controlsQuery) > 8192
        )
          fail(422, "Control settings exceed the share URL limit.")
        const controls = new URLSearchParams(input.controlsQuery)
        const seen = new Set()
        for (const [key, value] of controls) {
          if (
            !/^rc\.[a-zA-Z][a-zA-Z0-9_-]{0,63}\.[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) ||
            seen.has(key)
          )
            fail(422, "Invalid control settings parameters.")
          seen.add(key)
          destination.searchParams.set(key, value)
        }
        if (Buffer.byteLength(destination.search.slice(1)) > 8192)
          fail(422, "Control settings exceed the share URL limit.")
      }
      const result = await launchBrowser(destination.href)
      if (!result.ok) fail(502, result.error || "Could not open the browser.")
      return { opened: true }
    }
    if (!["create", "delete"].includes(action)) fail(405, "Sharing action not supported.")
    if (mutating) fail(409, "A sharing request is already in progress.")
    if (target.uncertain)
      fail(409, "Refresh active links before another sharing request.", "share_delivery_unknown")
    let label
    if (action === "create") {
      if (
        !positive(target.buildNumber) ||
        input.buildNumber !== target.buildNumber ||
        typeof input.label !== "string" ||
        !input.label.trim() ||
        Buffer.byteLength(input.label.trim()) > 100 ||
        !target.expirations.has(input.expiration)
      )
        fail(422, "Choose the displayed published Build, a label up to 100 bytes, and an expiry.")
      label = input.label.trim()
    } else if (!positive(input.id) || !target.links.has(input.id)) {
      fail(404, "Refresh the share-link list before deleting this link.")
    }
    mutating = true
    let confirmedResponse = false
    try {
      if (!target.base) fail(409, "Sharing context expired.")
      const result = await request(
        target,
        action === "create" ? target.base : `${target.base}/${String(input.id)}`,
        {
          method: action === "create" ? "POST" : "DELETE",
          interactive: true,
          ...(action === "create"
            ? {
                body: {
                  share_link: {
                    build_number: target.buildNumber,
                    label,
                    expiration: input.expiration,
                  },
                },
              }
            : {}),
        },
      )
      confirmedResponse = true
      requireCurrentResponse(target, generation)
      target.authorization = null
      if (action === "delete") {
        if (!positive(input.id)) fail(422, "Invalid share-link ID.")
        target.links.delete(input.id)
        return { deleted: true }
      }
      const link = projectLink(result, target.origin)
      if (link.buildNumber !== target.buildNumber)
        fail(502, "Hub did not confirm the displayed Build.")
      target.links.set(link.id, link)
      return link
    } catch (caught) {
      const error = readHubError(caught)
      const authorization = readHubObject(readHubObject(error)?.authorization)
      if (error.code === "fresh_authorization_required" && authorization) {
        requireCurrentResponse(target, generation)
        if (typeof authorization.url !== "string" || typeof authorization.expiresAt !== "string")
          fail(502, "Hub returned invalid sharing authorization.")
        target.authorization = {
          url: authorization.url,
          expiresAt: authorization.expiresAt,
        }
      }
      if (
        (confirmedResponse || error.deliveryPhase === "after_dispatch") &&
        (error.code === "stale_share_target" ||
          error.code === "stale_comment_target" ||
          !(
            typeof error.statusCode === "number" &&
            [400, 401, 403, 404, 409, 413, 422, 429].includes(error.statusCode)
          ))
      ) {
        target.uncertain = true
        fail(
          502,
          "The sharing request may have completed. Refresh active links before trying again.",
          "share_delivery_unknown",
        )
      }
      if (!error.statusCode && error.deliveryPhase === "before_dispatch")
        fail(503, "The sharing request could not be sent. Refresh and try again.")
      if (!error.statusCode) {
        target.uncertain = true
        fail(
          502,
          "The sharing request may have completed. Refresh active links before trying again.",
          "share_delivery_unknown",
        )
      }
      throw error
    } finally {
      mutating = false
    }
  }
}
