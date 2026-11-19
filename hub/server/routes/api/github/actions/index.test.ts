import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createApp } from "../../../../create-app"
import { createLogger } from "../../../../integrations/pino/create-logger"
import type { GitHubActionsRouteDependencies } from "./types"

const run = {
  githubRepositoryId: 7,
  repository: "octo/prototype",
  branchName: "main",
  commitSha: "a".repeat(40),
  runId: 11,
  runAttempt: 1,
}

async function push(
  path: "builds" | "screenshots",
  overrides: Partial<GitHubActionsRouteDependencies> = {},
  {
    authorization = "Bearer token",
    contentType = "application/zip",
    bytes = Buffer.from("zip-bytes"),
  }: { authorization?: string | null; contentType?: string; bytes?: Buffer } = {},
) {
  const mocks = {
    verifyToken: vi.fn(() => Promise.resolve({ status: "verified" as const, run })),
    receiveBuild: vi.fn(() => Promise.resolve({ status: "imported" as const, buildId: "b1" })),
    receiveScreenshots: vi.fn(() => Promise.resolve({ status: "attached" as const })),
  }
  const githubActions: GitHubActionsRouteDependencies = { ...mocks, ...overrides }
  const server = createServer(
    createApp({ githubActions, logger: createLogger({ level: "silent" }) }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(() => void server.close())
  const { port } = server.address() as AddressInfo
  const headers: Record<string, string> = { "content-type": contentType }
  if (authorization !== null) headers.authorization = authorization
  const response = await fetch(`http://127.0.0.1:${port}/api/github/actions/${path}`, {
    method: "POST",
    headers,
    body: Buffer.from(bytes),
  })
  return {
    status: response.status,
    body: (await response.json()) as { error?: string; message?: string },
    mocks,
  }
}

describe("POST /api/github/actions", () => {
  it("rejects missing tokens without verifying or importing", async () => {
    const { status, mocks } = await push("builds", {}, { authorization: null })
    expect(status).toBe(401)
    expect(mocks.verifyToken).not.toHaveBeenCalled()
    expect(mocks.receiveBuild).not.toHaveBeenCalled()
  })

  it.each([
    [{ status: "invalid" as const }, 401],
    [{ status: "forbidden" as const, reason: "Pull request runs cannot publish." }, 403],
  ])("refuses unverified runs before importing", async (result, expected) => {
    const { status, body, mocks } = await push("screenshots", {
      verifyToken: vi.fn(() => Promise.resolve(result)),
    })
    expect(status).toBe(expected)
    expect(body.message).toBeTruthy()
    expect(mocks.receiveScreenshots).not.toHaveBeenCalled()
  })

  it("requires a ZIP body", async () => {
    const { status, mocks } = await push("builds", {}, { contentType: "text/plain" })
    expect(status).toBe(415)
    expect(mocks.receiveBuild).not.toHaveBeenCalled()
  })

  it("passes the verified run and uploaded bytes to the import", async () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80])
    const { status, mocks } = await push("builds", {}, { bytes })
    expect(status).toBe(201)
    expect(mocks.verifyToken).toHaveBeenCalledWith("token")
    expect(mocks.receiveBuild).toHaveBeenCalledWith(run, bytes)
  })

  it("passes authenticated screenshot bytes without requiring a browser session", async () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xfe])
    const { status, mocks } = await push("screenshots", {}, { bytes })
    expect(status).toBe(200)
    expect(mocks.receiveScreenshots).toHaveBeenCalledWith(run, bytes)
  })

  it("rejects an invalid token before parsing its body", async () => {
    const { status, mocks } = await push(
      "builds",
      { verifyToken: vi.fn(() => Promise.resolve({ status: "invalid" as const })) },
      { contentType: "application/json", bytes: Buffer.from("{invalid-json") },
    )
    expect(status).toBe(401)
    expect(mocks.receiveBuild).not.toHaveBeenCalled()
  })

  it.each([
    [{ status: "unchanged" as const, buildId: "b1" }, 200],
    [{ status: "failed" as const, buildId: "b1", reason: "dist/index.html is missing." }, 422],
    [{ status: "unknown-repository" as const }, 404],
    [{ status: "rejected" as const, reason: "A newer workflow run owns this Build." }, 409],
    [{ status: "unavailable" as const }, 503],
  ])("maps Build outcomes so the action knows whether to retry", async (result, expected) => {
    const { status } = await push("builds", {
      receiveBuild: vi.fn(() => Promise.resolve(result)),
    })
    expect(status).toBe(expected)
  })

  it.each([
    [{ status: "attached" as const }, 200],
    [{ status: "invalid" as const, reason: "screenshots.json is invalid." }, 422],
    [{ status: "not-ready" as const }, 409],
    [{ status: "digest-mismatch" as const }, 409],
  ])("maps screenshot outcomes", async (result, expected) => {
    const { status } = await push("screenshots", {
      receiveScreenshots: vi.fn(() => Promise.resolve(result)),
    })
    expect(status).toBe(expected)
  })

  it("hides unexpected import errors behind a retryable 500", async () => {
    const { status, body } = await push("builds", {
      receiveBuild: vi.fn(() => Promise.reject(new Error("GitHub token secret"))),
    })
    expect(status).toBe(500)
    expect(JSON.stringify(body)).not.toContain("secret")
  })
})
