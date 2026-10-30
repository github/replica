import { setupServer } from "msw/node"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { getWorkspace } from "../requests/get-workspace"
import { settingsQuerySchema } from "../settings-contracts"
import { createMockHandlers } from "./create-handlers"
import { createMockStore } from "./create-store"

describe("expanded mock state", () => {
  it("acknowledges historical review activity without hiding newer activity or regressing the cursor", () => {
    const store = createMockStore({ origin: window.location.origin })
    const changed = store.review.reply(2001, 1, 1, "A new activity version.")
    const root = changed.comments.find((comment) => comment.kind === "root")
    if (!root || root.kind !== "root") throw new Error("A reply must return its updated thread.")
    expect(root.viewerLastSeenActivityVersion).toBe(root.activityVersion)
    store.session.select("reader")

    const historical = store.review.markRead(2001, 1, root.id, root.activityVersion - 1)
    expect(historical.comments[0]).toMatchObject({
      activityVersion: root.activityVersion,
      viewerLastSeenActivityVersion: root.activityVersion - 1,
    })
    store.review.markRead(2001, 1, root.id, root.activityVersion)
    expect(
      store.review.markRead(2001, 1, root.id, root.activityVersion - 1).comments[0],
    ).toMatchObject({ viewerLastSeenActivityVersion: root.activityVersion })
    expect(() => store.review.markRead(2001, 1, root.id, root.activityVersion + 1)).toThrow(
      expect.objectContaining({ status: 409 }),
    )
  })

  it("expires fixed-Build links and never restores revoked links when sharing is re-enabled", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"))
    const store = createMockStore({ origin: window.location.origin })
    const first = store.product.createShareLink(2001, 1, {
      label: "A one-day review",
      expiration: "one_day",
      buildNumber: 3,
    }).link
    store.session.select("signed-out")
    expect(store.product.getPublicShare(first.shareId)).toMatchObject({
      state: "active",
      buildNumber: 3,
      previewUrl: store.flowContext.resources.builds.find(
        (build) => build.repositoryId === 2001 && build.prototypeId === 1 && build.number === 3,
      )?.previewUrl,
    })

    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"))
    const expired = store.product.getPublicShare(first.shareId)
    expect(expired.state).toBe("expired")
    expect(expired).not.toHaveProperty("previewUrl")
    store.session.select("owner")
    const second = store.product.createShareLink(2001, 1, {
      label: "A replacement review",
      expiration: "seven_days",
      buildNumber: 3,
    }).link
    store.product.revokeShareLink(2001, 1, first.shareId)
    expect(store.product.getPublicShare(first.shareId).state).toBe("revoked")
    store.session.select("admin")
    store.product.updateSharingSettings({ operation: "disable", confirmed: true })
    expect(store.product.getPublicShare(second.shareId)).not.toHaveProperty("previewUrl")
    store.product.updateSharingSettings({ operation: "enable", confirmed: true })
    expect(store.product.getPublicShare(second.shareId).state).toBe("revoked")
    const replacement = store.product.createShareLink(2001, 1, {
      label: "A newly enabled review",
      expiration: "seven_days",
      buildNumber: 3,
    }).link
    expect(store.product.getPublicShare(replacement.shareId).state).toBe("active")
  })

  it("keeps notification versions and workspace navigation scoped to their synthetic recipient", async () => {
    vi.stubEnv("MODE", "development")
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const request = new Request(new URL("/notifications", store.origin))
    const query = settingsQuerySchema.parse({ repositoryId: 2001, limit: 50 })
    const initial = store.settings.getWorkspace(query).notifications
    const notification = initial.items.find((item) => !item.read)
    if (!notification) throw new Error("The fixture must include an unread owner notification.")

    store.settings.mutate({
      operation: "notification-read",
      notificationId: notification.id,
      version: notification.version,
      read: true,
    })
    expect(store.settings.getWorkspace(query).notifications.unreadCount).toBe(
      initial.unreadCount - 1,
    )
    store.settings.mutate({ operation: "welcome-hide" })
    expect((await getWorkspace(request)).navigation).toEqual({
      welcomeHidden: true,
      notificationsUnreadCount: initial.unreadCount - 1,
    })
    expect(() =>
      store.settings.mutate({
        operation: "notification-read",
        notificationId: notification.id,
        version: notification.version,
        read: false,
      }),
    ).toThrow(expect.objectContaining({ status: 409 }))
    store.session.select("reader")
    expect(store.settings.getWorkspace(query).notifications.items).toEqual([])
    expect((await getWorkspace(request)).navigation).toEqual({
      welcomeHidden: false,
      notificationsUnreadCount: 0,
    })
    expect(() =>
      store.settings.mutate({
        operation: "notification-read",
        notificationId: notification.id,
        version: notification.version + 1,
        read: false,
      }),
    ).toThrow(expect.objectContaining({ status: 404 }))
    store.session.select("owner")
    expect(
      store.settings
        .getWorkspace(query)
        .notifications.items.find((item) => item.id === notification.id),
    ).toMatchObject({ read: true, version: notification.version + 1 })
    expect((await getWorkspace(request)).navigation).toEqual({
      welcomeHidden: true,
      notificationsUnreadCount: initial.unreadCount - 1,
    })
  })

  it("rejects a previous session's confirmation and allows the next session to start afresh", () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    store.settings.mutate({ operation: "copilot-connect", confirmed: true })
    const previous = store.settings.getPublic().continuation
    if (!previous) throw new Error("Connecting the simulation must require a confirmation.")
    store.session.select("reader")
    store.session.select("admin")

    expect(store.settings.getPublic().continuation).toBeNull()
    expect(() =>
      store.settings.mutate({ operation: "authorize", continuationId: previous.id }),
    ).toThrow(expect.objectContaining({ status: 409 }))
    expect(store.settings.getWorkspace(settingsQuerySchema.parse({})).copilot.connected).toBe(false)
    store.settings.mutate({ operation: "copilot-connect", confirmed: true })

    const current = store.settings.getPublic().continuation
    expect(current).toMatchObject({
      viewerLogin: "octocat",
      sessionRevision: store.session.read().revision,
    })
    expect(current?.id).not.toBe(previous.id)
  })

  it("reseeds product, review, settings and viewer state for a new mock document", () => {
    const store = createMockStore({ origin: window.location.origin })
    const created = store.product.createPrototype(2001, {
      brief: "Only this document",
      description: "A synthetic prototype that must not become seed data.",
      templateId: "default",
    })
    const link = store.product.createShareLink(2001, created.resource.prototype.id, {
      label: "Only this document's link",
      expiration: "seven_days",
      buildNumber: 1,
    }).link
    store.review.reply(2001, 1, 1, "Only this document's reply.")
    store.settings.mutate({
      operation: "analytics-state",
      repositoryId: 2001,
      destinationId: 1,
      state: "paused",
    })
    store.session.select("admin")
    store.settings.mutate({ operation: "copilot-connect", confirmed: true })
    store.session.select("reader")

    const fresh = createMockStore({ origin: window.location.origin })

    expect(fresh.session.read()).toMatchObject({
      profile: "owner",
      revision: 0,
      viewer: { login: "octocat" },
    })
    expect(() => fresh.getPrototype(2001, created.resource.prototype.id)).toThrow(
      expect.objectContaining({ status: 404 }),
    )
    expect(() => fresh.product.getPublicShare(link.shareId)).toThrow(
      expect.objectContaining({ status: 404 }),
    )
    expect(fresh.review.list(2001, 1).comments).toHaveLength(2)
    expect(fresh.settings.getPublic().continuation).toBeNull()
    expect(
      fresh.settings.getWorkspace(settingsQuerySchema.parse({ repositoryId: 2001 })).analytics,
    ).toEqual([expect.objectContaining({ id: 1, enabled: true })])
  })
})
