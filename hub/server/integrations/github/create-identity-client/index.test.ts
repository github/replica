import { createHash, generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { createGitHubIdentityClient } from "."

describe("createGitHubIdentityClient()", () => {
  it("binds GitHub authorization to the configured callback and PKCE verifier", () => {
    const client = createGitHubIdentityClient("https://hub.example.test")
    const url = new URL(
      client.authorize(
        {
          appId: "1",
          clientId: "synthetic-client",
          clientSecret: "synthetic-secret",
          privateKey: "not needed to construct an authorization URL",
        },
        "synthetic-state",
        "synthetic-verifier",
      ),
    )

    expect(url.origin).toBe("https://github.com")
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://hub.example.test/api/auth/github/callback",
    )
    expect(url.searchParams.get("state")).toBe("synthetic-state")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update("synthetic-verifier").digest("base64url"),
    )
    expect(url.href).not.toContain("synthetic-secret")
  })

  it("uses the user token only to identify the permanent GitHub account", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "synthetic-user-token" }))
      .mockResolvedValueOnce(
        Response.json({
          id: 42,
          login: "mona",
          name: null,
          avatar_url: "https://avatars.example.test/mona",
        }),
      )
    vi.stubGlobal("fetch", fetch)
    const client = createGitHubIdentityClient("https://hub.example.test")

    const profile = await client.identify(
      {
        appId: "1",
        clientId: "synthetic-client",
        clientSecret: "synthetic-secret",
        privateKey: "unused",
      },
      "synthetic-code",
      "synthetic-verifier",
    )

    expect(profile).toEqual({
      providerId: "42",
      login: "mona",
      name: null,
      avatarUrl: "https://avatars.example.test/mona",
    })
    expect(fetch.mock.calls[0]?.[1]?.body).toContain('"code_verifier":"synthetic-verifier"')
    expect(fetch.mock.calls[1]?.[0]).toBe("https://api.github.com/user")
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer synthetic-user-token",
    })
  })

  it("rejects a collaborator response for a different immutable GitHub identity", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    })
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: 7 }))
      .mockResolvedValueOnce(Response.json({ token: "synthetic-installation-token" }))
      .mockResolvedValueOnce(Response.json({ permission: "admin", user: { id: 99 } }))
    vi.stubGlobal("fetch", fetch)
    const client = createGitHubIdentityClient("https://hub.example.test")

    await expect(
      client.permission(
        {
          appId: "1",
          clientId: "synthetic-client",
          clientSecret: "synthetic-secret",
          privateKey,
        },
        { providerId: "42", login: "mona", name: null, avatarUrl: null },
        "team",
        "prototype",
      ),
    ).rejects.toMatchObject({ status: 403, code: "identity_mismatch" })
    expect(fetch.mock.calls[2]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer synthetic-installation-token",
    })
  })

  it("does not turn a GitHub outage into a repository permission", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    })
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline")))
    const client = createGitHubIdentityClient("https://hub.example.test")

    await expect(
      client.permission(
        {
          appId: "1",
          clientId: "synthetic-client",
          clientSecret: "synthetic-secret",
          privateKey,
        },
        { providerId: "42", login: "mona", name: null, avatarUrl: null },
        "team",
        "prototype",
      ),
    ).rejects.toMatchObject({ status: 503, code: "github_unavailable" })
  })
})
