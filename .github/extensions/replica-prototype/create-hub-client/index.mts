import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"

import { readCanvasRepository } from "../read-canvas-repository/index.mjs"
import { runCommand } from "../run-command/index.mjs"
import { createPrivateStore } from "../private-store/index.mjs"
import { normalizeHubOrigin } from "../normalize-hub-origin/index.mjs"
import { readHubObject } from "../read-hub-object/index.mjs"
import { readHubError } from "../read-hub-error/index.mjs"
import { githubLoginPattern } from "../identity-patterns/index.mjs"
import type { CanvasContext } from "../create-canvas-context/index.mjs"

export type HubContext = Pick<CanvasContext, "repositoryPath"> & {
  target?: { repository: string | null }
}
export type HubClientOptions = { origin?: string; directory?: string }
export type HubClient = ReturnType<typeof createHubClient>
export type HubStatus = Awaited<ReturnType<HubClient["status"]>>
export type RecalledLearnings = {
  text: string
  memories: { id: string; digest: string }[]
}
export type ConnectionScope = { identity?: string }
export type HubRequestOptions = {
  method?: string
  body?: unknown
  token?: string
  interactive?: boolean
  beforeDispatch?: () => void | Promise<void>
  timeoutMs?: number
  connectionScope?: ConnectionScope
  expectedTarget?: { repository: string; branch: string | null }
}
type Credential = {
  origin: string
  repository: string
  token: string
  expiresAt: string
  refreshToken?: string
  connectionId?: unknown
  inactiveAt?: unknown
  invalid?: unknown
  retryAfter?: number
  retryStatus?: number
}
type Pending = {
  repository: string
  origin: string
  deviceCode: string
  userCode: string
  verificationUrl: string
  expiresAt: string
  refreshToken?: string
  retryAfter?: number
  nextPollAt?: number
}
type RequestError = Error & {
  statusCode: number
  code?: unknown
  retryAfter?: number
  rateLimitMessage?: string
  authorization?: { url: string; expiresAt: string }
  registrationReason?: string
}
type StatusOptions = {
  register?: boolean
  expectedTarget?: { repository: string; branch: string }
  connectionScope?: ConnectionScope
}

function connectionViewer(connection: Record<string, unknown>) {
  if (connection.viewerId == null) return {}
  if (
    typeof connection.viewerId !== "number" ||
    !Number.isSafeInteger(connection.viewerId) ||
    connection.viewerId < 1 ||
    typeof connection.viewerLogin !== "string" ||
    !githubLoginPattern.test(connection.viewerLogin)
  )
    throw new Error("Hub returned an invalid connected author.")
  return { viewerId: connection.viewerId, viewerLogin: connection.viewerLogin }
}

function registrationReason(value: unknown) {
  if (value == null) return undefined
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,127}$/.test(value))
    throw new Error("Hub returned an invalid registration reason.")
  return value
}

export function createHubClient(context: HubContext, options: HubClientOptions = {}) {
  const origin = new URL(normalizeHubOrigin(options.origin || process.env.REPLICA_HUB_ORIGIN))
  const directory = options.directory || path.join(os.homedir(), ".config", "replica", "canvas")
  const store = createPrivateStore(directory)

  async function checkout() {
    const [repository, branch, commit] = await Promise.all([
      readCanvasRepository(context),
      runCommand("git", ["branch", "--show-current"], context.repositoryPath),
      runCommand("git", ["rev-parse", "HEAD"], context.repositoryPath),
    ])
    const localRepository =
      repository.local &&
      (origin.hostname === "localhost" ||
        origin.hostname === "127.0.0.1" ||
        origin.hostname.endsWith(".localhost"))
    return {
      repository: localRepository ? repository.repository : repository.githubRepository,
      branch: branch.ok ? branch.stdout.trim() : null,
      commitSha: commit.ok ? commit.stdout.trim() : null,
    }
  }

  function credentialFile(repository: string) {
    const key = createHash("sha256").update(`${origin.origin}\n${repository}`).digest("hex")
    return `${key}.json`
  }

  async function readCredential(repository: string): Promise<Credential | null> {
    let credential = await store.read(credentialFile(repository))
    if (!credential) {
      const identity = await readCanvasRepository(context)
      if (
        identity.githubRepository === repository &&
        identity.legacyRepository &&
        identity.legacyRepository !== repository
      )
        credential = await store.read(credentialFile(identity.legacyRepository))
    }
    if (!credential) return null
    const value = readHubObject(credential)
    if (
      typeof value?.repository !== "string" ||
      value.repository.toLowerCase() !== repository.toLowerCase() ||
      value.origin !== origin.origin ||
      typeof value.token !== "string" ||
      typeof value.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(value.expiresAt)) ||
      (value.refreshToken !== undefined && typeof value.refreshToken !== "string") ||
      (value.retryAfter !== undefined && typeof value.retryAfter !== "number") ||
      (value.retryStatus !== undefined && typeof value.retryStatus !== "number")
    ) {
      throw new Error("Invalid stored canvas credentials.")
    }
    return {
      ...value,
      origin: origin.origin,
      repository,
      token: value.token,
      expiresAt: value.expiresAt,
      refreshToken: value.refreshToken,
      retryAfter: value.retryAfter,
      retryStatus: value.retryStatus,
    }
  }

  async function saveCredential(
    repository: string,
    value: Record<string, unknown>,
    refreshToken?: string,
  ) {
    if (
      typeof value.repository !== "string" ||
      value.repository.toLowerCase() !== repository.toLowerCase() ||
      typeof value.accessToken !== "string" ||
      typeof value.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(value.expiresAt))
    )
      throw new Error("Hub returned invalid repository credentials.")
    await store.write(credentialFile(repository), {
      origin: origin.origin,
      repository,
      token: value.accessToken,
      expiresAt: value.expiresAt,
      refreshToken: refreshToken || undefined,
      connectionId: value.connectionId,
      inactiveAt: value.inactiveAt,
    })
    return readCredential(repository)
  }

  async function hubRequest(
    route: string,
    {
      method = "GET",
      body,
      token,
      interactive = false,
      beforeDispatch,
      timeoutMs = 10_000,
    }: HubRequestOptions = {},
  ) {
    const url = new URL(route, origin)
    if (url.origin !== origin.origin || !url.pathname.startsWith("/api/canvas/")) {
      throw new Error("Invalid Hub API route.")
    }
    await beforeDispatch?.()
    const response = await fetch(url, {
      method,
      redirect: "error",
      headers: {
        Accept: "application/json",
        "X-Replica-Canvas-Version": "1",
        ...(interactive ? { "X-Replica-Canvas-Activity": "interactive" } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const json: unknown = response.status === 204 ? {} : await response.json().catch(() => null)
    const result = readHubObject(json)
    const version = response.headers.get("X-Replica-Canvas-Version")
    if (response.ok && version !== null && version !== "1") {
      throw Object.assign(
        new Error(
          "This Hub does not support the plugin's Canvas interface. Use compatible plugin and Hub releases.",
        ),
        { code: "incompatible_canvas_interface" },
      )
    }
    if (!response.ok) {
      const error: RequestError = Object.assign(
        new Error(
          (typeof result?.error === "string" && result.error) ||
            (Array.isArray(result?.errors) && result.errors.join(", ")) ||
            `Hub returned HTTP ${response.status}.`,
        ),
        { statusCode: response.status, code: result?.code },
      )
      if (
        response.status === 429 &&
        error.code === "rate_limited" &&
        typeof result?.retryAfter === "number" &&
        Number.isInteger(result.retryAfter) &&
        result.retryAfter > 0 &&
        result.retryAfter <= 600 &&
        Array.isArray(result.errors) &&
        result.errors.length === 1 &&
        typeof result.errors[0] === "string" &&
        result.errors[0].length > 0 &&
        result.errors[0].length <= 512
      ) {
        error.retryAfter = result.retryAfter
        error.rateLimitMessage = `Too many requests. No changes were made. Wait ${result.retryAfter} seconds, then try again.`
      }
      if (error.code === "fresh_authorization_required") {
        const challenge = readHubObject(result?.authorization)
        const url =
          typeof challenge?.url === "string" && URL.canParse(challenge.url)
            ? new URL(challenge.url)
            : null
        if (
          !url ||
          url.origin !== origin.origin ||
          !/^\/authorization\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(url.pathname) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          typeof challenge?.expiresAt !== "string" ||
          !Number.isFinite(Date.parse(challenge.expiresAt))
        )
          throw Object.assign(new Error("Hub returned an invalid authorization request."), {
            statusCode: 502,
          })
        error.authorization = { url: url.href, expiresAt: challenge.expiresAt }
      }
      error.registrationReason = registrationReason(result?.registrationReason)
      throw error
    }
    if (!result || typeof result !== "object") throw new Error("Hub returned invalid JSON.")
    return result
  }

  async function connected() {
    const target = await checkout()
    const credential = target.repository ? await credentialFor(target.repository) : null
    return { target, credential }
  }

  function connectionIdentity(credential: Credential) {
    const identity = credential.connectionId ?? credential.refreshToken ?? credential.token
    if (typeof identity !== "string" && typeof identity !== "number")
      throw new Error("Invalid stored canvas credentials.")
    return createHash("sha256").update(String(identity)).digest("hex")
  }

  function checkConnection(credential: Credential | null, scope?: ConnectionScope) {
    if (scope?.identity && (!credential || connectionIdentity(credential) !== scope.identity))
      throw Object.assign(new Error("Hub connection changed. Retrieve comments again."), {
        code: "stale_comment_target",
      })
  }

  async function credentialFor(
    repository: string,
    rejectedToken?: string,
    scope?: ConnectionScope,
  ): Promise<Credential | null> {
    return store.lock(credentialFile(repository), async () => {
      const credential = await readCredential(repository)
      checkConnection(credential, scope)
      if (!credential || credential.invalid) return null
      const expired = Date.parse(credential.expiresAt) <= Date.now()
      const rejected = rejectedToken && credential.token === rejectedToken
      if (!rejected && !expired) return credential
      if (!credential.refreshToken) return null
      if (credential.retryAfter !== undefined && credential.retryAfter > Date.now())
        throw Object.assign(new Error("Hub verification is paused. Try again shortly."), {
          statusCode: credential.retryStatus || 503,
        })
      try {
        const result = await hubRequest("/api/canvas/connection/renewal", {
          method: "POST",
          body: { refresh_token: credential.refreshToken },
        })
        const renewed = await saveCredential(repository, result, credential.refreshToken)
        checkConnection(renewed, scope)
        return renewed
      } catch (caught) {
        const error = readHubError(caught)
        await store.write(credentialFile(repository), {
          ...credential,
          invalid: error.statusCode === 401,
          retryStatus: error.statusCode === 403 ? 403 : 503,
          retryAfter: Date.now() + 30_000,
        })
        throw error
      }
    })
  }

  // Renews a credential off the caller's time, so a later request finds it fresh. credentialFor
  // records a failed renewal on the credential, so nothing here needs to handle it.
  function renewInBackground(repository: string, rejectedToken?: string) {
    credentialFor(repository, rejectedToken).catch(() => {})
  }

  async function authorizedRequest(
    repository: string,
    credential: Credential,
    route: string,
    options: HubRequestOptions = {},
  ) {
    try {
      return await hubRequest(route, { ...options, token: credential.token })
    } catch (caught) {
      const error = readHubError(caught)
      if (error.statusCode !== 401 || !credential.refreshToken) throw error
      const renewed = await credentialFor(repository, credential.token, options.connectionScope)
      if (!renewed) throw error
      return hubRequest(route, { ...options, token: renewed.token })
    }
  }

  function pendingFile(repository: string) {
    return `${credentialFile(repository)}.pairing`
  }

  async function readPending(repository: string): Promise<Pending | null> {
    const stored = await store.read(pendingFile(repository))
    if (!stored) return null
    const pending = readHubObject(stored)
    if (
      !pending ||
      pending.repository !== repository ||
      pending.origin !== origin.origin ||
      typeof pending.deviceCode !== "string" ||
      typeof pending.userCode !== "string" ||
      typeof pending.verificationUrl !== "string" ||
      typeof pending.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(pending.expiresAt)) ||
      (pending.refreshToken != null && typeof pending.refreshToken !== "string") ||
      (pending.retryAfter !== undefined && typeof pending.retryAfter !== "number") ||
      (pending.nextPollAt !== undefined && typeof pending.nextPollAt !== "number")
    )
      throw new Error("Invalid stored canvas approval.")
    return {
      ...pending,
      repository,
      origin: origin.origin,
      deviceCode: pending.deviceCode,
      userCode: pending.userCode,
      verificationUrl: pending.verificationUrl,
      expiresAt: pending.expiresAt,
      refreshToken: typeof pending.refreshToken === "string" ? pending.refreshToken : undefined,
      retryAfter: pending.retryAfter,
      nextPollAt: pending.nextPollAt,
    }
  }

  async function removeCredentials(repository: string) {
    await store.remove(credentialFile(repository))
    const identity = await readCanvasRepository(context)
    if (
      identity.githubRepository === repository &&
      identity.legacyRepository &&
      identity.legacyRepository !== repository
    )
      await store.remove(credentialFile(identity.legacyRepository))
  }

  function publicPairing(pending: Pick<Pending, "verificationUrl" | "userCode">) {
    return {
      verificationUrl: pending.verificationUrl,
      userCode: pending.userCode,
    }
  }

  return {
    origin: origin.origin,
    checkout,
    async connectionKey(repository: string) {
      const credential = await credentialFor(repository)
      return credential ? connectionIdentity(credential) : null
    },
    async status({ register = true, expectedTarget, connectionScope }: StatusOptions = {}): Promise<
      | {
          state: "connected"
          repositoryAuthorized: true
          reviewConnectionId: string
          repository: string
          branch: string
          commitSha: string | null
          prototype: Record<string, unknown>
          registrationReason?: string
          registrationError?: string
        }
      | {
          state: "undiscovered"
          repositoryAuthorized: true
          reviewConnectionId: string
          canPublish: unknown
          viewerLogin: unknown
          viewerId?: number
          repository: string
          branch?: string
          commitSha: string | null
          message?: string
          registrationReason?: string
        }
      | {
          state: "pairing" | "disconnected" | "denied" | "unavailable"
          repository?: string
          branch?: string | null
          commitSha?: string | null
          message?: string
          pairing?: { verificationUrl: string; userCode: string }
        }
    > {
      const target = await checkout()
      if (!target.repository) {
        return {
          state: "unavailable",
          message: "Open a repository with a GitHub origin.",
        }
      }
      const repository = target.repository
      try {
        const credential = await credentialFor(repository, undefined, connectionScope)
        if (!credential) {
          const pending = await readPending(repository)
          if (pending?.refreshToken && Date.parse(pending.expiresAt) <= Date.now()) {
            const result = await this.poll()
            if (result.status === "approved")
              return this.status({ register, expectedTarget, connectionScope })
          }
          const pairing = pending && Date.parse(pending.expiresAt) > Date.now()
          const previous = await readCredential(repository)
          return {
            state: pairing ? "pairing" : "disconnected",
            pairing: pairing ? publicPairing(pending) : undefined,
            repository,
            branch: target.branch,
            commitSha: target.commitSha,
            message:
              previous && !pairing
                ? "The Hub connection expired or was revoked. Approve a new connection."
                : undefined,
          }
        }
        const lookup = (route: string) =>
          register
            ? authorizedRequest(credential.repository, credential, route)
            : this.request(route, {
                expectedTarget: expectedTarget ?? {
                  repository,
                  branch: target.branch,
                },
                connectionScope,
              })
        if (!target.branch) {
          const connection = await lookup("/api/canvas/connection")
          if (
            typeof connection.repository !== "string" ||
            connection.repository.toLowerCase() !== repository.toLowerCase()
          )
            throw new Error("Hub did not verify this repository.")
          return {
            state: "undiscovered",
            repositoryAuthorized: true,
            reviewConnectionId: connectionIdentity(credential),
            canPublish: connection.canPublish,
            viewerLogin: connection.viewerLogin,
            ...connectionViewer(connection),
            repository,
            commitSha: target.commitSha,
            message: "Connected to this repository. Open a named branch for Builds and reviews.",
          }
        }
        let prototype
        try {
          prototype = await lookup(
            `/api/canvas/prototype?branch=${encodeURIComponent(target.branch)}`,
          )
        } catch (caught) {
          const error = readHubError(caught)
          if (error.statusCode !== 404) throw error
          const connection = await lookup("/api/canvas/connection")
          if (
            typeof connection.repository !== "string" ||
            connection.repository.toLowerCase() !== repository.toLowerCase()
          )
            throw new Error("Hub did not verify this repository.", {
              cause: caught,
            })
          return {
            state: "undiscovered",
            repositoryAuthorized: true,
            reviewConnectionId: connectionIdentity(credential),
            canPublish: connection.canPublish,
            viewerLogin: connection.viewerLogin,
            ...connectionViewer(connection),
            repository,
            branch: target.branch,
            commitSha: target.commitSha,
            ...(error.registrationReason
              ? {
                  registrationReason: registrationReason(error.registrationReason),
                }
              : {}),
          }
        }
        let registrationError
        let reason = registrationReason(prototype.registrationReason)
        if (
          register &&
          !prototype.registered &&
          prototype.canEdit &&
          prototype.canRegister &&
          target.commitSha &&
          prototype.branch === target.branch &&
          readHubObject(prototype.build)?.commitSha === target.commitSha
        ) {
          const current = await checkout()
          if (
            current.repository === target.repository &&
            current.branch === target.branch &&
            current.commitSha === target.commitSha
          ) {
            try {
              prototype = await authorizedRequest(
                target.repository,
                credential,
                "/api/canvas/prototype",
                {
                  method: "PATCH",
                  body: {
                    branch: target.branch,
                    automatic: true,
                    commit_sha: target.commitSha,
                  },
                },
              )
            } catch (caught) {
              const error = readHubError(caught)
              if (
                error.statusCode === 401 ||
                (error.statusCode === 403 && !error.registrationReason)
              )
                throw error
              registrationError = `Automatic prototype registration failed: ${error.message}`
              reason = registrationReason(error.registrationReason)
            }
          }
        }
        return {
          state: "connected",
          repositoryAuthorized: true,
          reviewConnectionId: connectionIdentity(credential),
          repository: target.repository,
          branch: target.branch,
          commitSha: target.commitSha,
          prototype,
          ...(reason ? { registrationReason: reason } : {}),
          ...(registrationError ? { registrationError } : {}),
        }
      } catch (caught) {
        const error = readHubError(caught)
        if (error.statusCode === 401) {
          return {
            state: "disconnected",
            repository: target.repository,
            branch: target.branch,
            message: "The Hub connection expired or was revoked.",
          }
        }
        return {
          state: error.statusCode === 403 ? "denied" : "unavailable",
          repository: target.repository,
          branch: target.branch,
          message:
            error.statusCode === 403
              ? "GitHub repository access was denied. Restore access before reconnecting."
              : `Hub verification unavailable: ${error.message}`,
        }
      }
    },
    async pair() {
      const target = await checkout()
      const repository = target.repository
      if (!repository) {
        throw new Error("Open a repository with a GitHub origin before connecting to Hub.")
      }
      return store.lock(credentialFile(repository), async () => {
        const pending = await readPending(repository)
        if (pending && Date.parse(pending.expiresAt) > Date.now()) return publicPairing(pending)
        const credential = await readCredential(repository)
        if (
          credential &&
          !credential.invalid &&
          (credential.refreshToken || Date.parse(credential.expiresAt) > Date.now())
        )
          throw new Error(
            "A saved Hub connection exists. Refresh its status before approving again.",
          )
        const result = await hubRequest("/api/canvas/pairings", {
          method: "POST",
          body: { repository: target.repository, renewable: true },
        }).catch((caught: unknown) => {
          const error = readHubError(caught)
          if (error.statusCode === 404) {
            error.message =
              `Hub ${origin.origin} could not find ${target.repository} for canvas pairing. ` +
              "Use a Hub where this repository is installed and active. " +
              "For a local demo, open its local prototype session instead of the Replica source repository."
          }
          throw error
        })
        if (
          result.refreshToken != null &&
          (typeof result.refreshToken !== "string" ||
            !/^rr_[A-Za-z0-9_-]{43}$/.test(result.refreshToken))
        )
          throw new Error("Hub returned an invalid refresh credential.")
        if (typeof result.verificationUrl !== "string" || typeof result.userCode !== "string")
          throw new Error("Hub returned an invalid pairing URL.")
        const verificationUrl = new URL(result.verificationUrl)
        if (
          verificationUrl.origin !== origin.origin ||
          verificationUrl.username ||
          verificationUrl.password ||
          !verificationUrl.pathname.startsWith("/canvas/pair/") ||
          verificationUrl.search ||
          verificationUrl.hash
        )
          throw new Error("Hub returned an invalid pairing URL.")
        const next = {
          ...result,
          origin: origin.origin,
          repository,
          userCode: result.userCode,
          verificationUrl: verificationUrl.href,
          expiresAt: result.expiresAt || new Date(Date.now() + 10 * 60_000).toISOString(),
        }
        await store.write(pendingFile(repository), next)
        return publicPairing(next)
      })
    },
    async poll() {
      const target = await checkout()
      const repository = target.repository
      if (!repository) throw new Error("The current repository is unavailable.")
      return store.lock(credentialFile(repository), async () => {
        const credential = await readCredential(repository)
        if (credential && !credential.invalid && Date.parse(credential.expiresAt) > Date.now())
          return { status: "approved" }
        const pending = await readPending(repository)
        if (!pending) throw new Error("No pairing is in progress.")
        if (pending.retryAfter !== undefined && pending.retryAfter > Date.now())
          throw new Error("Hub approval verification is paused. Try again shortly.")
        if (pending.nextPollAt !== undefined && pending.nextPollAt > Date.now())
          return { status: "pending" }
        await store.write(pendingFile(pending.repository), {
          ...pending,
          nextPollAt: Date.now() + 3_000,
        })
        try {
          const result = await hubRequest("/api/canvas/pairings/token", {
            method: "POST",
            body: { device_code: pending.deviceCode },
          })
          if (result.status === "expired" && pending.refreshToken) {
            try {
              const recovered = await hubRequest("/api/canvas/connection/renewal", {
                method: "POST",
                body: { refresh_token: pending.refreshToken },
              })
              await saveCredential(pending.repository, recovered, pending.refreshToken)
              await store.remove(pendingFile(pending.repository))
              return { status: "approved" }
            } catch (caught) {
              const error = readHubError(caught)
              if (error.statusCode !== 401) throw error
            }
          }
          if (result.status === "approved") {
            if (
              typeof result.repository !== "string" ||
              result.repository.toLowerCase() !== pending.repository.toLowerCase()
            ) {
              throw new Error("Hub approved a different repository.")
            }
            await saveCredential(pending.repository, result, pending.refreshToken)
          }
          if (result.status !== "pending") await store.remove(pendingFile(pending.repository))
          return { status: result.status }
        } catch (error) {
          await store.write(pendingFile(pending.repository), {
            ...pending,
            retryAfter: Date.now() + 30_000,
          })
          throw error
        }
      })
    },
    async disconnect() {
      const target = await checkout()
      const repository = target.repository
      if (!repository) return
      return store.lock(credentialFile(repository), async () => {
        const credential = await readCredential(repository)
        await store.remove(pendingFile(repository))
        if (!credential) {
          await removeCredentials(repository)
          return
        }
        if (credential.refreshToken) {
          await hubRequest("/api/canvas/connection/renewal", {
            method: "DELETE",
            body: { refresh_token: credential.refreshToken },
          })
        } else {
          try {
            await hubRequest("/api/canvas/connection", {
              method: "DELETE",
              token: credential.token,
            })
          } catch (caught) {
            const error = readHubError(caught)
            if (error.statusCode !== 401) throw error
          }
        }
        await removeCredentials(repository)
      })
    },
    /**
     * The learnings this repository's administrators accepted, through the connection this
     * repository already has, with the ID and content digest of each. It sends Hub nothing about
     * the prompt. Returns null without a usable connection, and no learnings while Learnings is
     * off. It never starts pairing, and never waits for another command's hold on the connection
     * or for a renewal: an expired or refused token is renewed in the background, for the next
     * prompt.
     */
    async recallLearnings({ timeoutMs = 3_000 } = {}): Promise<RecalledLearnings | null> {
      const target = await checkout()
      if (!target.repository) return null
      const credential = await readCredential(target.repository)
      if (!credential || credential.invalid) return null
      if (Date.parse(credential.expiresAt) <= Date.now()) {
        renewInBackground(target.repository)
        return null
      }
      let result
      try {
        result = await hubRequest("/api/canvas/learnings/recall", {
          method: "POST",
          token: credential.token,
          timeoutMs,
        })
      } catch (caught) {
        const error = readHubError(caught)
        if (error.statusCode === 401) renewInBackground(target.repository, credential.token)
        // Hub answers 404 with this code while Learnings is off, when no learnings apply. Any other
        // 404, such as from a Hub without this route, is an error.
        if (error.statusCode === 404 && error.code === "learnings_off")
          return { text: "", memories: [] }
        throw error
      }
      const memories: unknown[] | null = Array.isArray(result.memories) ? result.memories : null
      if (
        typeof result.text !== "string" ||
        !memories?.every((memory): memory is { id: string; digest: string } => {
          const value = readHubObject(memory)
          return typeof value?.id === "string" && typeof value.digest === "string"
        })
      )
        throw new Error("Hub returned invalid learnings.")
      return {
        text: result.text,
        memories: memories.map(({ id, digest }) => ({ id, digest })),
      }
    },
    async activity() {
      const { target, credential } = await connected()
      if (!credential || !target.repository) return
      await authorizedRequest(target.repository, credential, "/api/canvas/connection", {
        method: "PATCH",
      })
    },
    async request(route: string, options: HubRequestOptions = {}) {
      let dispatched = false
      try {
        const target = await checkout()
        const credential = target.repository
          ? await credentialFor(target.repository, undefined, options.connectionScope)
          : null
        if (!credential)
          throw Object.assign(new Error("Connect to Hub first."), {
            statusCode: 401,
          })
        if (!target.branch || !target.repository)
          throw new Error("The current branch is unavailable.")
        const expected = options.expectedTarget
        function changed(value: Awaited<ReturnType<typeof checkout>>) {
          return (
            expected &&
            (value.repository !== expected.repository || value.branch !== expected.branch)
          )
        }
        if (changed(target))
          throw Object.assign(new Error("Checkout changed. Retrieve comments again."), {
            code: "stale_comment_target",
          })
        if (options.connectionScope && !options.connectionScope.identity)
          options.connectionScope.identity = connectionIdentity(credential)
        const repository = target.repository
        async function guard() {
          checkConnection(await readCredential(repository), options.connectionScope)
          if (expected && changed(await checkout()))
            throw Object.assign(new Error("Checkout changed. Retrieve comments again."), {
              code: "stale_comment_target",
            })
        }
        const result = await authorizedRequest(target.repository, credential, route, {
          ...options,
          beforeDispatch: async () => {
            await guard()
            dispatched = true
          },
        })
        if (expected && changed(await checkout()))
          throw Object.assign(
            new Error(
              "Checkout changed during the request. A mutation may have completed; do not retry with a new request ID.",
            ),
            { code: "stale_comment_target" },
          )
        await guard()
        return result
      } catch (caught) {
        const error = readHubError(caught)
        error.deliveryPhase = dispatched ? "after_dispatch" : "before_dispatch"
        throw error
      }
    },
    async subscribe(onChange: () => void, onStop: (error: Error) => void) {
      const status = await this.status()
      if (status.state !== "connected") throw new Error("Connect to a discovered Hub prototype.")
      const { cableUrl, protocol } = await this.request("/api/canvas/cable_ticket", {
        method: "POST",
      })
      const expected = new URL(origin.origin.replace(/^http/, "ws"))
      if (
        typeof cableUrl !== "string" ||
        new URL(cableUrl).origin !== expected.origin ||
        typeof protocol !== "string" ||
        !protocol.startsWith("replica-canvas.")
      ) {
        throw new Error("Hub returned an invalid review connection.")
      }
      const socket = new WebSocket(cableUrl, ["actioncable-v1-json", protocol])
      const identifier = JSON.stringify({
        channel: "ReviewCommentsChannel",
        repositoryId: status.prototype.repositoryId,
        prototypeId: status.prototype.id,
      })
      socket.addEventListener("open", () =>
        socket.send(JSON.stringify({ command: "subscribe", identifier })),
      )
      socket.addEventListener("message", (event) => {
        try {
          const message: unknown = JSON.parse(String(event.data))
          if (message == null) throw new Error("Hub returned an invalid review message.")
          const data = readHubObject(message)
          if (
            data?.identifier === identifier &&
            readHubObject(data.message)?.type === "review_comments_changed"
          )
            onChange()
          if (data?.type === "reject_subscription" && data.identifier === identifier) {
            onStop(new Error("Hub rejected the review subscription."))
            socket.close()
          }
        } catch (error) {
          onStop(readHubError(error))
          socket.close()
        }
      })
      socket.addEventListener("error", () => onStop(new Error("Hub review connection failed.")))
      socket.addEventListener("close", () => onStop(new Error("Hub review connection closed.")))
      return socket
    },
  }
}
