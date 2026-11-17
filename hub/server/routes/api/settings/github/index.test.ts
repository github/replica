import { createHash } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createApp } from "../../../../create-app"
import { AdmissionAuthorityChangedError } from "../../../../domains/admission/errors"
import { GitHubProviderRequestError } from "../../../../integrations/github/errors"
import { createLogger } from "../../../../integrations/pino/create-logger"
import type { GitHubSetupRouteDependencies } from "./types.ts"

const origin = "https://hub.example.com"

function dependencies(overrides: Partial<GitHubSetupRouteDependencies> = {}) {
  return {
    applicationOrigin: origin,
    authorize: vi.fn(({ bootstrapSecret }: { bootstrapSecret?: string }) =>
      Promise.resolve(
        bootstrapSecret === "secret"
          ? { allowed: true as const, membershipId: null }
          : { allowed: false as const, requires: "bootstrap" as const },
      ),
    ),
    checkRateLimit: vi.fn(() => Promise.resolve(true)),
    readStatus: () =>
      Promise.resolve({
        status: "incomplete" as const,
        signInEnabled: false,
        settings: [{ key: "GITHUB_CLIENT_SECRET" as const, state: "missing" as const }],
        urls: { homepage: origin, callback: "c", setup: "s", webhook: "w" },
        connectedRepositories: [],
      }),
    testConnection: vi.fn(() =>
      Promise.resolve([{ name: "private_key" as const, result: "fail" as const, detail: "bad" }]),
    ),
    syncRepositories: vi.fn(() => Promise.resolve(["octo/one"])),
    writeTestAudit: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
}

async function start(githubSetup: GitHubSetupRouteDependencies) {
  const server = createServer(createApp({ githubSetup, logger: createLogger({ level: "silent" }) }))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/settings/github`
}

describe("GitHub setup routes", () => {
  it("requires the bootstrap secret before the first administrator exists", async () => {
    const base = await start(dependencies())
    const denied = await fetch(`${base}/status`)
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ requires: "bootstrap" })
    const allowed = await fetch(`${base}/status`, {
      headers: { "x-hub-bootstrap-secret": "secret" },
    })
    expect(allowed.status).toBe(200)
    const body = (await allowed.json()) as { settings: unknown }
    expect(body.settings).toEqual([{ key: "GITHUB_CLIENT_SECRET", state: "missing" }])
    expect(JSON.stringify(body)).not.toContain("secret")
    expect(allowed.headers.get("cache-control")).toContain("no-store")
  })

  it("tests the connection and audits failed checks", async () => {
    const githubSetup = dependencies()
    const base = await start(githubSetup)
    const response = await fetch(`${base}/test`, {
      method: "POST",
      headers: { origin, "x-hub-bootstrap-secret": "secret" },
    })
    expect(response.status).toBe(200)
    expect(githubSetup.writeTestAudit).toHaveBeenCalledWith({
      actorMembershipId: null,
      failedChecks: ["private_key"],
    })
  })

  it("returns connected repository names to an authorized administrator", async () => {
    const session = "admin-session"
    const sessionDigest = createHash("sha256").update(session).digest("hex")
    const githubSetup = dependencies({
      authorize: vi.fn(({ sessionDigest: current }: { sessionDigest?: string }) =>
        Promise.resolve(
          current === sessionDigest
            ? { allowed: true as const, membershipId: "admin" }
            : { allowed: false as const, requires: "administrator" as const },
        ),
      ),
      readStatus: () =>
        Promise.resolve({
          status: "configured",
          signInEnabled: true,
          settings: [],
          urls: { homepage: origin, callback: "c", setup: "s", webhook: "w" },
          connectedRepositories: ["octo/one", "octo/two"],
        }),
    })
    const base = await start(githubSetup)

    const response = await fetch(`${base}/status`, {
      headers: { cookie: `hub_session=${session}` },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      connectedRepositories: ["octo/one", "octo/two"],
    })
  })

  it("refuses repository names when administrator access ends while reading status", async () => {
    const session = "admin-session"
    const sessionDigest = createHash("sha256").update(session).digest("hex")
    let administratorActive = true
    const githubSetup = dependencies({
      authorize: vi.fn(({ sessionDigest: current }: { sessionDigest?: string }) =>
        Promise.resolve(
          administratorActive && current === sessionDigest
            ? { allowed: true as const, membershipId: "admin" }
            : { allowed: false as const, requires: "administrator" as const },
        ),
      ),
      readStatus: async () => {
        await Promise.resolve()
        administratorActive = false
        return {
          status: "configured" as const,
          signInEnabled: true,
          settings: [],
          urls: { homepage: origin, callback: "c", setup: "s", webhook: "w" },
          connectedRepositories: ["octo/private"],
        }
      },
    })
    const base = await start(githubSetup)
    const response = await fetch(`${base}/status`, {
      headers: { cookie: `hub_session=${session}` },
    })

    expect.soft(administratorActive).toBe(false)
    expect.soft(response.status).toBe(403)
    expect(await response.text()).not.toContain("octo/private")
  })

  it("syncs repositories only after the installation check passes", async () => {
    function installed(detail: string) {
      return Promise.resolve([{ name: "installation" as const, result: "pass" as const, detail }])
    }
    const githubSetup = dependencies({ testConnection: vi.fn(() => installed("ok")) })
    const base = await start(githubSetup)
    const headers = { origin, "x-hub-bootstrap-secret": "secret" }
    const synced = (await (await fetch(`${base}/test`, { method: "POST", headers })).json()) as {
      checks: { name: string; result: string; detail: string }[]
    }
    expect(synced.checks[1]).toEqual({
      name: "repositories",
      result: "pass",
      detail: "Hub can read 1 repository: octo/one.",
    })

    expect(githubSetup.syncRepositories).toHaveBeenCalledWith({
      membershipId: null,
      sessionDigest: undefined,
    })

    vi.mocked(githubSetup.syncRepositories).mockRejectedValueOnce(new GitHubProviderRequestError())
    const failed = (await (await fetch(`${base}/test`, { method: "POST", headers })).json()) as {
      checks: { name: string; result: string }[]
    }
    expect(failed.checks[1]).toMatchObject({ name: "repositories", result: "unknown" })
    expect(githubSetup.writeTestAudit).toHaveBeenLastCalledWith({
      actorMembershipId: null,
      failedChecks: ["repositories"],
    })

    vi.mocked(githubSetup.syncRepositories).mockRejectedValueOnce(new Error("database offline"))
    const broken = await fetch(`${base}/test`, { method: "POST", headers })
    expect(broken.status).toBe(500)
    expect(githubSetup.writeTestAudit).toHaveBeenCalledTimes(2)

    const skipped = dependencies()
    await fetch(`${await start(skipped)}/test`, { method: "POST", headers })
    expect(skipped.syncRepositories).not.toHaveBeenCalled()
  })

  it("audits inconclusive checks as failures except the advisory callback URL", async () => {
    const githubSetup = dependencies({
      testConnection: vi.fn(() =>
        Promise.resolve([
          { name: "private_key" as const, result: "pass" as const, detail: "ok" },
          { name: "callback_url" as const, result: "unknown" as const, detail: "advisory" },
          { name: "installation" as const, result: "unknown" as const, detail: "offline" },
        ]),
      ),
    })
    const base = await start(githubSetup)
    await fetch(`${base}/test`, {
      method: "POST",
      headers: { origin, "x-hub-bootstrap-secret": "secret" },
    })
    expect(githubSetup.writeTestAudit).toHaveBeenCalledWith({
      actorMembershipId: null,
      failedChecks: ["installation"],
    })
  })

  it("refuses repository results when setup authority ends during synchronization", async () => {
    const githubSetup = dependencies({
      testConnection: vi.fn(() =>
        Promise.resolve([{ name: "installation" as const, result: "pass" as const, detail: "ok" }]),
      ),
      syncRepositories: vi.fn(() => Promise.reject(new AdmissionAuthorityChangedError())),
    })
    const base = await start(githubSetup)
    const response = await fetch(`${base}/test`, {
      method: "POST",
      headers: { origin, "x-hub-bootstrap-secret": "secret" },
    })
    expect(response.status).toBe(403)
    const body = await response.text()
    expect(JSON.parse(body)).toMatchObject({ requires: "administrator" })
    expect(body).not.toContain("octo/")
    expect(githubSetup.writeTestAudit).not.toHaveBeenCalled()
  })

  it.each([
    {
      change: "administrator access changes to bootstrap",
      before: "administrator",
      after: "bootstrap",
    },
    { change: "bootstrap closes", before: "bootstrap", after: "closed" },
    {
      change: "bootstrap changes to administrator access",
      before: "bootstrap",
      after: "administrator",
    },
  ] as const)(
    "refuses repository names when $change during the audit",
    async ({ before, after }) => {
      const session = "admin-session"
      const sessionDigest = createHash("sha256").update(session).digest("hex")
      let authority: "administrator" | "bootstrap" | "closed" = before
      let changeDuringAudit = false
      let setupAttempts = 3
      const githubSetup = dependencies({
        authorize: vi.fn(
          ({
            sessionDigest: current,
            bootstrapSecret,
          }: {
            sessionDigest?: string
            bootstrapSecret?: string
          }) => {
            if (authority === "administrator" && current === sessionDigest) {
              return Promise.resolve({ allowed: true as const, membershipId: "admin" })
            }
            if (authority === "bootstrap" && bootstrapSecret === "secret") {
              return Promise.resolve({ allowed: true as const, membershipId: null })
            }
            return Promise.resolve({ allowed: false as const, requires: "administrator" as const })
          },
        ),
        checkRateLimit: vi.fn((operation: "github_setup" | "github_test") =>
          Promise.resolve(operation !== "github_setup" || setupAttempts-- > 0),
        ),
        testConnection: vi.fn(() =>
          Promise.resolve([
            { name: "installation" as const, result: "pass" as const, detail: "ok" },
          ]),
        ),
        writeTestAudit: vi.fn(async () => {
          await Promise.resolve()
          if (changeDuringAudit) authority = after
        }),
      })
      const base = await start(githubSetup)
      const headers = {
        origin,
        cookie: `hub_session=${session}`,
        "x-hub-bootstrap-secret": "secret",
      }
      const allowed = await fetch(`${base}/test`, { method: "POST", headers })
      expect(allowed.status).toBe(200)
      expect(await allowed.text()).toContain("octo/one")

      changeDuringAudit = true
      const denied = await fetch(`${base}/test`, { method: "POST", headers })
      expect.soft(authority).toBe(after)
      expect.soft(denied.status).toBe(403)
      expect.soft(await denied.text()).not.toContain("octo/one")

      const next = await fetch(`${base}/status`, { headers })
      expect(next.status).toBe(after === "closed" ? 403 : 200)
    },
  )

  it("does not synchronize repositories when the App and client IDs do not match", async () => {
    const githubSetup = dependencies({
      testConnection: vi.fn(() =>
        Promise.resolve([
          {
            name: "app_identity" as const,
            result: "fail" as const,
            detail: "The client ID does not match.",
          },
          { name: "installation" as const, result: "pass" as const, detail: "Installed." },
        ]),
      ),
    })
    const base = await start(githubSetup)

    const response = await fetch(`${base}/test`, {
      method: "POST",
      headers: { origin, "x-hub-bootstrap-secret": "secret" },
    })

    expect(response.status).toBe(200)
    expect(githubSetup.syncRepositories).not.toHaveBeenCalled()
    expect(githubSetup.writeTestAudit).toHaveBeenCalledWith({
      actorMembershipId: null,
      failedChecks: ["app_identity"],
    })
  })

  it("rejects cross-origin tests, incomplete settings, and rate-limited callers", async () => {
    const githubSetup = dependencies({ testConnection: vi.fn(() => Promise.resolve(null)) })
    const base = await start(githubSetup)
    const headers = { origin, "x-hub-bootstrap-secret": "secret" }
    expect(
      (
        await fetch(`${base}/test`, {
          method: "POST",
          headers: { ...headers, origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403)
    expect((await fetch(`${base}/test`, { method: "POST", headers })).status).toBe(409)
    vi.mocked(githubSetup.checkRateLimit).mockResolvedValue(false)
    expect((await fetch(`${base}/test`, { method: "POST", headers })).status).toBe(429)
    expect(githubSetup.writeTestAudit).not.toHaveBeenCalled()
  })
})
