import { describe, expect, it } from "vitest"

import { http, stubHubFetch } from "@/test/stub-hub-fetch"
import { workspaceResponseSchema } from "@application/hub/contracts"

import { ApiContractError } from "../api-contract-error"
import { ApiRequestError } from "../api-request-error"
import { requestJson } from "."

describe("requestJson()", () => {
  it("reports an HTTP failure instead of substituting mock data", async () => {
    const url = new URL("https://hub.example.test/api/workspace")
    stubHubFetch(
      http.get(url.href, () =>
        Response.json({ error: "Workspace is temporarily unavailable." }, { status: 503 }),
      ),
    )

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
      const url = new URL("https://hub.example.test/api/workspace")
      stubHubFetch(
        http.get(url.href, () =>
          failure === "invalid JSON"
            ? new Response("{not-json", {
                headers: { "Content-Type": "application/json" },
              })
            : Response.json({ viewer: null, repositories: [] }),
        ),
      )

      await expect(requestJson(url, workspaceResponseSchema)).rejects.toBeInstanceOf(
        ApiContractError,
      )
    },
  )

  it("forwards cancellation to an in-flight fetch", async () => {
    const url = new URL("https://hub.example.test/api/workspace")
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    stubHubFetch(
      http.get(url.href, ({ request }) => {
        receivedSignal = request.signal
        controller.abort()
        return Response.json({
          viewer: { id: "octocat", login: "octocat", name: null, avatarUrl: null },
          repositories: [],
        })
      }),
    )

    await expect(
      requestJson(url, workspaceResponseSchema, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(receivedSignal?.aborted).toBe(true)
  })
})
