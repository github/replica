import { describe, expect, it, onTestFinished, vi } from "vitest"

const mocks = vi.hoisted(() => ({ unexpectedCredential: vi.fn() }))
vi.mock("@azure/identity", () => {
  class UnexpectedCredential {
    constructor() {
      mocks.unexpectedCredential()
      throw new Error("Synthetic credential fallback is prohibited")
    }
  }
  return {
    ManagedIdentityCredential: UnexpectedCredential,
    DefaultAzureCredential: UnexpectedCredential,
    AzureCliCredential: UnexpectedCredential,
    EnvironmentCredential: UnexpectedCredential,
  }
})

import { getAzureKeyVaultSecret } from "."

describe("getAzureKeyVaultSecret()", () => {
  it("awaits the vault-audience token before requesting the exact secret version with no redirects", async () => {
    const url = `https://fixture.vault.azure.net/secrets/Runtime-Database/${"A".repeat(32)}`
    const signal = new AbortController().signal
    let issueToken!: (token: { token: string; expiresOnTimestamp: number }) => void
    const getToken = vi.fn(
      () =>
        new Promise<{ token: string; expiresOnTimestamp: number }>((resolve) => {
          issueToken = resolve
        }),
    )
    const fetchSecret = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ value: "synthetic-database-url" }), { status: 200 }),
      )
    vi.stubGlobal("fetch", fetchSecret)

    const retrieval = getAzureKeyVaultSecret({ url, credential: { getToken }, signal })
    void retrieval.catch(() => {})
    onTestFinished(async () => {
      issueToken?.({
        token: "synthetic-bearer-token",
        expiresOnTimestamp: Date.now() + 60_000,
      })
      await retrieval.catch(() => {})
    })

    expect(getToken).toHaveBeenCalledExactlyOnceWith("https://vault.azure.net/.default", {
      abortSignal: signal,
    })
    expect(fetchSecret).not.toHaveBeenCalled()

    issueToken({ token: "synthetic-bearer-token", expiresOnTimestamp: Date.now() + 60_000 })

    expect(await retrieval).toBe("synthetic-database-url")
    expect(fetchSecret).toHaveBeenCalledTimes(1)
    const [input, options] = fetchSecret.mock.calls[0]!
    const request = new Request(input, options)
    expect(request.url).toBe(`${url}?api-version=7.4`)
    expect(request.method).toBe("GET")
    expect(request.headers.get("Authorization")).toBe("Bearer synthetic-bearer-token")
    expect(["error", "manual"]).toContain(request.redirect)
    expect(options?.signal ?? (input instanceof Request ? input.signal : undefined)).toBe(signal)
    expect(mocks.unexpectedCredential).not.toHaveBeenCalled()
  })

  it("preserves an unversioned URL and leaves an empty string for consuming configuration validation", async () => {
    const url = "https://fixture.vault.azure.net/secrets/optional-setting"
    const signal = new AbortController().signal
    const credential = {
      getToken: vi.fn().mockResolvedValue({
        token: "synthetic-bearer-token",
        expiresOnTimestamp: Date.now() + 60_000,
      }),
    }
    const fetchSecret = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ value: "" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchSecret)

    expect(await getAzureKeyVaultSecret({ url, credential, signal })).toBe("")
    expect(fetchSecret).toHaveBeenCalledTimes(1)
    const [input, options] = fetchSecret.mock.calls[0]!
    expect(new Request(input, options).url).toBe(`${url}?api-version=7.4`)
  })

  it.each([
    "https://synthetic-user:synthetic-password@fixture.vault.azure.net/secrets/database",
    "https://other.example/secrets/database",
    "https://fixture.vault.azure.net/secrets/database?token=synthetic-query-token",
  ])("validates direct integration calls before obtaining a token", async (url) => {
    const credential = { getToken: vi.fn() }
    const fetchSecret = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchSecret)

    const failure = await getAzureKeyVaultSecret({
      url,
      credential,
      signal: new AbortController().signal,
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({ name: "AzureKeyVaultSecretError" })
    expect(failure).not.toHaveProperty("cause")
    expect(String(failure)).not.toMatch(/synthetic-|other\.example|fixture\.vault/)
    expect(credential.getToken).not.toHaveBeenCalled()
    expect(fetchSecret).not.toHaveBeenCalled()
  })

  it.each([null, { token: "", expiresOnTimestamp: 1 }])(
    "does not fetch a secret or try another credential when managed identity returns no token",
    async (token) => {
      const credential = { getToken: vi.fn().mockResolvedValue(token) }
      const fetchSecret = vi.fn<typeof fetch>()
      vi.stubGlobal("fetch", fetchSecret)

      await expect(
        getAzureKeyVaultSecret({
          url: "https://fixture.vault.azure.net/secrets/database",
          credential,
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ name: "AzureKeyVaultSecretError" })
      expect(credential.getToken).toHaveBeenCalledTimes(1)
      expect(fetchSecret).not.toHaveBeenCalled()
      expect(mocks.unexpectedCredential).not.toHaveBeenCalled()
    },
  )

  it("replaces token-provider exceptions rather than preserving their messages or causes", async () => {
    const original = new Error("synthetic-token-provider-secret", {
      cause: { token: "synthetic-provider-token" },
    })
    const credential = { getToken: vi.fn().mockRejectedValue(original) }
    const fetchSecret = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchSecret)

    const failure = await getAzureKeyVaultSecret({
      url: "https://fixture.vault.azure.net/secrets/database",
      credential,
      signal: new AbortController().signal,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBe(original)
    expect(failure).toMatchObject({ name: "AzureKeyVaultSecretError" })
    expect(failure).not.toHaveProperty("cause")
    expect(String(failure)).not.toMatch(/synthetic-token-provider-secret|synthetic-provider-token/)
    expect(fetchSecret).not.toHaveBeenCalled()
    expect(credential.getToken).toHaveBeenCalledTimes(1)
    expect(mocks.unexpectedCredential).not.toHaveBeenCalled()
  })

  it.each([201, 302, 403])(
    "rejects HTTP %i without accepting its secret-shaped body, following redirects, or retrying",
    async (status) => {
      const credential = {
        getToken: vi.fn().mockResolvedValue({
          token: "synthetic-bearer-token",
          expiresOnTimestamp: Date.now() + 60_000,
        }),
      }
      const fetchSecret = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ value: "synthetic-rejected-body-secret" }), {
          status,
          headers: { Location: "https://other.example/collect-synthetic-token" },
        }),
      )
      vi.stubGlobal("fetch", fetchSecret)

      const failure = await getAzureKeyVaultSecret({
        url: "https://fixture.vault.azure.net/secrets/database",
        credential,
        signal: new AbortController().signal,
      }).catch((error: unknown) => error)

      expect(failure).toMatchObject({ name: "AzureKeyVaultSecretError" })
      expect(failure).not.toHaveProperty("cause")
      expect(String(failure)).not.toMatch(/synthetic-|other\.example/)
      expect(credential.getToken).toHaveBeenCalledTimes(1)
      expect(fetchSecret).toHaveBeenCalledTimes(1)
      const [input, options] = fetchSecret.mock.calls[0]!
      expect(["error", "manual"]).toContain(new Request(input, options).redirect)
      expect(mocks.unexpectedCredential).not.toHaveBeenCalled()
    },
  )

  it.each([null, ["synthetic-body-secret"], { token: "synthetic-body-token" }, { value: 42 }])(
    "requires a JSON object with a string secret value",
    async (body) => {
      const credential = {
        getToken: vi.fn().mockResolvedValue({
          token: "synthetic-bearer-token",
          expiresOnTimestamp: Date.now() + 60_000,
        }),
      }
      const fetchSecret = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
      vi.stubGlobal("fetch", fetchSecret)

      const failure = await getAzureKeyVaultSecret({
        url: "https://fixture.vault.azure.net/secrets/database",
        credential,
        signal: new AbortController().signal,
      }).catch((error: unknown) => error)

      expect(failure).toMatchObject({ name: "AzureKeyVaultSecretError" })
      expect(failure).not.toHaveProperty("cause")
      expect(String(failure)).not.toMatch(/synthetic-body-secret|synthetic-body-token/)
      expect(fetchSecret).toHaveBeenCalledTimes(1)
    },
  )

  it.each(["transport", "JSON"] as const)(
    "redacts secret-bearing %s exceptions without retrying",
    async (stage) => {
      const original = new Error("synthetic-transport-token synthetic-response-secret", {
        cause: new Error("synthetic-private-cause"),
      })
      const credential = {
        getToken: vi.fn().mockResolvedValue({
          token: "synthetic-bearer-token",
          expiresOnTimestamp: Date.now() + 60_000,
        }),
      }
      const fetchSecret = vi.fn<typeof fetch>()
      if (stage === "transport") {
        fetchSecret.mockRejectedValue(original)
      } else {
        const response = new Response('{"value":"synthetic-invalid-json', { status: 200 })
        vi.spyOn(response, "json").mockRejectedValue(original)
        fetchSecret.mockResolvedValue(response)
      }
      vi.stubGlobal("fetch", fetchSecret)

      const failure = await getAzureKeyVaultSecret({
        url: "https://fixture.vault.azure.net/secrets/database",
        credential,
        signal: new AbortController().signal,
      }).catch((error: unknown) => error)

      expect(failure).not.toBe(original)
      expect(failure).toMatchObject({ name: "AzureKeyVaultSecretError" })
      expect(failure).not.toHaveProperty("cause")
      expect(String(failure)).not.toMatch(/synthetic-/)
      expect(credential.getToken).toHaveBeenCalledTimes(1)
      expect(fetchSecret).toHaveBeenCalledTimes(1)
      expect(mocks.unexpectedCredential).not.toHaveBeenCalled()
    },
  )

  it("does not obtain a token after cancellation", async () => {
    const controller = new AbortController()
    controller.abort(new Error("synthetic-abort-secret"))
    const credential = { getToken: vi.fn() }
    const fetchSecret = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchSecret)

    const failure = await getAzureKeyVaultSecret({
      url: "https://fixture.vault.azure.net/secrets/database",
      credential,
      signal: controller.signal,
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({ name: "AzureKeyVaultSecretError" })
    expect(String(failure)).not.toContain("synthetic-abort-secret")
    expect(credential.getToken).not.toHaveBeenCalled()
    expect(fetchSecret).not.toHaveBeenCalled()
  })

  it("does not return a secret when cancellation occurs while decoding the response", async () => {
    const controller = new AbortController()
    const credential = {
      getToken: vi.fn().mockResolvedValue({
        token: "synthetic-bearer-token",
        expiresOnTimestamp: Date.now() + 60_000,
      }),
    }
    const response = new Response(null, { status: 200 })
    vi.spyOn(response, "json").mockImplementation(() => {
      controller.abort(new Error("synthetic-abort-token"))
      return Promise.resolve({ value: "synthetic-late-secret" })
    })
    const fetchSecret = vi.fn<typeof fetch>().mockResolvedValue(response)
    vi.stubGlobal("fetch", fetchSecret)

    const failure = await getAzureKeyVaultSecret({
      url: "https://fixture.vault.azure.net/secrets/database",
      credential,
      signal: controller.signal,
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({ name: "AzureKeyVaultSecretError" })
    expect(String(failure)).not.toMatch(/synthetic-abort-token|synthetic-late-secret/)
    expect(fetchSecret).toHaveBeenCalledTimes(1)
  })
})
