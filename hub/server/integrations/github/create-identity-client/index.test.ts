import { createHash, generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { createGitHubIdentityClient } from "."

function requestUrl(input: Parameters<typeof globalThis.fetch>[0]) {
  return new URL(input instanceof Request ? input.url : input)
}

describe("createGitHubIdentityClient()", () => {
  it("binds GitHub authorization to the configured callback and PKCE verifier", () => {
    const client = createGitHubIdentityClient("https://hub.example.test")
    const url = new URL(
      client.authorize(
        {
          appId: "1",
          installationId: "7",
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
        installationId: "7",
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
    const fetch = vi.fn<typeof globalThis.fetch>((url) => {
      const path = requestUrl(url).pathname
      if (path.endsWith("/installation")) return Promise.resolve(Response.json({ id: 8 }))
      if (path.endsWith("/access_tokens")) {
        return Promise.resolve(Response.json({ token: "synthetic-installation-token" }))
      }
      return Promise.resolve(Response.json({ permission: "admin", user: { id: 99 } }))
    })
    vi.stubGlobal("fetch", fetch)
    const client = createGitHubIdentityClient("https://hub.example.test")

    await expect(
      client.permission(
        {
          appId: "1",
          installationId: "7",
          clientId: "synthetic-client",
          clientSecret: "synthetic-secret",
          privateKey,
        },
        { providerId: "42", login: "mona", name: null, avatarUrl: null },
        "team",
        "prototype",
      ),
    ).rejects.toMatchObject({ status: 403, code: "identity_mismatch" })
    expect(fetch.mock.calls.map(([url]) => requestUrl(url).pathname)).toEqual([
      "/app/installations/7/access_tokens",
      "/repos/team/prototype/collaborators/mona/permission",
    ])
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer synthetic-installation-token",
    })
  })

  it("admits a collaborator from a later repository page of only the configured installation", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    })
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      full_name: `team/repository-${index}`,
    }))
    const fetch = vi.fn<typeof globalThis.fetch>((url) => {
      const path = requestUrl(url)
      if (path.pathname === "/app/installations") {
        return Promise.resolve(Response.json([{ id: 8 }]))
      }
      if (path.pathname.endsWith("/access_tokens")) {
        return Promise.resolve(Response.json({ token: "synthetic-configured-token" }))
      }
      if (path.pathname === "/installation/repositories") {
        return Promise.resolve(
          Response.json({
            repositories:
              path.searchParams.get("page") === "1"
                ? firstPage
                : [{ full_name: "team/accessible" }],
          }),
        )
      }
      return Promise.resolve(
        Response.json({
          permission: path.pathname.includes("/accessible/") ? "write" : "none",
          user: { id: 42 },
        }),
      )
    })
    vi.stubGlobal("fetch", fetch)
    const client = createGitHubIdentityClient("https://hub.example.test")

    await expect(
      client.admitted(
        {
          appId: "1",
          installationId: "7",
          clientId: "synthetic-client",
          clientSecret: "synthetic-secret",
          privateKey,
        },
        { providerId: "42", login: "mona", name: null, avatarUrl: null },
      ),
    ).resolves.toBe(true)
    const paths = fetch.mock.calls.map(([url]) => {
      const parsed = requestUrl(url)
      return `${parsed.pathname}${parsed.search}`
    })
    expect(paths.filter((path) => path.startsWith("/app/"))).toEqual([
      "/app/installations/7/access_tokens",
    ])
    expect(paths.filter((path) => path.startsWith("/installation/"))).toEqual([
      "/installation/repositories?per_page=100&page=1",
      "/installation/repositories?per_page=100&page=2",
    ])
    for (const [url, options] of fetch.mock.calls) {
      if (!requestUrl(url).pathname.startsWith("/app/")) {
        expect(options?.headers).toMatchObject({
          Authorization: "Bearer synthetic-configured-token",
        })
      }
    }
  })

  it("does not admit a user through another installation when the configured installation has no repositories", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    })
    const fetch = vi.fn<typeof globalThis.fetch>((url) => {
      const path = requestUrl(url).pathname
      if (path === "/app/installations") return Promise.resolve(Response.json([{ id: 8 }]))
      if (path.endsWith("/access_tokens")) {
        return Promise.resolve(Response.json({ token: "synthetic-token" }))
      }
      if (path === "/installation/repositories") {
        return Promise.resolve(Response.json({ repositories: [] }))
      }
      throw new Error("Unexpected GitHub request")
    })
    vi.stubGlobal("fetch", fetch)
    const client = createGitHubIdentityClient("https://hub.example.test")

    await expect(
      client.admitted(
        {
          appId: "1",
          installationId: "7",
          clientId: "synthetic-client",
          clientSecret: "synthetic-secret",
          privateKey,
        },
        { providerId: "42", login: "mona", name: null, avatarUrl: null },
      ),
    ).resolves.toBe(false)
    expect(fetch.mock.calls.map(([url]) => requestUrl(url).pathname)).toEqual([
      "/app/installations/7/access_tokens",
      "/installation/repositories",
    ])
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
          installationId: "7",
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

  it("denies repository access missing from the configured installation without discovering another", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    })
    const fetch = vi.fn<typeof globalThis.fetch>((url) => {
      const path = requestUrl(url).pathname
      if (path.endsWith("/installation")) return Promise.resolve(Response.json({ id: 8 }))
      if (path.endsWith("/access_tokens")) {
        return Promise.resolve(Response.json({ token: "synthetic-configured-token" }))
      }
      return Promise.resolve(Response.json({ message: "Not Found" }, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetch)
    const client = createGitHubIdentityClient("https://hub.example.test")

    await expect(
      client.permission(
        {
          appId: "1",
          installationId: "7",
          clientId: "synthetic-client",
          clientSecret: "synthetic-secret",
          privateKey,
        },
        { providerId: "42", login: "mona", name: null, avatarUrl: null },
        "outside",
        "repository",
      ),
    ).resolves.toBe("none")
    expect(fetch.mock.calls.map(([url]) => requestUrl(url).pathname)).toEqual([
      "/app/installations/7/access_tokens",
      "/repos/outside/repository/collaborators/mona/permission",
    ])
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer synthetic-configured-token",
    })
  })

  it("fails closed for admission and repository permission when the configured installation is removed", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    })
    const credentials = {
      appId: "1",
      installationId: "7",
      clientId: "synthetic-client",
      clientSecret: "synthetic-secret",
      privateKey,
    }
    const profile = { providerId: "42", login: "mona", name: null, avatarUrl: null }
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ message: "Not Found" }, { status: 404 })),
    )
    vi.stubGlobal("fetch", fetch)
    const client = createGitHubIdentityClient("https://hub.example.test")

    for (const operation of [
      () => client.admitted(credentials, profile),
      () => client.permission(credentials, profile, "team", "prototype"),
    ]) {
      fetch.mockClear()
      await expect(operation()).rejects.toMatchObject({ status: 503 })
      expect(fetch.mock.calls.map(([url]) => requestUrl(url).pathname)).toEqual([
        "/app/installations/7/access_tokens",
      ])
    }
  })
})
