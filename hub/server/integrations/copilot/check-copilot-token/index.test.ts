import { access } from "node:fs/promises"
import { beforeEach, describe, expect, it, vi } from "vitest"

interface ClientStub {
  getAuthStatus: ReturnType<typeof vi.fn>
  listModels: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

function clientStub(overrides: Partial<ClientStub> = {}): ClientStub {
  return {
    getAuthStatus: vi.fn().mockResolvedValue({ isAuthenticated: true }),
    listModels: vi.fn().mockResolvedValue([]),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

async function loadCheck(client: ClientStub) {
  const CopilotClient = vi.fn(function (options: unknown) {
    return Object.assign(client, { options })
  })
  vi.doMock("@github/copilot-sdk", () => ({ CopilotClient }))
  const { checkCopilotToken } = await import(".")
  return { checkCopilotToken, CopilotClient }
}

async function expectRemoved(home: string) {
  await expect(access(home)).rejects.toMatchObject({ code: "ENOENT" })
}

describe("checkCopilotToken()", () => {
  beforeEach(() => {
    vi.doUnmock("@github/copilot-sdk")
  })

  it("checks an authenticated token with an isolated SDK home and releases every resource", async () => {
    let home = ""
    const client = clientStub({
      start: vi.fn(async function (this: ClientStub & { options: { baseDirectory: string } }) {
        home = this.options.baseDirectory
        await expect(access(home)).resolves.toBeUndefined()
      }),
    })
    const { checkCopilotToken, CopilotClient } = await loadCheck(client)

    await expect(checkCopilotToken("operator-token")).resolves.toBeUndefined()

    expect(CopilotClient).toHaveBeenCalledWith({
      baseDirectory: home,
      gitHubToken: "operator-token",
      logLevel: "error",
      mode: "empty",
      useLoggedInUser: false,
    })
    expect(client.start).toHaveBeenCalledOnce()
    expect(client.getAuthStatus).toHaveBeenCalledOnce()
    expect(client.listModels).toHaveBeenCalledOnce()
    expect(client.stop).toHaveBeenCalledOnce()
    await expectRemoved(home)
  })

  it("reports an unauthenticated SDK session as refused and still cleans up", async () => {
    const client = clientStub({
      getAuthStatus: vi.fn().mockResolvedValue({ isAuthenticated: false }),
    })
    const { checkCopilotToken, CopilotClient } = await loadCheck(client)

    await expect(checkCopilotToken("refused-token")).rejects.toMatchObject({
      reason: "refused",
    })

    expect(client.listModels).not.toHaveBeenCalled()
    expect(client.stop).toHaveBeenCalledOnce()
    await expectRemoved(
      (CopilotClient.mock.results[0]!.value as ClientStub & { options: { baseDirectory: string } })
        .options.baseDirectory,
    )
  })

  it.each([
    ["an authorization error", new Error("401 Unauthorized"), "refused"],
    ["a service error", new Error("service unavailable"), "unavailable"],
  ] as const)("classifies %s and releases the SDK client", async (_case, failure, reason) => {
    const client = clientStub({ listModels: vi.fn().mockRejectedValue(failure) })
    const { checkCopilotToken, CopilotClient } = await loadCheck(client)

    await expect(checkCopilotToken("operator-token")).rejects.toMatchObject({ reason })

    expect(client.stop).toHaveBeenCalledOnce()
    await expectRemoved(
      (CopilotClient.mock.results[0]!.value as ClientStub & { options: { baseDirectory: string } })
        .options.baseDirectory,
    )
  })

  it("times out an unresponsive SDK and releases the client and temporary home", async () => {
    vi.useFakeTimers()
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const client = clientStub({
      start: vi.fn(() => {
        markStarted!()
        return new Promise(() => undefined)
      }),
    })
    const { checkCopilotToken, CopilotClient } = await loadCheck(client)

    const result = expect(checkCopilotToken("operator-token")).rejects.toMatchObject({
      reason: "unavailable",
    })
    await started
    await vi.advanceTimersByTimeAsync(20_000)
    await result

    expect(client.stop).toHaveBeenCalledOnce()
    await expectRemoved(
      (CopilotClient.mock.results[0]!.value as ClientStub & { options: { baseDirectory: string } })
        .options.baseDirectory,
    )
  })

  it("reports an SDK import failure without constructing a client", async () => {
    vi.doMock("@github/copilot-sdk", () => {
      throw new Error("SDK failed to load")
    })
    const { checkCopilotToken } = await import(".")

    await expect(checkCopilotToken("operator-token")).rejects.toEqual(
      expect.objectContaining({
        name: "CopilotTokenCheckError",
        reason: "unavailable",
      }),
    )
  })
})
