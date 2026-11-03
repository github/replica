import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { workspaceResponseSchema } from "../contracts"

const { startMockApi } = vi.hoisted(() => ({
  startMockApi: vi.fn<() => Promise<void>>(),
}))

vi.mock("../mocks/browser", () => ({ startMockApi }))

describe("bootstrapHubApi()", () => {
  it("holds concurrent API requests until the single mock startup finishes", async () => {
    vi.stubEnv("DEV", true)
    vi.stubEnv("MODE", "mock")
    let finishStartup: (() => void) | undefined
    startMockApi.mockReturnValue(
      new Promise<void>((resolve) => {
        finishStartup = resolve
      }),
    )
    const workspace = {
      viewer: { id: "octocat", login: "octocat", name: null, avatarUrl: null },
      repositories: [],
    }
    const url = new URL("https://hub.example.test/api/workspace")
    const receiveRequest = vi.fn(() => HttpResponse.json(workspace))
    const server = setupServer(http.get(url.href, receiveRequest))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const { requestJson } = await import("../requests/request-json")

    const requests = [
      requestJson(url, workspaceResponseSchema),
      requestJson(url, workspaceResponseSchema),
    ]
    await vi.waitFor(() => expect(startMockApi).toHaveBeenCalledOnce())
    expect(receiveRequest).not.toHaveBeenCalled()
    if (!finishStartup) throw new Error("Mock startup did not expose its completion.")
    finishStartup()

    await expect(Promise.all(requests)).resolves.toEqual([workspace, workspace])
    expect(startMockApi).toHaveBeenCalledOnce()
    expect(receiveRequest).toHaveBeenCalledTimes(2)
  })

  it.each([
    { label: "real development mode", mode: "development", dev: true },
    { label: "a production build", mode: "mock", dev: false },
  ])("never starts mocking in $label", async ({ mode, dev }) => {
    vi.stubEnv("DEV", dev)
    vi.stubEnv("MODE", mode)
    const { bootstrapHubApi } = await import(".")

    await bootstrapHubApi()

    expect(startMockApi).not.toHaveBeenCalled()
  })

  it("retries failed mock startup once for concurrent callers without leaking requests", async () => {
    vi.stubEnv("DEV", true)
    vi.stubEnv("MODE", "mock")
    const failure = new Error("The mock worker could not start.")
    let finishRetry: (() => void) | undefined
    const retryReady = new Promise<void>((resolve) => {
      finishRetry = resolve
    })
    onTestFinished(() => finishRetry?.())
    startMockApi.mockRejectedValueOnce(failure).mockReturnValueOnce(retryReady)
    const workspace = {
      viewer: { id: "octocat", login: "octocat", name: null, avatarUrl: null },
      repositories: [],
    }
    const url = new URL("https://hub.example.test/api/workspace")
    const receiveRequest = vi.fn(() => HttpResponse.json(workspace))
    const server = setupServer(http.get(url.href, receiveRequest))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const { requestJson } = await import("../requests/request-json")
    const { bootstrapHubApi } = await import(".")

    await expect(requestJson(url, workspaceResponseSchema)).rejects.toBe(failure)
    expect(receiveRequest).not.toHaveBeenCalled()
    expect(startMockApi).toHaveBeenCalledOnce()

    const retries = Promise.allSettled([bootstrapHubApi(), bootstrapHubApi()])
    await vi.waitFor(() => expect(startMockApi).toHaveBeenCalledTimes(2))
    expect(receiveRequest).not.toHaveBeenCalled()
    if (!finishRetry) throw new Error("The retry did not expose its completion.")
    finishRetry()

    await expect(retries).resolves.toEqual([
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: undefined },
    ])
    await expect(requestJson(url, workspaceResponseSchema)).resolves.toEqual(workspace)
    expect(receiveRequest).toHaveBeenCalledOnce()
    expect(startMockApi).toHaveBeenCalledTimes(2)
  })
})
