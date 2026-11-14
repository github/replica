import { getEventListeners } from "node:events"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import type { getAzureKeyVaultSecret } from "../../../integrations/azure-key-vault/get-secret-value"

const mocks = vi.hoisted(() => ({
  credential: vi.fn<(options: { clientId: string }) => void>(),
  fallbackCredential: vi.fn(),
  getToken: vi.fn(),
  getSecret: vi.fn<typeof getAzureKeyVaultSecret>(),
}))
vi.mock("@azure/identity", () => {
  class FallbackCredential {
    constructor() {
      mocks.fallbackCredential()
      throw new Error("Synthetic credential fallback is prohibited")
    }
  }
  return {
    ManagedIdentityCredential: class {
      getToken = mocks.getToken

      constructor(options: { clientId: string }) {
        mocks.credential(options)
      }
    },
    DefaultAzureCredential: FallbackCredential,
    AzureCliCredential: FallbackCredential,
    EnvironmentCredential: FallbackCredential,
  }
})
vi.mock("../../../integrations/azure-key-vault/get-secret-value", () => ({
  getAzureKeyVaultSecret: mocks.getSecret,
}))

import { loadAzureSecretEnvironment } from "."

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((succeed, fail) => {
    resolve = succeed
    reject = fail
  })
  return { promise, resolve, reject }
}

describe("loadAzureSecretEnvironment()", () => {
  it("validates every destination before creating a credential or starting any retrieval", async () => {
    vi.useFakeTimers()
    const beforeInterrupt = process.listeners("SIGINT")
    const beforeTerminate = process.listeners("SIGTERM")
    const environment = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
        DATABASE_URL: "https://fixture.vault.azure.net/secrets/database",
        SERVICE_API_KEY: "https://fixture.vault.azure.net/secrets/api-key",
      }),
      SERVICE_API_KEY: "",
    }
    const before = { ...environment }

    const failure = await loadAzureSecretEnvironment(environment, "runtime").catch(
      (error: unknown) => error,
    )

    expect(failure).toMatchObject({ name: "AzureSecretStartupError" })
    expect(environment).toEqual(before)
    expect(mocks.fallbackCredential).not.toHaveBeenCalled()
    expect(mocks.credential).not.toHaveBeenCalled()
    expect(mocks.getSecret).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(process.listeners("SIGINT")).toEqual(beforeInterrupt)
    expect(process.listeners("SIGTERM")).toEqual(beforeTerminate)
  })

  it("uses one explicit identity and publishes all resolved values only after every reference succeeds", async () => {
    vi.useFakeTimers()
    const beforeInterrupt = process.listeners("SIGINT")
    const beforeTerminate = process.listeners("SIGTERM")
    const databaseUrl = "https://fixture.vault.azure.net/secrets/database"
    const apiKeyUrl =
      "https://service.vault.azure.net/secrets/api-key/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    const environment: NodeJS.ProcessEnv = {
      AZURE_CLIENT_ID: "ABCDEFAB-1234-5678-9ABC-DEFABCDEFABC",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
        DATABASE_URL: databaseUrl,
        SERVICE_API_KEY: apiKeyUrl,
      }),
      NODE_ENV: "production",
    }
    const before = { ...environment }
    const database = deferred<string>()
    const apiKey = deferred<string>()
    mocks.getSecret.mockImplementation(({ url }) =>
      url === databaseUrl ? database.promise : apiKey.promise,
    )

    const loading = loadAzureSecretEnvironment(environment, "runtime")
    onTestFinished(async () => {
      database.resolve("synthetic-database-url")
      apiKey.resolve("synthetic-api-key")
      await loading.catch(() => {})
    })

    expect(environment).toEqual(before)

    database.resolve("synthetic-database-url")
    await vi.advanceTimersByTimeAsync(0)
    expect(environment).toEqual(before)

    apiKey.resolve("synthetic-api-key")
    await expect(loading).resolves.toBeUndefined()

    expect(environment).toEqual({
      ...before,
      DATABASE_URL: "synthetic-database-url",
      SERVICE_API_KEY: "synthetic-api-key",
    })
    expect(mocks.credential).toHaveBeenCalledExactlyOnceWith({
      clientId: "abcdefab-1234-5678-9abc-defabcdefabc",
    })
    expect(mocks.getSecret).toHaveBeenCalledTimes(2)
    const requests = mocks.getSecret.mock.calls.map(([request]) => request)
    expect(requests.map(({ url }) => url).sort()).toEqual([databaseUrl, apiKeyUrl].sort())
    expect(requests[0]?.credential).toBe(requests[1]?.credential)
    expect(requests[0]?.signal).toBe(requests[1]?.signal)
    expect(getEventListeners(requests[0]!.signal, "abort")).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(process.listeners("SIGINT")).toEqual(beforeInterrupt)
    expect(process.listeners("SIGTERM")).toEqual(beforeTerminate)
  })

  it("retries a transient provision secret failure with the same managed identity before publishing values", async () => {
    vi.useFakeTimers()
    const version = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    const databaseUrl = `https://fixture.vault.azure.net/secrets/database/${version}`
    const migrationUrl = `https://fixture.vault.azure.net/secrets/migration/${version}`
    const runtimeUrl = `https://fixture.vault.azure.net/secrets/runtime/${version}`
    const environment: NodeJS.ProcessEnv = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
        DATABASE_URL: databaseUrl,
        HUB_MIGRATION_PASSWORD: migrationUrl,
        HUB_RUNTIME_PASSWORD: runtimeUrl,
      }),
    }
    const before = { ...environment }
    const transient = new Error("Synthetic Key Vault propagation failure")
    transient.name = "AzureKeyVaultSecretError"
    Object.defineProperty(transient, "retryable", { value: true })
    let databaseAttempts = 0
    mocks.getSecret.mockImplementation(({ url }) => {
      if (url === databaseUrl && databaseAttempts++ === 0) return Promise.reject(transient)
      return Promise.resolve(
        url === databaseUrl
          ? "synthetic-database-url"
          : url === migrationUrl
            ? "synthetic-migration-password"
            : "synthetic-runtime-password",
      )
    })

    const loading = loadAzureSecretEnvironment(environment, "provision")
    await vi.advanceTimersByTimeAsync(500)
    await expect(loading).resolves.toBeUndefined()

    const requests = mocks.getSecret.mock.calls.map(([request]) => request)
    const databaseRequests = requests.filter(({ url }) => url === databaseUrl)
    expect(databaseRequests).toHaveLength(2)
    expect(databaseRequests[0]?.credential).toBe(databaseRequests[1]?.credential)
    expect(requests.every(({ credential }) => credential === databaseRequests[0]?.credential)).toBe(
      true,
    )
    expect(requests.every(({ signal }) => signal === databaseRequests[0]?.signal)).toBe(true)
    expect(environment).toEqual({
      ...before,
      DATABASE_URL: "synthetic-database-url",
      HUB_MIGRATION_PASSWORD: "synthetic-migration-password",
      HUB_RUNTIME_PASSWORD: "synthetic-runtime-password",
    })
    expect(mocks.credential).toHaveBeenCalledExactlyOnceWith({
      clientId: "00000000-0000-0000-0000-000000000001",
    })
    expect(mocks.fallbackCredential).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("bounds repeated secret retrieval failures by the startup deadline without credential fallback", async () => {
    vi.useFakeTimers()
    const beforeInterrupt = process.listeners("SIGINT")
    const beforeTerminate = process.listeners("SIGTERM")
    const environment: NodeJS.ProcessEnv = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
        DATABASE_URL: "https://fixture.vault.azure.net/secrets/database",
      }),
    }
    const before = { ...environment }
    const transient = new Error("Synthetic Key Vault propagation failure")
    transient.name = "AzureKeyVaultSecretError"
    Object.defineProperty(transient, "retryable", { value: true })
    mocks.getSecret.mockRejectedValue(transient)
    let settled = false
    const loading = loadAzureSecretEnvironment(environment, "runtime")
    const outcome = loading.then(
      () => undefined,
      (error: unknown) => {
        settled = true
        return error
      },
    )
    onTestFinished(async () => {
      await outcome
    })

    await vi.advanceTimersByTimeAsync(15_499)
    expect(settled).toBe(false)
    expect(mocks.getSecret.mock.calls.length).toBeGreaterThan(1)
    await vi.advanceTimersByTimeAsync(1)

    expect(await outcome).toMatchObject({ name: "AzureSecretStartupError" })
    expect(settled).toBe(true)
    expect(mocks.getSecret).toHaveBeenCalledTimes(6)
    expect(environment).toEqual(before)
    const attemptsAtDeadline = mocks.getSecret.mock.calls.length
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.getSecret).toHaveBeenCalledTimes(attemptsAtDeadline)
    expect(mocks.credential).toHaveBeenCalledOnce()
    expect(mocks.fallbackCredential).not.toHaveBeenCalled()
    expect(mocks.getSecret.mock.calls.every(([request]) => request.signal.aborted)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(process.listeners("SIGINT")).toEqual(beforeInterrupt)
    expect(process.listeners("SIGTERM")).toEqual(beforeTerminate)
  })

  it("rejects at the deadline even if transport never settles, without applying a late secret", async () => {
    vi.useFakeTimers()
    const beforeInterrupt = process.listeners("SIGINT")
    const beforeTerminate = process.listeners("SIGTERM")
    const environment: NodeJS.ProcessEnv = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
        DATABASE_URL: "https://fixture.vault.azure.net/secrets/database",
      }),
    }
    const before = { ...environment }
    const pending = deferred<string>()
    mocks.getSecret.mockReturnValue(pending.promise)
    let startupSettled = false
    const loading = loadAzureSecretEnvironment(environment, "runtime")
    const outcome = loading.then(
      () => {
        startupSettled = true
      },
      (error: unknown) => {
        startupSettled = true
        return error
      },
    )
    onTestFinished(async () => {
      pending.resolve("synthetic-cleanup-value")
      await outcome
    })
    expect(mocks.getSecret).toHaveBeenCalledTimes(1)
    const signal = mocks.getSecret.mock.calls[0]![0].signal

    await vi.advanceTimersByTimeAsync(29_999)
    expect(startupSettled).toBe(false)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    expect(startupSettled).toBe(true)
    expect(await outcome).toMatchObject({ name: "AzureSecretStartupError" })
    expect(signal.aborted).toBe(true)
    expect(environment).toEqual(before)
    expect(getEventListeners(signal, "abort")).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(process.listeners("SIGINT")).toEqual(beforeInterrupt)
    expect(process.listeners("SIGTERM")).toEqual(beforeTerminate)

    pending.resolve("synthetic-late-database-url")
    await vi.advanceTimersByTimeAsync(0)
    expect(environment).toEqual(before)
  })

  it("refuses every write if a destination becomes defined while references are loading", async () => {
    vi.useFakeTimers()
    const beforeInterrupt = process.listeners("SIGINT")
    const beforeTerminate = process.listeners("SIGTERM")
    const environment: NodeJS.ProcessEnv = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
        DATABASE_URL: "https://fixture.vault.azure.net/secrets/database",
        SERVICE_API_KEY: "https://fixture.vault.azure.net/secrets/api-key",
      }),
    }
    const before = { ...environment }
    const pending = deferred<string>()
    mocks.getSecret.mockImplementation(({ url }) =>
      url.endsWith("/database")
        ? Promise.resolve("synthetic-fetched-database-url")
        : pending.promise,
    )

    const loading = loadAzureSecretEnvironment(environment, "runtime")
    const outcome = loading.catch((error: unknown) => error)
    onTestFinished(async () => {
      pending.resolve("synthetic-cleanup-value")
      await outcome
    })
    await vi.advanceTimersByTimeAsync(0)

    environment.SERVICE_API_KEY = ""
    pending.resolve("synthetic-fetched-api-key")
    const failure = await outcome

    expect(failure).toMatchObject({ name: "AzureSecretStartupError" })
    expect(failure).not.toHaveProperty("cause")
    expect(String(failure)).not.toMatch(/synthetic-fetched-/)
    expect(environment).toEqual({ ...before, SERVICE_API_KEY: "" })
    expect(environment).not.toHaveProperty("DATABASE_URL")
    expect(vi.getTimerCount()).toBe(0)
    expect(process.listeners("SIGINT")).toEqual(beforeInterrupt)
    expect(process.listeners("SIGTERM")).toEqual(beforeTerminate)
  })

  it("aborts outstanding work and leaves even previously resolved destinations untouched after a failure", async () => {
    vi.useFakeTimers()
    const beforeInterrupt = process.listeners("SIGINT")
    const beforeTerminate = process.listeners("SIGTERM")
    const environment: NodeJS.ProcessEnv = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
        DATABASE_URL: "https://fixture.vault.azure.net/secrets/database",
        SERVICE_API_KEY: "https://fixture.vault.azure.net/secrets/api-key",
        WEBHOOK_SECRET: "https://fixture.vault.azure.net/secrets/webhook",
      }),
    }
    const before = { ...environment }
    const failed = deferred<string>()
    const outstanding = deferred<string>()
    void failed.promise.catch(() => {})
    let outstandingAborted = false
    mocks.getSecret.mockImplementation(({ url, signal }) => {
      if (url.endsWith("/database")) return Promise.resolve("synthetic-database-url")
      if (url.endsWith("/api-key")) return failed.promise
      signal.addEventListener(
        "abort",
        () => {
          outstandingAborted = true
          outstanding.reject(new Error("synthetic-aborted-request-token"))
        },
        { once: true },
      )
      return outstanding.promise
    })

    const loading = loadAzureSecretEnvironment(environment, "runtime")
    const outcome = loading.catch((error: unknown) => error)
    onTestFinished(async () => {
      failed.reject(new Error("Synthetic fixture cleanup"))
      outstanding.resolve("synthetic-api-key")
      await outcome
    })
    await Promise.resolve()
    expect(environment).toEqual(before)

    failed.reject(
      new Error("synthetic-sdk-token synthetic-key-vault-value", {
        cause: { secret: "synthetic-private-cause" },
      }),
    )
    const failure = await outcome

    expect(failure).toMatchObject({ name: "AzureSecretStartupError" })
    expect(failure).not.toHaveProperty("cause")
    expect(String(failure)).not.toMatch(/synthetic-/)
    if (mocks.getSecret.mock.calls.some(([request]) => request.url.endsWith("/webhook"))) {
      expect(outstandingAborted).toBe(true)
    }
    expect(mocks.getSecret.mock.calls.every(([request]) => request.signal.aborted)).toBe(true)
    expect(environment).toEqual(before)
    expect(mocks.credential).toHaveBeenCalledTimes(1)
    expect(mocks.fallbackCredential).not.toHaveBeenCalled()
    const requestedUrls = mocks.getSecret.mock.calls.map(([request]) => request.url)
    expect(new Set(requestedUrls).size).toBe(requestedUrls.length)
    expect(vi.getTimerCount()).toBe(0)
    expect(process.listeners("SIGINT")).toEqual(beforeInterrupt)
    expect(process.listeners("SIGTERM")).toEqual(beforeTerminate)
  })

  it("redacts credential-construction failures without falling back or fetching", async () => {
    vi.useFakeTimers()
    const beforeInterrupt = process.listeners("SIGINT")
    const beforeTerminate = process.listeners("SIGTERM")
    const environment = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
        DATABASE_URL: "https://fixture.vault.azure.net/secrets/database",
      }),
    }
    const before = { ...environment }
    const original = new Error("synthetic-identity-token", {
      cause: new Error("synthetic-identity-secret"),
    })
    mocks.credential.mockImplementation(() => {
      throw original
    })

    const failure = await loadAzureSecretEnvironment(environment, "runtime").catch(
      (error: unknown) => error,
    )

    expect(failure).not.toBe(original)
    expect(failure).toMatchObject({ name: "AzureSecretStartupError" })
    expect(failure).not.toHaveProperty("cause")
    expect(String(failure)).not.toMatch(/synthetic-identity-/)
    expect(environment).toEqual(before)
    expect(mocks.credential).toHaveBeenCalledTimes(1)
    expect(mocks.fallbackCredential).not.toHaveBeenCalled()
    expect(mocks.getSecret).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(process.listeners("SIGINT")).toEqual(beforeInterrupt)
    expect(process.listeners("SIGTERM")).toEqual(beforeTerminate)
  })

  it("shares one 30-second budget across references and removes its timer and signal listeners", async () => {
    vi.useFakeTimers()
    const beforeInterrupt = process.listeners("SIGINT")
    const beforeTerminate = process.listeners("SIGTERM")
    const environment: NodeJS.ProcessEnv = {
      AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
        DATABASE_URL: "https://fixture.vault.azure.net/secrets/database",
        SERVICE_API_KEY: "https://fixture.vault.azure.net/secrets/api-key",
      }),
    }
    const before = { ...environment }
    const database = deferred<string>()
    const pending = deferred<string>()
    mocks.getSecret.mockImplementation(({ url, signal }) => {
      if (url.endsWith("/database")) return database.promise
      signal.addEventListener("abort", () => pending.reject(new Error("synthetic-timeout-token")), {
        once: true,
      })
      return pending.promise
    })

    const loading = loadAzureSecretEnvironment(environment, "runtime")
    const outcome = loading.catch((error: unknown) => error)
    onTestFinished(async () => {
      database.resolve("synthetic-database-url")
      pending.resolve("synthetic-cleanup-value")
      await outcome
    })

    await vi.advanceTimersByTimeAsync(20_000)
    database.resolve("synthetic-database-url")
    await vi.advanceTimersByTimeAsync(0)
    const signals = mocks.getSecret.mock.calls.map(([request]) => request.signal)
    expect(signals).toHaveLength(2)
    expect(signals[0]).toBe(signals[1])

    await vi.advanceTimersByTimeAsync(9_999)
    expect(signals.every((signal) => !signal.aborted)).toBe(true)
    expect(environment).toEqual(before)
    await vi.advanceTimersByTimeAsync(1)

    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(await outcome).toMatchObject({ name: "AzureSecretStartupError" })
    expect(environment).toEqual(before)
    expect(mocks.getSecret).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
    expect(process.listeners("SIGINT")).toEqual(beforeInterrupt)
    expect(process.listeners("SIGTERM")).toEqual(beforeTerminate)
  })

  it.each(["SIGINT", "SIGTERM"] as const)(
    "aborts startup on %s even if transport ignores its signal, and cleans up both handlers",
    async (signalName) => {
      vi.useFakeTimers()
      const beforeInterrupt = process.listeners("SIGINT")
      const beforeTerminate = process.listeners("SIGTERM")
      const previousListeners = process.listeners(signalName)
      const environment: NodeJS.ProcessEnv = {
        AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
        AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
          DATABASE_URL: "https://fixture.vault.azure.net/secrets/database",
        }),
      }
      const before = { ...environment }
      const pending = deferred<string>()
      mocks.getSecret.mockReturnValue(pending.promise)

      const loading = loadAzureSecretEnvironment(environment, "runtime")
      const outcome = loading.catch((error: unknown) => error)
      onTestFinished(async () => {
        pending.resolve("synthetic-cleanup-value")
        await outcome
      })
      const listener = process
        .listeners(signalName)
        .find((candidate) => !previousListeners.includes(candidate))
      expect(listener).toBeDefined()

      listener?.(signalName)

      const failure = await outcome
      expect(failure).toMatchObject({ name: "AzureSecretStartupError" })
      expect(failure).not.toHaveProperty("cause")
      expect(mocks.fallbackCredential).not.toHaveBeenCalled()
      expect(mocks.getSecret.mock.calls[0]?.[0].signal.aborted).toBe(true)
      expect(getEventListeners(mocks.getSecret.mock.calls[0]![0].signal, "abort")).toHaveLength(0)
      expect(environment).toEqual(before)
      expect(vi.getTimerCount()).toBe(0)
      expect(process.listeners("SIGINT")).toEqual(beforeInterrupt)
      expect(process.listeners("SIGTERM")).toEqual(beforeTerminate)
    },
  )
})
