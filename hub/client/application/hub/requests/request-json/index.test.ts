import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { workspaceResponseSchema } from "../../contracts"
import { ApiContractError } from "../api-contract-error"
import { ApiRequestError } from "../api-request-error"

import { requestJson } from "."

describe("requestJson()", () => {
  it("reports an HTTP failure instead of substituting mock data", async () => {
    vi.stubEnv("MODE", "development")
    const url = new URL("https://hub.example.test/api/workspace")
    const server = setupServer(
      http.get(url.href, () =>
        HttpResponse.json({ error: "Workspace is temporarily unavailable." }, { status: 503 }),
      ),
    )
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())

    const request = requestJson(url, workspaceResponseSchema)

    await expect(request).rejects.toBeInstanceOf(ApiRequestError)
    await expect(request).rejects.toMatchObject({
      status: 503,
      message: "Workspace is temporarily unavailable.",
    })
  })

  it.each(["invalid JSON", "invalid schema"])(
    "reports %s rather than a successful empty workspace",
    async (failure) => {
      vi.stubEnv("MODE", "development")
      const url = new URL("https://hub.example.test/api/workspace")
      const server = setupServer(
        http.get(url.href, () =>
          failure === "invalid JSON"
            ? new HttpResponse("{not-json", {
                headers: { "Content-Type": "application/json" },
              })
            : HttpResponse.json({ viewer: null, repositories: [] }),
        ),
      )
      server.listen({ onUnhandledRequest: "error" })
      onTestFinished(() => server.close())

      await expect(requestJson(url, workspaceResponseSchema)).rejects.toBeInstanceOf(
        ApiContractError,
      )
    },
  )

  it("forwards cancellation to an in-flight native request", async () => {
    vi.stubEnv("MODE", "development")
    const url = new URL("https://hub.example.test/api/workspace")
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const server = setupServer(
      http.get(url.href, ({ request }) => {
        receivedSignal = request.signal
        controller.abort()
        return HttpResponse.json({
          viewer: { id: "octocat", login: "octocat", name: null, avatarUrl: null },
          repositories: [],
        })
      }),
    )
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())

    await expect(
      requestJson(url, workspaceResponseSchema, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(receivedSignal?.aborted).toBe(true)
  })
})
