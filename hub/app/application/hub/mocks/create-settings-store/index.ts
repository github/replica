import type { InboxNotification } from "@utils/notification/types"

import type { MockScenario } from "../../contracts"
import {
  settingsPublicResponseSchema,
  settingsWorkspaceResponseSchema,
} from "../../settings-contracts"
import type {
  AnalyticsDestinationRecord,
  CanvasGrantRecord,
  LearningRecord,
  LearningRunRecord,
  SettingsAuditEvent,
  SettingsMutationResponse,
  SettingsOperation,
  SettingsPublicResponse,
  SettingsQuery,
  SettingsWorkspaceResponse,
} from "../../settings-contracts"
import type { MockFlowContext } from "../flow-context/types"
import { MockStoreError } from "../store-error"

export function createSettingsStore(context: MockFlowContext) {
  let revision = 0
  let nextId = 10
  const hiddenWelcome = new Set<string>()
  const administrators = new Set(["octocat"])
  const candidates = (["octocat", "mona"] as const).map((login, index) => {
    const user = context.resources.users.find((entry) => entry.login === login)
    if (!user) throw new Error(`The settings fixture needs the synthetic ${login} user.`)
    return { id: index + 1, login, name: user.name }
  })
  const firstRepository = context.resources.repositories[0]
  const firstPrototype = context.resources.prototypes.find(
    (prototype) => prototype.repositoryId === firstRepository?.id,
  )
  const notificationBuild = context.resources.builds
    .filter(
      (build) =>
        build.repositoryId === firstRepository?.id &&
        build.prototypeId === firstPrototype?.id &&
        build.state === "successful",
    )
    .sort((first, second) => second.number - first.number)[0]
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
  const learningRecords: LearningRecord[] = firstRepository
    ? [
        {
          id: "mock-learning-1",
          repositoryId: firstRepository.id,
          content: "Keep a visible label above every form field.",
          version: 1,
          state: "suggested",
          decidedBy: null,
          reason: null,
        },
        {
          id: "mock-learning-2",
          repositoryId: firstRepository.id,
          content: "Explain the next step beside the primary action.",
          version: 1,
          state: "suggested",
          decidedBy: null,
          reason: null,
        },
        {
          id: "mock-learning-3",
          repositoryId: firstRepository.id,
          content: "Use one primary action per form.",
          version: 1,
          state: "accepted",
          decidedBy: "mona",
          reason: null,
        },
      ]
    : []
  const runs: LearningRunRecord[] = []
  const auditEvents: SettingsAuditEvent[] = [
    {
      id: 1,
      createdAt: "2026-10-30T12:00:00Z",
      actor: "octocat",
      operation: "mock-settings-created",
      repositoryId: firstRepository?.id ?? null,
      context: "Synthetic fixture initialized; no external service was contacted.",
    },
  ]
  const notifications: Array<InboxNotification & { recipientLogin: string }> = []
  if (firstRepository && firstPrototype) {
    for (const [index, kind] of (["mention", "reply", "comment", "resolved"] as const).entries()) {
      const id = index + 1
      notifications.push({
        id,
        version: 0,
        recipientLogin: "octocat",
        actor: { login: "mona", name: "Mona Lisa", avatarUrl: null },
        kind,
        excerpt:
          kind === "mention"
            ? "Could you review the primary action, @octocat?"
            : kind === "reply"
              ? "The label now describes the next step."
              : kind === "resolved"
                ? "The mock review conversation is resolved."
                : "A visible label would make this field easier to use.",
        createdAt: `2026-10-30T12:0${index}:00Z`,
        read: index === 3,
        repository: firstRepository.nameWithOwner,
        prototype: firstPrototype.name,
        path: `/repositories/${firstRepository.id}/prototypes/${firstPrototype.id}?${notificationBuild ? `build=${notificationBuild.number}&` : ""}comment=1&notification=${id}`,
        updatePath: `/notifications/${id}`,
        target: { prototypeId: firstPrototype.id, threadId: 1, commentId: 1 },
      })
    }
  }
  let github: SettingsPublicResponse["github"] = {
    state: "not-configured",
    organization: "github",
    version: 0,
    rotation: "idle",
    credentialRevision: 0,
  }
  let copilot: SettingsWorkspaceResponse["copilot"] = { connected: false, connectedBy: null }
  let continuation: SettingsPublicResponse["continuation"] = null
  let enrollmentComplete = false
  let sessionRevoked = false

  function getPublic(): SettingsPublicResponse {
    const session = context.session.read()
    const activeContinuation =
      continuation?.viewerLogin === session.viewer?.login &&
      continuation?.sessionRevision === session.revision
        ? continuation
        : null
    return settingsPublicResponseSchema.parse({
      revision,
      session,
      github,
      enrollmentComplete,
      sessionRevoked,
      continuation: activeContinuation,
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
    const pageSize = 5
    const prototype = context.resources.prototypes.find(
      (entry) => entry.repositoryId === repository?.id,
    )
    const empty = scenario === "empty"
    return settingsWorkspaceResponseSchema.parse({
      ...getPublic(),
      repository,
      welcomeHidden: hiddenWelcome.has(viewer.login),
      analytics: empty ? [] : destinations.filter((entry) => entry.repositoryId === repository?.id),
      grants: empty ? [] : grants.filter((entry) => entry.viewerLogin === viewer.login),
      copilot: session.capabilities.administerHub
        ? copilot
        : { connected: copilot.connected, connectedBy: null },
      administrators: {
        accessDenied: !session.capabilities.administerHub,
        users:
          empty || !session.capabilities.administerHub
            ? []
            : candidates.filter((entry) => administrators.has(entry.login)),
      },
      learnings: empty
        ? []
        : learningRecords.filter((entry) => entry.repositoryId === repository?.id),
      learningRuns: empty ? [] : runs.filter((entry) => entry.repositoryId === repository?.id),
      notifications: {
        items: empty ? [] : filteredNotifications.slice(0, query.limit),
        unreadCount: empty ? 0 : ownNotifications.filter((entry) => !entry.read).length,
        hasMore: !empty && filteredNotifications.length > query.limit,
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
      evidenceAuthor: context.resources.users.find((entry) => entry.login === "mona") ?? null,
      evidencePrototype: prototype ? { id: prototype.id, name: prototype.name } : null,
    })
  }

  function record(
    operation: SettingsOperation["operation"],
    notice: string,
    repositoryId: number | null = null,
    redirect: string | null = null,
  ): SettingsMutationResponse {
    revision += 1
    auditEvents.push({
      id: nextId++,
      createdAt: new Date().toISOString(),
      actor: context.session.read().viewer?.login ?? "octocat (mock session ended)",
      operation,
      repositoryId,
      context: notice,
    })
    return { revision, notice, redirect }
  }

  function requireRepository(repositoryId: number) {
    context.session.requireCapability("manageSharing")
    return context.repositoryRecord(repositoryId)
  }

  function requireInstalledGithub(expectedVersion: number) {
    context.session.requireCapability("administerHub")
    if (github.state !== "installed") {
      throw new MockStoreError(409, "Complete the mock App setup before changing its fixture.")
    }
    if (github.version !== expectedVersion) {
      throw new MockStoreError(409, "The mock App changed. Reload and confirm the current version.")
    }
  }

  function beginAuthorization(operation: NonNullable<typeof continuation>["operation"]) {
    const viewer = context.session.requireCapability("administerHub")
    if (continuation && !getPublic().continuation) continuation = null
    if (continuation) {
      throw new MockStoreError(409, "Finish or cancel the pending mock confirmation first.")
    }
    continuation = {
      id: `mock-continuation-${nextId++}`,
      operation,
      viewerLogin: viewer.login,
      sessionRevision: context.session.read().revision,
    }
    return record(
      operation,
      "A simulated confirmation is pending. No provider authorization has started.",
      null,
      "/settings/authorize",
    )
  }

  function changeAdministrator(userId: number, change: "designate" | "revoke") {
    const viewer = context.session.requireCapability("administerHub")
    const candidate = candidates.find((entry) => entry.id === userId)
    if (!candidate) throw new MockStoreError(404, "That synthetic Hub user does not exist.")
    if (change === "designate") {
      if (administrators.has(candidate.login)) {
        throw new MockStoreError(409, "That synthetic user is already a mock administrator.")
      }
      administrators.add(candidate.login)
    } else {
      if (!administrators.has(candidate.login)) {
        throw new MockStoreError(409, "That synthetic user is not a mock administrator.")
      }
      if (administrators.size === 1) {
        throw new MockStoreError(409, "Keep one administrator in this demonstration fixture.")
      }
      administrators.delete(candidate.login)
      if (viewer.login === candidate.login) context.session.select("owner")
    }
    return candidate
  }

  function mutate(input: SettingsOperation): SettingsMutationResponse {
    switch (input.operation) {
      case "welcome-hide": {
        const viewer = context.session.requireViewer()
        hiddenWelcome.add(viewer.login)
        return record(input.operation, "Welcome is hidden in this mock browser session.")
      }
      case "analytics-save": {
        requireRepository(input.repositoryId)
        const existing = destinations.find(
          (entry) => entry.id === input.destinationId && entry.repositoryId === input.repositoryId,
        )
        if (input.destinationId !== undefined && !existing) {
          throw new MockStoreError(404, "That mock destination no longer exists.")
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
          throw new MockStoreError(409, "That provider already has a destination in this fixture.")
        }
        if (existing && existing.configuration.provider !== input.configuration.provider) {
          throw new MockStoreError(422, "A saved mock destination cannot change providers.")
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
        return record(
          input.operation,
          "Mock destination saved. No credentials were collected and no events were sent.",
          input.repositoryId,
        )
      }
      case "analytics-state": {
        requireRepository(input.repositoryId)
        const index = destinations.findIndex(
          (entry) => entry.id === input.destinationId && entry.repositoryId === input.repositoryId,
        )
        if (index < 0) throw new MockStoreError(404, "That mock destination no longer exists.")
        if (input.state === "disconnected") destinations.splice(index, 1)
        else destinations[index]!.enabled = input.state === "enabled"
        return record(
          input.operation,
          `Mock destination ${input.state}. No external destination changed.`,
          input.repositoryId,
        )
      }
      case "canvas-approve": {
        const repository = requireRepository(input.repositoryId)
        const viewer = context.session.requireViewer()
        if (
          grants.some(
            (entry) => entry.repositoryId === repository.id && entry.viewerLogin === viewer.login,
          )
        ) {
          throw new MockStoreError(409, "This mock repository already has a simulated connection.")
        }
        grants.push({
          id: nextId++,
          repositoryId: repository.id,
          repository: repository.nameWithOwner,
          viewerLogin: viewer.login,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        return record(
          input.operation,
          "Mock canvas connection approved. No canvas or external account was connected.",
          repository.id,
          "/settings/canvas",
        )
      }
      case "canvas-revoke": {
        const viewer = context.session.requireViewer()
        const index = grants.findIndex(
          (entry) => entry.id === input.grantId && entry.viewerLogin === viewer.login,
        )
        if (index < 0) throw new MockStoreError(404, "That mock canvas connection was not found.")
        const grant = grants.splice(index, 1)[0]!
        return record(input.operation, "Mock canvas connection revoked.", grant.repositoryId)
      }
      case "copilot-connect":
      case "copilot-disconnect": {
        context.session.requireCapability("administerHub")
        if ((input.operation === "copilot-connect") === copilot.connected) {
          throw new MockStoreError(409, "The mock Copilot connection already changed.")
        }
        return beginAuthorization(input.operation)
      }
      case "github-setup": {
        context.session.requireCapability("administerHub")
        if (github.state !== "not-configured" && github.state !== "ready") {
          throw new MockStoreError(409, "The mock App is already registered. Review its settings.")
        }
        github = { ...github, state: "ready", organization: input.organization }
        return record(
          input.operation,
          "Mock setup is ready. No bootstrap secret was requested.",
          null,
          "/settings/github/register",
        )
      }
      case "github-register": {
        context.session.requireCapability("administerHub")
        if (github.state !== "ready") {
          throw new MockStoreError(409, "Start the mock setup before registering its fixture.")
        }
        github = { ...github, state: "registered", version: github.version + 1 }
        return record(
          input.operation,
          "Synthetic App registered locally. GitHub was not contacted.",
          null,
          "/settings/github/installed",
        )
      }
      case "github-install": {
        context.session.requireCapability("administerHub")
        if (github.state !== "registered") {
          throw new MockStoreError(409, "Register the mock App before simulating installation.")
        }
        github = { ...github, state: "installed", version: github.version + 1 }
        return record(input.operation, "Mock installation complete. No repository access changed.")
      }
      case "github-credentials": {
        requireInstalledGithub(input.expectedVersion)
        github = {
          ...github,
          credentialRevision: github.credentialRevision + 1,
          version: github.version + 1,
        }
        return record(input.operation, "Fake credential revision advanced. No secrets exist.")
      }
      case "github-rotation": {
        requireInstalledGithub(input.expectedVersion)
        const expected = { start: "idle", retry: "pending", finish: "confirmed" } as const
        if (github.rotation !== expected[input.phase]) {
          throw new MockStoreError(409, "The simulated rotation changed. Review its current step.")
        }
        github = {
          ...github,
          rotation:
            input.phase === "start" ? "pending" : input.phase === "retry" ? "confirmed" : "idle",
          version: github.version + 1,
        }
        return record(
          input.operation,
          `Mock webhook rotation is ${github.rotation}. No webhook or secret was changed.`,
        )
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
        return record(
          input.operation,
          "Mock App configuration reset. Real Apps, sessions and repositories are untouched.",
          null,
          "/settings/github",
        )
      }
      case "admin-add": {
        context.session.requireCapability("administerHub")
        const selected = [...new Set(input.userIds)].map((id) => {
          const candidate = candidates.find((entry) => entry.id === id)
          if (!candidate) throw new MockStoreError(404, "That synthetic Hub user does not exist.")
          if (administrators.has(candidate.login)) {
            throw new MockStoreError(409, "A selected user is already a mock administrator.")
          }
          return candidate
        })
        selected.forEach((candidate) => administrators.add(candidate.login))
        return record(input.operation, "Selected synthetic users added to the mock roster.")
      }
      case "admin-change": {
        const candidate = changeAdministrator(input.userId, input.change)
        return record(
          input.operation,
          `@${candidate.login} ${input.change === "designate" ? "added to" : "removed from"} the mock administrator roster.`,
          null,
          "/settings/admins",
        )
      }
      case "enroll":
        return beginAuthorization("enroll")
      case "authorize":
      case "authorization-cancel": {
        const viewer = context.session.requireCapability("administerHub")
        const pending = getPublic().continuation
        if (!pending || input.continuationId !== pending.id) {
          throw new MockStoreError(409, "This simulated confirmation expired or already finished.")
        }
        continuation = null
        const destination =
          pending.operation === "enroll" ? "/settings/admins" : "/settings/copilot"
        if (input.operation === "authorization-cancel") {
          return record(
            input.operation,
            "Simulated confirmation cancelled. Nothing was connected.",
            null,
            destination,
          )
        }
        if (pending.operation === "enroll") {
          administrators.add("octocat")
          enrollmentComplete = true
          return record(
            input.operation,
            "Octocat's mock enrollment example is complete. No provider identity was checked.",
            null,
            destination,
          )
        }
        copilot = {
          connected: pending.operation === "copilot-connect",
          connectedBy: pending.operation === "copilot-connect" ? viewer.login : null,
        }
        return record(
          input.operation,
          `Copilot simulation ${copilot.connected ? "connected" : "disconnected"}. No token or provider request exists.`,
          null,
          destination,
        )
      }
      case "learning-decide": {
        const repository = requireRepository(input.repositoryId)
        const learning = learningRecords.find(
          (entry) => entry.id === input.learningId && entry.repositoryId === repository.id,
        )
        if (!learning) throw new MockStoreError(404, "That mock learning does not exist.")
        const retiring = input.decision === "retire"
        if (learning.state !== (retiring ? "accepted" : "suggested")) {
          throw new MockStoreError(409, "This mock learning already has a different decision.")
        }
        if (!retiring && input.digest !== `mock:v${learning.version}`) {
          throw new MockStoreError(409, "This suggestion changed. Review it before deciding.")
        }
        if (input.decision !== "accept" && !input.reason) {
          throw new MockStoreError(422, "Explain this mock rejection or retirement.")
        }
        if (
          (input.decision !== "accept" && input.content !== undefined) ||
          (input.decision === "accept" && input.reason !== undefined) ||
          (retiring && input.digest !== undefined)
        ) {
          throw new MockStoreError(422, "Submit only fields belonging to this learning decision.")
        }
        learning.content = input.content ?? learning.content
        learning.state = retiring
          ? "retired"
          : input.decision === "accept"
            ? "accepted"
            : "rejected"
        learning.reason = input.reason ?? null
        learning.decidedBy = context.session.requireViewer().login
        learning.version += 1
        return record(
          input.operation,
          `Mock learning ${learning.state}. No agent or learning provider receives this content.`,
          repository.id,
        )
      }
      case "learning-run":
      case "learning-advance": {
        const repository = requireRepository(input.repositoryId)
        if (!copilot.connected) {
          throw new MockStoreError(
            409,
            "Connect the Copilot simulation before advancing a fake run.",
          )
        }
        const pending = runs.find(
          (entry) => entry.repositoryId === repository.id && entry.state !== "succeeded",
        )
        if (input.operation === "learning-run") {
          if (pending)
            throw new MockStoreError(409, "This repository already has a pending fake run.")
          runs.unshift({
            id: nextId++,
            repositoryId: repository.id,
            startedAt: new Date().toISOString(),
            startedBy: context.session.requireViewer().login,
            state: "queued",
          })
          return record(
            input.operation,
            "Fake learning run queued. No learning work was started.",
            repository.id,
          )
        }
        if (!pending) throw new MockStoreError(409, "There is no pending fake run to advance.")
        pending.state = pending.state === "queued" ? "running" : "succeeded"
        if (pending.state === "succeeded") {
          learningRecords.push({
            id: `mock-learning-${nextId++}`,
            repositoryId: repository.id,
            content: "Keep recovery actions beside the error they resolve.",
            version: 1,
            state: "suggested",
            decidedBy: null,
            reason: null,
          })
        }
        return record(
          input.operation,
          `Fake learning run ${pending.state}. No provider was called.`,
          repository.id,
        )
      }
      case "notification-read": {
        const viewer = context.session.requireViewer()
        const notification = notifications.find(
          (entry) => entry.id === input.notificationId && entry.recipientLogin === viewer.login,
        )
        if (!notification) throw new MockStoreError(404, "That mock notification was not found.")
        if (notification.version !== input.version) {
          throw new MockStoreError(
            409,
            "This notification changed. Refresh the inbox and try again.",
          )
        }
        notification.read = input.read
        notification.version += 1
        return record(
          input.operation,
          `Mock notification marked ${input.read ? "read" : "unread"}.`,
        )
      }
      case "session-revoke": {
        context.session.requireCapability("administerHub")
        continuation = null
        sessionRevoked = true
        context.session.select("signed-out")
        return record(
          input.operation,
          "This mock browser session ended. No real sessions or credentials changed.",
          null,
          "/settings/sessions",
        )
      }
      case "session-cancel":
        context.session.requireCapability("administerHub")
        return {
          revision,
          notice: "Mock session revocation cancelled.",
          redirect: "/settings/audit",
        }
    }
  }

  return {
    getPublic,
    getWorkspace,
    mutate,
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
