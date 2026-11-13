import { NOTIFICATION_SCHEMA } from "@utils/notification/schemas"
import {
  settingsPublicResponseSchema,
  settingsWorkspaceResponseSchema,
} from "@application/hub/settings-contracts"
import type {
  AnalyticsDestinationRecord,
  CanvasGrantRecord,
  SettingsMutationResponse,
  SettingsOperation,
  SettingsPublicResponse,
  SettingsQuery,
  SettingsWorkspaceResponse,
} from "@application/hub/settings-contracts/types"

import type { MockScenario } from "../contracts/types"
import type { MockFlowContext } from "../flow-context/types"
import { createSettingsFixtures } from "../create-settings-fixtures"
import { MockStoreError } from "../store-error"

const reservedFixtureIdFloor = 9
const canvasGrantLifetimeMs = 7 * 24 * 60 * 60 * 1000

export function createSettingsStore(context: MockFlowContext) {
  let revision = 0
  const hiddenWelcome = new Set<string>()
  const administrators: ReadonlySet<string> = new Set(["octocat"])
  const candidates = (["octocat", "mona"] as const).map((login, index) => {
    const user = context.resources.users.find((entry) => entry.login === login)
    if (!user) throw new Error(`The settings fixture needs the synthetic ${login} user.`)
    return { id: index + 1, login, name: user.name }
  })
  const firstRepository = context.resources.repositories[0]
  const destinations: AnalyticsDestinationRecord[] = firstRepository
    ? [
        {
          id: 1,
          repositoryId: firstRepository.id,
          configuration: {
            provider: "segment",
            region: "us",
            name: "",
            eventTypes: ["prototype_registered"],
            history: "new",
          },
          enabled: true,
        },
      ]
    : []
  const grants: CanvasGrantRecord[] = []
  const { auditEvents, notifications } = createSettingsFixtures(context)
  let nextId =
    Math.max(
      reservedFixtureIdFloor,
      ...auditEvents.map(({ id }) => id),
      ...notifications.map(({ id }) => id),
    ) + 1
  let github: SettingsPublicResponse["github"] = {
    state: "installed",
    organization: "github",
    version: 0,
    rotation: "idle",
    credentialRevision: 0,
  }
  let copilot: SettingsWorkspaceResponse["copilot"] = { connected: true, connectedBy: "octocat" }
  let continuation: SettingsPublicResponse["continuation"] = null
  let enrollmentComplete = false
  let sessionRevoked = false

  function getPublic(): SettingsPublicResponse {
    const session = context.session.read()
    return settingsPublicResponseSchema.parse({
      revision,
      session,
      github,
      enrollmentComplete,
      sessionRevoked,
      continuation,
    })
  }

  function getWorkspace(query: SettingsQuery, scenario: MockScenario = "normal") {
    const viewer = context.session.requireViewer()
    const session = context.session.read()
    const repository =
      query.repositoryId === undefined
        ? (context.resources.repositories[0] ?? null)
        : context.repositoryRecord(query.repositoryId)
    const ownNotifications = notifications.filter((entry) => entry.recipientLogin === viewer.login)
    const filteredNotifications = ownNotifications
      .filter((entry) => query.unread !== "true" || !entry.read)
      .sort((first, second) => second.id - first.id)
    const auditDenied =
      query.scope === "hub"
        ? !session.capabilities.administerHub
        : !session.capabilities.manageSharing
    const filteredEvents = auditDenied
      ? []
      : auditEvents
          .filter((entry) => query.scope === "hub" || entry.repositoryId === repository?.id)
          .sort((first, second) => second.id - first.id)
    const pageSize = 50
    const empty = scenario === "empty"
    return settingsWorkspaceResponseSchema.parse({
      ...getPublic(),
      repository,
      welcomeHidden: hiddenWelcome.has(viewer.login),
      analytics: empty ? [] : destinations.filter((entry) => entry.repositoryId === repository?.id),
      grants: empty ? [] : grants.filter((entry) => entry.viewerLogin === viewer.login),
      canvasApproval: { code: "ABCDEF1234", consentVersion: "2026-10-01" },
      copilot:
        scenario === "empty"
          ? { connected: false, connectedBy: null }
          : session.capabilities.administerHub
            ? copilot
            : { connected: copilot.connected, connectedBy: null },
      administrators: {
        accessDenied: !session.capabilities.administerHub,
        users:
          empty || !session.capabilities.administerHub
            ? []
            : candidates.filter((entry) => administrators.has(entry.login)),
      },
      notifications: {
        items: empty
          ? []
          : filteredNotifications.slice((query.page - 1) * query.limit, query.page * query.limit),
        unreadCount: empty ? 0 : ownNotifications.filter((entry) => !entry.read).length,
        hasMore: !empty && filteredNotifications.length > query.page * query.limit,
        unreadOnly: query.unread === "true",
        limit: query.limit,
      },
      audit: {
        accessDenied: auditDenied,
        scope: query.scope,
        events: empty
          ? []
          : filteredEvents.slice((query.page - 1) * pageSize, query.page * pageSize),
        nextPage: !empty && filteredEvents.length > query.page * pageSize ? query.page + 1 : null,
      },
    })
  }

  function record(
    operation: SettingsOperation["operation"] | "learning-decide" | "learning-run",
    notice: string,
    repositoryId: string | null = null,
    redirect: string | null = null,
  ): SettingsMutationResponse {
    revision += 1
    auditEvents.push({
      id: nextId++,
      createdAt: new Date().toISOString(),
      actor: context.session.read().viewer?.login ?? "octocat",
      operation,
      repositoryId,
      context: notice,
    })
    return { revision, notice, redirect }
  }

  function requireRepository(repositoryId: string) {
    context.session.requireCapability("manageSharing")
    return context.repositoryRecord(repositoryId)
  }

  function requireInstalledGithub(expectedVersion: number) {
    context.session.requireCapability("administerHub")
    if (github.version !== expectedVersion) {
      throw new MockStoreError(
        409,
        "The GitHub App changed. Reload and confirm the current version.",
      )
    }
  }

  function beginAuthorization(operation: NonNullable<typeof continuation>["operation"]) {
    const viewer = context.session.requireCapability("administerHub")
    continuation = {
      id: `mock-continuation-${nextId++}`,
      operation,
      viewerLogin: viewer.login,
    }
    return record(operation, "Verify your identity to continue.", null, "/settings/authorize")
  }

  function mutate(input: SettingsOperation): SettingsMutationResponse {
    switch (input.operation) {
      case "welcome-hide": {
        const viewer = context.session.requireViewer()
        hiddenWelcome.add(viewer.login)
        return record(input.operation, "Welcome dismissed.")
      }
      case "analytics-save": {
        requireRepository(input.repositoryId)
        const existing = destinations.find(
          (entry) => entry.id === input.destinationId && entry.repositoryId === input.repositoryId,
        )
        if (input.destinationId !== undefined && !existing) {
          throw new MockStoreError(404, "That destination no longer exists.")
        }
        if (
          input.configuration.provider !== "custom" &&
          destinations.some(
            (entry) =>
              entry.repositoryId === input.repositoryId &&
              entry.configuration.provider === input.configuration.provider &&
              entry.id !== input.destinationId,
          )
        ) {
          throw new MockStoreError(409, "That provider already has a destination.")
        }
        if (existing && existing.configuration.provider !== input.configuration.provider) {
          throw new MockStoreError(422, "A saved destination cannot change providers.")
        }
        if (existing) {
          existing.configuration = {
            ...structuredClone(input.configuration),
            history: existing.configuration.history,
          }
        } else {
          destinations.push({
            id: nextId++,
            repositoryId: input.repositoryId,
            configuration: structuredClone(input.configuration),
            enabled: true,
          })
        }
        return record(input.operation, "Analytics destination saved.", input.repositoryId)
      }
      case "analytics-state": {
        requireRepository(input.repositoryId)
        const index = destinations.findIndex(
          (entry) => entry.id === input.destinationId && entry.repositoryId === input.repositoryId,
        )
        if (index < 0) throw new MockStoreError(404, "That destination no longer exists.")
        if (input.state === "disconnected") destinations.splice(index, 1)
        else destinations[index]!.enabled = input.state === "enabled"
        return record(input.operation, `Analytics destination ${input.state}.`, input.repositoryId)
      }
      case "canvas-approve": {
        const repository = requireRepository(input.repositoryId)
        const viewer = context.session.requireViewer()
        if (
          grants.some(
            (entry) => entry.repositoryId === repository.id && entry.viewerLogin === viewer.login,
          )
        ) {
          throw new MockStoreError(409, "This repository already has a canvas connection.")
        }
        grants.push({
          id: nextId++,
          repositoryId: repository.id,
          repository: repository.nameWithOwner,
          viewerLogin: viewer.login,
          expiresAt: new Date(Date.now() + canvasGrantLifetimeMs).toISOString(),
        })
        return record(
          input.operation,
          "Canvas connection approved.",
          repository.id,
          "/settings/canvas",
        )
      }
      case "canvas-revoke": {
        const viewer = context.session.requireViewer()
        const index = grants.findIndex(
          (entry) => entry.id === input.grantId && entry.viewerLogin === viewer.login,
        )
        if (index < 0) throw new MockStoreError(404, "That canvas connection was not found.")
        const grant = grants.splice(index, 1)[0]!
        return record(input.operation, "Canvas connection revoked.", grant.repositoryId)
      }
      case "copilot-connect":
      case "copilot-disconnect": {
        context.session.requireCapability("administerHub")
        return beginAuthorization(input.operation)
      }
      case "github-register": {
        context.session.requireCapability("administerHub")
        github = { ...github, state: "registered", version: github.version + 1 }
        return record(input.operation, "GitHub App registered.", null, "/settings/github/installed")
      }
      case "github-install": {
        context.session.requireCapability("administerHub")
        github = { ...github, state: "installed", version: github.version + 1 }
        return record(input.operation, "GitHub App installation complete.")
      }
      case "github-credentials": {
        requireInstalledGithub(input.expectedVersion)
        github = {
          ...github,
          credentialRevision: github.credentialRevision + 1,
          version: github.version + 1,
        }
        return record(input.operation, "GitHub App credentials updated.")
      }
      case "github-rotation": {
        requireInstalledGithub(input.expectedVersion)
        const expected = { start: "idle", retry: "pending", finish: "confirmed" } as const
        if (github.rotation !== expected[input.phase]) {
          throw new MockStoreError(409, "The webhook rotation changed. Review its current step.")
        }
        github = {
          ...github,
          rotation:
            input.phase === "start" ? "pending" : input.phase === "retry" ? "confirmed" : "idle",
          version: github.version + 1,
        }
        return record(input.operation, `Webhook rotation is ${github.rotation}.`)
      }
      case "github-reset": {
        requireInstalledGithub(input.expectedVersion)
        github = {
          state: "not-configured",
          organization: "github",
          version: github.version + 1,
          rotation: "idle",
          credentialRevision: 0,
        }
        return record(input.operation, "GitHub App configuration reset.", null, "/settings/github")
      }
      case "admin-add":
      case "admin-change": {
        context.session.requireCapability("administerHub")
        throw new MockStoreError(
          501,
          "Administrator role changes are not implemented. No roles or permissions were changed.",
        )
      }
      case "enroll":
        return beginAuthorization("enroll")
      case "authorize":
      case "authorization-cancel": {
        const viewer = context.session.requireCapability("administerHub")
        const pending = getPublic().continuation
        if (!pending || input.continuationId !== pending.id) {
          throw new MockStoreError(409, "This confirmation expired or already finished.")
        }
        continuation = null
        const destination =
          pending.operation === "enroll" ? "/settings/admins" : "/settings/copilot"
        if (input.operation === "authorization-cancel") {
          return record(input.operation, "Confirmation cancelled.", null, destination)
        }
        if (pending.operation === "enroll") {
          enrollmentComplete = true
          return record(input.operation, "Administrator enrollment complete.", null, destination)
        }
        copilot = {
          connected: pending.operation === "copilot-connect",
          connectedBy: pending.operation === "copilot-connect" ? viewer.login : null,
        }
        return record(
          input.operation,
          `Copilot ${copilot.connected ? "connected" : "disconnected"}.`,
          null,
          destination,
        )
      }
      case "notification-read": {
        const viewer = context.session.requireViewer()
        const notification = notifications.find(
          (entry) => entry.id === input.notificationId && entry.recipientLogin === viewer.login,
        )
        if (!notification) throw new MockStoreError(404, "That notification was not found.")
        if (notification.version !== input.version) {
          throw new MockStoreError(
            409,
            "This notification changed. Refresh the inbox and try again.",
          )
        }
        notification.read = input.read
        notification.version += 1
        return record(input.operation, `Notification marked ${input.read ? "read" : "unread"}.`)
      }
      case "session-revoke": {
        context.session.requireCapability("administerHub")
        continuation = null
        sessionRevoked = true
        context.session.select("signed-out")
        return record(input.operation, "Sessions ended.", null, "/settings/sessions")
      }
      case "session-cancel":
        context.session.requireCapability("administerHub")
        return {
          revision,
          notice: "Session revocation cancelled.",
          redirect: "/settings/audit",
        }
    }
  }

  return {
    getPublic,
    getWorkspace,
    mutate,
    getCopilot() {
      return { ...copilot }
    },
    recordLearningActivity(
      operation: "learning-decide" | "learning-run",
      detail: string,
      repositoryId: string,
    ) {
      record(operation, detail, repositoryId)
    },
    getNotificationPage(unreadOnly: boolean, limit: number, before?: number) {
      const viewer = context.session.requireViewer()
      const owned = notifications.filter((entry) => entry.recipientLogin === viewer.login)
      const matching = owned
        .filter(
          (entry) => (!unreadOnly || !entry.read) && (before === undefined || entry.id < before),
        )
        .sort((first, second) => second.id - first.id)
      const page = matching.slice(0, limit)
      return {
        notifications: page.map((notification) => NOTIFICATION_SCHEMA.parse(notification)),
        unreadCount: owned.filter((entry) => !entry.read).length,
        nextBefore: matching.length > limit ? page.at(-1)!.id : null,
      }
    },
    getNotificationRead(id: number) {
      const viewer = context.session.requireViewer()
      const notification = notifications.find(
        (entry) => entry.id === id && entry.recipientLogin === viewer.login,
      )
      if (!notification) throw new MockStoreError(404, "Notification not found.")
      return {
        version: notification.version,
        read: notification.read,
        unreadCount: notifications.filter(
          (entry) => entry.recipientLogin === viewer.login && !entry.read,
        ).length,
      }
    },
    getWelcomeHidden() {
      const viewer = context.session.read().viewer
      return viewer ? hiddenWelcome.has(viewer.login) : false
    },
    getNavigationState() {
      const viewer = context.session.read().viewer
      return {
        welcomeHidden: viewer ? hiddenWelcome.has(viewer.login) : false,
        notificationsUnreadCount: viewer
          ? notifications.filter((entry) => entry.recipientLogin === viewer.login && !entry.read)
              .length
          : 0,
      }
    },
    searchAdministrators(query: string) {
      context.session.requireCapability("administerHub")
      const normalized = query.trim().toLowerCase()
      return {
        users: candidates.filter(
          (entry) =>
            !administrators.has(entry.login) &&
            `${entry.login} ${entry.name ?? ""}`.toLowerCase().includes(normalized),
        ),
        more: false,
      }
    },
  }
}
