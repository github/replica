import { describe, expect, it, vi } from "vitest"

import { createDecisionRuntimeClient } from "."

const tasksetDigest = `sha256:${"a".repeat(64)}`
const questionDigest = `sha256:${"b".repeat(64)}`

function credentialProvider(token = "runtime-secret") {
  return {
    configurationDigest: "configuration-digest",
    key: "customer-runtime",
    getCredential: vi.fn().mockResolvedValue({
      token,
      expiresAt: new Date(Date.now() + 60_000),
    }),
  }
}

describe("createDecisionRuntimeClient()", () => {
  it.each([
    "http://runtime.example.test",
    "https://user:password@runtime.example.test",
    "https://runtime.example.test?token=secret",
  ])("rejects the unsafe runtime URL %s", (baseUrl) => {
    expect(() =>
      createDecisionRuntimeClient({ baseUrl, credentialProvider: credentialProvider() }),
    ).toThrow("HTTPS URL without credentials")
  })

  it("acquires a short-lived credential for the runtime origin without copying it into taskset data", async () => {
    const bytes = new TextEncoder().encode('{"private":"taskset"}')
    const provider = credentialProvider()
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "taskset-1", tasksetDigest }), {
        headers: { "content-type": "application/json" },
      }),
    )
    const client = createDecisionRuntimeClient({
      baseUrl: "https://runtime.example.test/control/",
      credentialProvider: provider,
      fetch,
    })

    await client.transferTaskset({
      bytes,
      idempotencyKey: "transfer:repository-1:task-1",
      questionDigest,
      tasksetDigest,
    })

    expect(provider.getCredential).toHaveBeenCalledWith(
      expect.objectContaining({ audience: "https://runtime.example.test" }),
    )
    const [url, init] = fetch.mock.calls[0]!
    const requestedUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url
    const headers = new Headers(init?.headers)
    expect(requestedUrl).toBe(
      `https://runtime.example.test/v1/tasksets/${tasksetDigest.slice("sha256:".length)}`,
    )
    expect(init?.method).toBe("PUT")
    expect(init?.body).toEqual(bytes)
    expect(headers.get("authorization")).toBe("Bearer runtime-secret")
    expect(headers.get("content-type")).toBe("application/vnd.replica.decision-taskset")
    expect(headers.get("idempotency-key")).toBe("transfer:repository-1:task-1")
    expect(headers.get("x-replica-question-digest")).toBe(questionDigest)
    expect(requestedUrl).not.toContain("runtime-secret")
    if (!(init?.body instanceof Uint8Array)) throw new Error("Expected taskset bytes.")
    expect(new TextDecoder().decode(init.body)).not.toContain("runtime-secret")
  })

  it("rejects an expired credential before sending private data", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const provider = credentialProvider()
    provider.getCredential.mockResolvedValue({
      token: "expired-secret",
      expiresAt: new Date(Date.now() - 1),
    })
    const client = createDecisionRuntimeClient({
      baseUrl: "https://runtime.example.test",
      credentialProvider: provider,
      fetch,
    })

    await expect(
      client.transferTaskset({
        bytes: new Uint8Array([1, 2, 3]),
        idempotencyKey: "transfer-1",
        questionDigest,
        tasksetDigest,
      }),
    ).rejects.toMatchObject({ code: "authentication_failed" })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("submits the reserved credit limit with the bounded training job", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "job-1",
          state: "queued",
          tasksetDigest,
        }),
      ),
    )
    const client = createDecisionRuntimeClient({
      baseUrl: "https://runtime.example.test",
      credentialProvider: credentialProvider(),
      fetch,
    })

    await client.submitTraining({
      backend: "customer-gpu",
      maxUpdates: 8,
      maxSeconds: 300,
      maxCredits: "12.5",
      tasksetId: "taskset-1",
      tasksetDigest,
      idempotencyKey: "training-1",
    })

    const [, init] = fetch.mock.calls[0]!
    if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.")
    expect(init.body).toContain('"maxCredits":"12.5"')
  })

  it.each([
    [401, "authentication_failed"],
    [409, "conflict"],
    [429, "rate_limited"],
    [503, "unavailable"],
  ] as const)("maps HTTP %s to the typed %s failure", async (status, code) => {
    const client = createDecisionRuntimeClient({
      baseUrl: "https://runtime.example.test",
      credentialProvider: credentialProvider(),
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { code: "provider_code" } }), { status }),
        ),
    })

    await expect(client.getTrainingJob("job-1")).rejects.toMatchObject({
      name: "DecisionRuntimeError",
      code,
      message: "The decision runtime rejected the request (provider_code).",
    })
  })

  it("returns a typed invalid-response failure for malformed success data", async () => {
    const client = createDecisionRuntimeClient({
      baseUrl: "https://runtime.example.test",
      credentialProvider: credentialProvider(),
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ state: "running" }))),
    })

    await expect(client.getTrainingJob("job-1")).rejects.toMatchObject({
      name: "DecisionRuntimeError",
      code: "invalid_response",
    })
  })

  it("stops reading an unbounded response after two MiB", async () => {
    const client = createDecisionRuntimeClient({
      baseUrl: "https://runtime.example.test",
      credentialProvider: credentialProvider(),
      fetch: vi.fn().mockResolvedValue(new Response("x".repeat(2 * 1024 * 1024 + 1))),
    })

    await expect(client.getTrainingJob("job-1")).rejects.toMatchObject({
      code: "invalid_response",
      message: "The decision runtime returned an oversized response.",
    })
  })
})
