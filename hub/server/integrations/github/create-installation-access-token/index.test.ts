import { describe, expect, it, vi } from "vitest"

import { createInstallationAccessToken } from "."
import { CopilotCredentialError } from "./errors"

const now = new Date("2026-11-12T18:00:00.000Z")

function successfulResponse(token: string) {
  return new Response(
    JSON.stringify({
      expires_at: "2026-11-12T19:00:00.000Z",
      permissions: { copilot_requests: "read" },
      token,
    }),
    { status: 201, headers: { "content-type": "application/json" } },
  )
}

function successfulInstallationResponse(
  overrides: {
    account?: { login: string; type: string }
    app_id?: number
    id?: number
    permissions?: { copilot_requests: string }
  } = {},
) {
  return new Response(
    JSON.stringify({
      account: { login: "GitHub", type: "Organization" },
      app_id: 123,
      id: 456,
      permissions: { copilot_requests: "read" },
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

describe("createInstallationAccessToken()", () => {
  it("verifies the installation identity before requesting only read-only Copilot Requests permission", async () => {
    const signer = { sign: vi.fn().mockResolvedValue("app-jwt") }
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(successfulInstallationResponse())
      .mockResolvedValueOnce(successfulResponse("token-one"))
    const mintToken = createInstallationAccessToken({
      appId: "123",
      installationId: "456",
      organization: "github",
      signer,
      fetch: request,
      now: () => now,
    })

    await expect(mintToken()).resolves.toEqual({
      expiresAt: new Date("2026-11-12T19:00:00.000Z"),
      token: "token-one",
    })

    expect(signer.sign).toHaveBeenCalledWith({
      appId: "123",
      issuedAt: new Date("2026-11-12T17:59:00.000Z"),
      expiresAt: new Date("2026-11-12T18:09:00.000Z"),
    })
    expect(request.mock.calls[0]).toEqual([
      "https://api.github.com/app/installations/456",
      expect.objectContaining({
        redirect: "error",
        headers: {
          accept: "application/vnd.github+json",
          authorization: "Bearer app-jwt",
          "x-github-api-version": "2022-11-28",
        },
      }),
    ])
    expect(request.mock.calls[1]).toEqual([
      "https://api.github.com/app/installations/456/access_tokens",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ permissions: { copilot_requests: "read" } }),
        redirect: "error",
        headers: {
          accept: "application/vnd.github+json",
          authorization: "Bearer app-jwt",
          "content-type": "application/json",
          "x-github-api-version": "2022-11-28",
        },
      }),
    ])
  })

  it("mints and returns a fresh installation token for every acquisition", async () => {
    const signer = {
      sign: vi.fn().mockResolvedValueOnce("app-jwt-one").mockResolvedValueOnce("app-jwt-two"),
    }
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(successfulInstallationResponse())
      .mockResolvedValueOnce(successfulResponse("token-one"))
      .mockResolvedValueOnce(successfulInstallationResponse())
      .mockResolvedValueOnce(successfulResponse("token-two"))
    const mintToken = createInstallationAccessToken({
      appId: "123",
      installationId: "456",
      organization: "github",
      signer,
      fetch: request,
      now: () => now,
    })

    await expect(mintToken()).resolves.toMatchObject({ token: "token-one" })
    await expect(mintToken()).resolves.toMatchObject({ token: "token-two" })
    expect(signer.sign).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenCalledTimes(4)
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer app-jwt-one",
    )
    expect(new Headers(request.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(
      "Bearer app-jwt-one",
    )
    expect(new Headers(request.mock.calls[2]?.[1]?.headers).get("authorization")).toBe(
      "Bearer app-jwt-two",
    )
    expect(new Headers(request.mock.calls[3]?.[1]?.headers).get("authorization")).toBe(
      "Bearer app-jwt-two",
    )
  })

  it.each([
    ["App ID", { app_id: 124 }],
    ["organization login", { account: { login: "octo-org", type: "Organization" } }],
    ["organization account type", { account: { login: "GitHub", type: "User" } }],
    ["Copilot Requests permission", { permissions: { copilot_requests: "write" } }],
  ])("refuses a mismatched %s before requesting a token", async (_label, overrides) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(successfulInstallationResponse(overrides))
    const mintToken = createInstallationAccessToken({
      appId: "123",
      installationId: "456",
      organization: "github",
      signer: { sign: vi.fn().mockResolvedValue("app-jwt") },
      fetch: request,
      now: () => now,
    })

    await expect(mintToken()).rejects.toMatchObject({ code: "permission_denied" })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each([
    [404, "installation_revoked"],
    [403, "permission_denied"],
    [500, "unavailable"],
  ] as const)("classifies a %s response as %s", async (status, code) => {
    const mintToken = createInstallationAccessToken({
      appId: "123",
      installationId: "456",
      organization: "github",
      signer: { sign: vi.fn().mockResolvedValue("app-jwt") },
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })),
      now: () => now,
    })

    await expect(mintToken()).rejects.toMatchObject({ code })
  })

  it("classifies transport failures as transient unavailability", async () => {
    const mintToken = createInstallationAccessToken({
      appId: "123",
      installationId: "456",
      organization: "github",
      signer: { sign: vi.fn().mockResolvedValue("app-jwt") },
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("network unavailable")),
      now: () => now,
    })

    await expect(mintToken()).rejects.toMatchObject({
      code: "unavailable",
      name: CopilotCredentialError.name,
    })
  })

  it("rejects a token that does not confirm read-only Copilot Requests permission", async () => {
    const mintToken = createInstallationAccessToken({
      appId: "123",
      installationId: "456",
      organization: "github",
      signer: { sign: vi.fn().mockResolvedValue("app-jwt") },
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(successfulInstallationResponse())
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              expires_at: "2026-11-12T19:00:00.000Z",
              permissions: { copilot_requests: "write" },
              token: "overprivileged-token",
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
        ),
      now: () => now,
    })

    await expect(mintToken()).rejects.toMatchObject({ code: "permission_denied" })
  })

  it("does not let one concurrent failure poison another acquisition", async () => {
    const signer = { sign: vi.fn().mockResolvedValue("app-jwt") }
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(successfulInstallationResponse())
      .mockResolvedValueOnce(successfulResponse("independent-token"))
    const mintToken = createInstallationAccessToken({
      appId: "123",
      installationId: "456",
      organization: "github",
      signer,
      fetch: request,
      now: () => now,
    })

    const results = await Promise.allSettled([mintToken(), mintToken()])

    expect(results[0]).toMatchObject({
      status: "rejected",
      reason: { code: "unavailable" },
    })
    expect(results[1]).toEqual({
      status: "fulfilled",
      value: {
        expiresAt: new Date("2026-11-12T19:00:00.000Z"),
        token: "independent-token",
      },
    })
    expect(signer.sign).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenCalledTimes(3)
  })
})
