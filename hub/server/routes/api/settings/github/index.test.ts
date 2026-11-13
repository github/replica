import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createApp } from "../../../../create-app"
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
    const githubSetup = dependencies({
      authorize: vi.fn(() => Promise.resolve({ allowed: true as const, membershipId: "admin" })),
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

    const response = await fetch(`${base}/status`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      connectedRepositories: ["octo/one", "octo/two"],
    })
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

    vi.mocked(githubSetup.syncRepositories).mockRejectedValueOnce(new Error("offline"))
    const failed = (await (await fetch(`${base}/test`, { method: "POST", headers })).json()) as {
      checks: { name: string; result: string }[]
    }
    expect(failed.checks[1]).toMatchObject({ name: "repositories", result: "unknown" })

    const skipped = dependencies()
    await fetch(`${await start(skipped)}/test`, { method: "POST", headers })
    expect(skipped.syncRepositories).not.toHaveBeenCalled()
  })

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
