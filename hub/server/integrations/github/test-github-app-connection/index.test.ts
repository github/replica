import { generateKeyPairSync, verify } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { testGitHubAppConnection } from "."

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const input = { appId: "12", clientId: "Iv1.abc", installationId: "34", privateKey }

function respond(routes: Record<string, [number, unknown]>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- init is inspected through mock.calls
  return vi.fn((url: URL | RequestInfo, init?: RequestInit) => {
    const href = url instanceof Request ? url.url : url.toString()
    const [status, body] = routes[new URL(href).pathname] ?? [404, {}]
    return Promise.resolve(new Response(JSON.stringify(body), { status }))
  })
}

describe("testGitHubAppConnection", () => {
  it("passes when the App and installation match", async () => {
    const fetch = respond({
      "/app": [200, { id: 12, client_id: "Iv1.abc" }],
      "/app/installations/34": [200, { app_id: 12, suspended_at: null }],
    })
    const checks = await testGitHubAppConnection(input, { fetch })
    expect(checks.map((check) => [check.name, check.result])).toEqual([
      ["private_key", "pass"],
      ["app_identity", "pass"],
      ["installation", "pass"],
      ["callback_url", "unknown"],
    ])
    const headers = fetch.mock.calls[0]?.[1]?.headers as Record<string, string>
    const [header, payload, signature] = headers.Authorization!.replace("Bearer ", "").split(".")
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true)
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toMatchObject({ iss: "12" })
  })

  it("reports a rejected key without checking the installation", async () => {
    const fetch = respond({ "/app": [401, {}] })
    const checks = await testGitHubAppConnection(input, { fetch })
    expect(checks[0]).toMatchObject({ name: "private_key", result: "fail" })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("fails mismatched client IDs and suspended installations", async () => {
    const fetch = respond({
      "/app": [200, { id: 12, client_id: "Iv1.other" }],
      "/app/installations/34": [200, { app_id: 12, suspended_at: "2024-01-01T00:00:00Z" }],
    })
    const checks = await testGitHubAppConnection(input, { fetch })
    expect(checks[1]).toMatchObject({ name: "app_identity", result: "fail" })
    expect(checks[2]).toMatchObject({ name: "installation", result: "fail" })
  })

  it("reports an unknown App identity when GitHub omits its client ID", async () => {
    const fetch = respond({
      "/app": [200, { id: 12 }],
      "/app/installations/34": [200, { app_id: 12, suspended_at: null }],
    })

    const checks = await testGitHubAppConnection(input, { fetch })

    expect(checks[1]).toMatchObject({ name: "app_identity", result: "unknown" })
  })

  it.each([
    "https://github.com/settings/installations/34",
    "https://github.com/organizations/octo-org/settings/installations/34",
  ])("returns the verified installation settings URL %s", async (htmlUrl) => {
    const fetch = respond({
      "/app": [200, { id: 12, client_id: "Iv1.abc" }],
      "/app/installations/34": [200, { app_id: 12, html_url: htmlUrl }],
    })

    const checks = await testGitHubAppConnection(input, { fetch })

    expect(checks[2]).toMatchObject({ name: "installation", result: "pass", settingsUrl: htmlUrl })
  })

  it.each([
    "http://github.com/settings/installations/34",
    "https://example.com/settings/installations/34",
    "https://github.com/settings/installations/35",
    "https://github.com/settings/installations/34?next=https://example.com",
    "https://user@github.com/settings/installations/34",
  ])("does not return an untrusted installation URL %s", async (htmlUrl) => {
    const fetch = respond({
      "/app": [200, { id: 12, client_id: "Iv1.abc" }],
      "/app/installations/34": [200, { app_id: 12, html_url: htmlUrl }],
    })

    const checks = await testGitHubAppConnection(input, { fetch })

    expect(checks[2]).toMatchObject({ name: "installation", result: "pass" })
    expect(checks[2]).not.toHaveProperty("settingsUrl")
  })

  it("does not claim to verify credentials when GitHub returns a server error", async () => {
    const fetch = respond({ "/app": [503, {}] })

    const checks = await testGitHubAppConnection(input, { fetch })

    expect(checks.every((check) => check.result === "unknown")).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("reports unknown results when GitHub is unreachable", async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("offline")))
    const checks = await testGitHubAppConnection(input, { fetch })
    expect(checks.every((check) => check.result === "unknown")).toBe(true)
  })
})
