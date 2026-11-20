import { describe, expect, it, vi } from "vitest"

import { createMockStore } from "@application/hub/mocks/create-mock-store"

import { clientAction, clientLoader } from "."

const candidateId = "22222222-3333-4444-8555-666666666666"
const jobId = "33333333-4444-4555-8666-777777777777"

function routeRequest(form: Record<string, string | undefined>) {
  const body = new URLSearchParams()
  for (const [name, value] of Object.entries(form)) {
    if (value !== undefined) body.set(name, value)
  }
  return new Request(new URL("/repositories/2001/learnings", window.location.origin), {
    method: "POST",
    body,
  })
}

describe("settings Learnings route", () => {
  it("requests the decision-model overview only for a current Hub administrator", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const learnings = store.learnings.get("2001")
    if (learnings.accessDenied) throw new Error("The owner must receive repository learnings.")
    let canAdministerHub = false
    const send = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.pathname.endsWith("/learnings")) {
        return Promise.resolve(
          Response.json({
            ...learnings,
            capabilities: { administerHub: canAdministerHub, administerRepository: true },
          }),
        )
      }
      return Promise.resolve(
        Response.json({ error: "Decision runtime is not configured." }, { status: 404 }),
      )
    })

    vi.stubGlobal("fetch", send)
    const request = new Request(new URL("/repositories/2001/learnings", window.location.origin))

    const repositoryOnly = await clientLoader({
      request,
      params: { repositoryId: "2001" },
    } as unknown as Parameters<typeof clientLoader>[0])
    expect(repositoryOnly.decisionModel).toBeNull()
    expect(send).toHaveBeenCalledTimes(1)

    send.mockClear()
    canAdministerHub = true
    const hubAdministrator = await clientLoader({
      request,
      params: { repositoryId: "2001" },
    } as unknown as Parameters<typeof clientLoader>[0])
    expect(hubAdministrator.decisionModel).toEqual({ state: "not-configured" })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it("keeps repository learnings visible when the configured decision runtime is unavailable", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const learnings = store.learnings.get("2001")
    if (learnings.accessDenied) throw new Error("The owner must receive repository learnings.")
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : input)
        return Promise.resolve(
          url.pathname.endsWith("/learnings")
            ? Response.json({
                ...learnings,
                capabilities: { administerHub: true, administerRepository: true },
              })
            : Response.json({ error: "The decision runtime did not respond." }, { status: 503 }),
        )
      }),
    )

    const result = await clientLoader({
      request: new Request(new URL("/repositories/2001/learnings", window.location.origin)),
      params: { repositoryId: "2001" },
    } as unknown as Parameters<typeof clientLoader>[0])

    expect(result.accessDenied).toBe(false)
    expect(result.decisionModel).toEqual({
      state: "unavailable",
      error: "The decision runtime did not respond.",
    })
  })

  it.each([
    {
      label: "preflight conflict",
      response: Response.json({ error: "Evidence changed during preflight." }, { status: 409 }),
      expected: "Evidence changed during preflight.",
    },
    {
      label: "invalid overview",
      response: Response.json({ configuration: null }),
      expected: "The API returned data in an unexpected shape.",
    },
  ])("isolates a $label to the optional decision-model panel", async ({ response, expected }) => {
    const store = createMockStore({ origin: window.location.origin })
    const learnings = store.learnings.get("2001")
    if (learnings.accessDenied) throw new Error("The owner must receive repository learnings.")
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : input)
        return Promise.resolve(
          url.pathname.endsWith("/learnings")
            ? Response.json({
                ...learnings,
                capabilities: { administerHub: true, administerRepository: true },
              })
            : response.clone(),
        )
      }),
    )

    const result = await clientLoader({
      request: new Request(new URL("/repositories/2001/learnings", window.location.origin)),
      params: { repositoryId: "2001" },
    } as unknown as Parameters<typeof clientLoader>[0])

    expect(result.accessDenied).toBe(false)
    expect(result.decisionModel).toEqual({ state: "unavailable", error: expected })
  })

  it.each([
    {
      label: "bounded settings",
      form: {
        _action: "/repositories/2001/learnings/decision-model/settings",
        enabled: "on",
        backend: "customer-runtime",
        maxUpdates: "8",
        maxSeconds: "300",
        monthlyBudgetCredits: "10",
      },
      endpoint: "/api/repositories/2001/decision-model",
      method: "PATCH",
      body: {
        enabled: true,
        backend: "customer-runtime",
        maxUpdates: 8,
        maxSeconds: 300,
        monthlyBudgetCredits: "10",
      },
      response: {
        enabled: true,
        generation: 4,
        backend: "customer-runtime",
        maxUpdates: 8,
        maxSeconds: 300,
        monthlyBudgetCredits: "10",
      },
    },
    {
      label: "confirmed training",
      form: {
        _action: "/repositories/2001/learnings/decision-model/training",
        idempotencyKey: "hub-ui-request-1",
        expectedConfigurationGeneration: "3",
      },
      endpoint: "/api/repositories/2001/decision-model/training-jobs",
      method: "POST",
      body: { idempotencyKey: "hub-ui-request-1", expectedConfigurationGeneration: 3 },
      response: {
        created: true,
        job: {
          id: jobId,
          state: "queued",
          runtimeJobId: null,
          candidateRuntimeId: null,
          failureCode: null,
          createdAt: "2026-11-18T12:05:00Z",
        },
      },
    },
    {
      label: "queued or running cancellation",
      form: {
        _action: `/repositories/2001/learnings/decision-model/training/${jobId}/cancel`,
      },
      endpoint: `/api/repositories/2001/decision-model/training-jobs/${jobId}/cancel`,
      method: "POST",
      body: undefined,
      response: { id: jobId, state: "cancelled" },
    },
    {
      label: "explicit rejection",
      form: {
        _action: `/repositories/2001/learnings/decision-model/candidates/${candidateId}/reject`,
        reason: "Held-out regressions outweigh the gains.",
      },
      endpoint: `/api/repositories/2001/decision-model/candidates/${candidateId}/rejection`,
      method: "POST",
      body: { reason: "Held-out regressions outweigh the gains." },
      response: {
        candidateId,
        rejectedAt: "2026-11-18T12:05:00Z",
      },
    },
    {
      label: "explicit promotion",
      form: {
        _action: `/repositories/2001/learnings/decision-model/candidates/${candidateId}/promote`,
        expectedGeneration: "2",
      },
      endpoint: `/api/repositories/2001/decision-model/candidates/${candidateId}/promotion`,
      method: "POST",
      body: { expectedGeneration: 2 },
      response: {
        candidateId,
        runtimeCandidateId: "candidate-2",
        previousCandidateId: null,
        previousRuntimeCandidateId: null,
        generation: 3,
      },
    },
    {
      label: "explicit rollback",
      form: {
        _action: "/repositories/2001/learnings/decision-model/rollback",
        expectedGeneration: "3",
      },
      endpoint: "/api/repositories/2001/decision-model/rollback",
      method: "POST",
      body: { expectedGeneration: 3 },
      response: {
        candidateId,
        runtimeCandidateId: "candidate-1",
        previousCandidateId: candidateId,
        previousRuntimeCandidateId: "candidate-2",
        generation: 4,
      },
    },
  ])("sends the exact $label mutation", async ({ form, endpoint, method, body, response }) => {
    const send = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(response)))
    vi.stubGlobal("fetch", send)

    const result = await clientAction({
      request: routeRequest(form),
      params: { repositoryId: "2001" },
    } as unknown as Parameters<typeof clientAction>[0])

    expect(result.data.saved).toBe(true)
    expect(send).toHaveBeenCalledOnce()
    const [url, init] = send.mock.calls[0]!
    expect(new URL(url instanceof Request ? url.url : url).pathname).toBe(endpoint)
    expect(init).toMatchObject({ method })
    expect(init?.body == null || typeof init.body === "string").toBe(true)
    expect(init?.body == null ? undefined : JSON.parse(init.body as string)).toEqual(body)
  })

  it("marks a stale promotion generation for refresh instead of reporting success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json(
            { error: "The promoted decision model changed. Refresh and try again." },
            { status: 409 },
          ),
        ),
      ),
    )

    const result = await clientAction({
      request: routeRequest({
        _action: `/repositories/2001/learnings/decision-model/candidates/${candidateId}/promote`,
        expectedGeneration: "2",
      }),
      params: { repositoryId: "2001" },
    } as unknown as Parameters<typeof clientAction>[0])

    expect(result.init?.status).toBe(409)
    expect(result.data).toEqual({
      saved: false,
      error: "The promoted decision model changed. Refresh and try again.",
      revalidate: true,
    })
  })
})
