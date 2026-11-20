import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { findGitHubWebhookEvidence } from "../../../repositories/github-webhook-deliveries/find-github-webhook-evidence/index.ts"
import { checkGitHubWebhookCommunication } from "./index.ts"

vi.mock(
  "../../../repositories/github-webhook-deliveries/find-github-webhook-evidence/index.ts",
  () => ({
    findGitHubWebhookEvidence: vi.fn(),
  }),
)

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const input = {
  credentials: { appId: "12", installationId: "34", privateKey },
  applicationOrigin: "https://hub.example",
  githubRepositoryId: 56,
  runId: 7,
}

function delivery(
  overrides: Partial<{
    id: number
    guid: string
    installation_id: number
    repository_id: number
  }> = {},
) {
  return {
    id: 1,
    guid: "delivery-guid",
    delivered_at: "2026-01-01T00:02:00Z",
    status_code: 200,
    event: "workflow_run",
    installation_id: 34,
    repository_id: 56,
    ...overrides,
  }
}

function providerFetch(
  options: {
    commitStatus?: number
    deliveries?: ReturnType<typeof delivery>[]
    deliveryStatus?: number
    nextPage?: boolean
    webhookUrl?: string
  } = {},
) {
  function respond(url: Parameters<typeof globalThis.fetch>[0], init?: RequestInit): Response {
    const requestUrl = new URL(url instanceof Request ? url.url : url.toString())
    const path = requestUrl.pathname
    if (init?.method === "POST") {
      expect(path).toBe("/app/installations/34/access_tokens")
      if (typeof init.body !== "string") throw new Error("Expected a JSON request body")
      const body: unknown = JSON.parse(init.body)
      expect(body).toEqual({
        repository_ids: [56],
        permissions: { actions: "read", contents: "read" },
      })
      return Response.json({ token: "installation-secret" })
    }
    if (path === "/app")
      return Response.json({ id: 12, events: ["workflow_run", "workflow_job", "push", "delete"] })
    if (path === "/app/installations/34") return Response.json({ app_id: 12 })
    if (path === "/app/hook/config")
      return Response.json({
        url: options.webhookUrl ?? "https://hub.example/api/github/webhooks",
        content_type: "json",
        insecure_ssl: "0",
        secret: "webhook-secret",
      })
    if (path === "/app/hook/deliveries") {
      if (options.deliveryStatus)
        return new Response('{"private":"provider body"}', { status: options.deliveryStatus })
      return Response.json(
        options.deliveries ?? [],
        options.nextPage
          ? {
              headers: {
                link: '<https://api.github.com/app/hook/deliveries?per_page=100&cursor=older>; rel="next"',
              },
            }
          : undefined,
      )
    }
    if (path.endsWith("/actions/runs/7"))
      return Response.json({
        id: 7,
        run_attempt: 1,
        path: ".github/workflows/replica.yml",
        event: "push",
        head_branch: "proto/demo",
        head_sha: "a".repeat(40),
        status: "completed",
        conclusion: "success",
        html_url: "https://github.com/o/r/actions/runs/7",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:01:00Z",
        repository: { id: 56 },
      })
    if (path.endsWith(`/commits/${"a".repeat(40)}`))
      return options.commitStatus
        ? new Response("{}", { status: options.commitStatus })
        : Response.json({ sha: "a".repeat(40), author: null })
    throw new Error("Unexpected request")
  }
  return vi.fn<typeof globalThis.fetch>((...args) => Promise.resolve(respond(...args)))
}

describe("checkGitHubWebhookCommunication()", () => {
  it("reports unobserved evidence separately without exposing provider secrets", async () => {
    const fetch = providerFetch({
      webhookUrl: "https://wrong.example/private?secret=hidden",
      deliveryStatus: 403,
    })
    const checks = await checkGitHubWebhookCommunication(input, { fetch })

    expect(JSON.stringify(checks)).not.toMatch(
      /hidden|installation-secret|webhook-secret|provider body/,
    )
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "private_key", result: "pass" }),
        expect.objectContaining({ name: "installation", result: "pass" }),
        expect.objectContaining({ name: "webhook_configuration", result: "fail" }),
        expect.objectContaining({ name: "webhook_events", result: "pass" }),
        expect.objectContaining({ name: "repository_workflow_access", result: "pass" }),
        expect.objectContaining({ name: "delivery_history", result: "fail" }),
        expect.objectContaining({ name: "signed_receipt", result: "unknown" }),
        expect.objectContaining({ name: "run_build_import", result: "unknown" }),
        expect.objectContaining({ name: "delivery_to_run", result: "unknown" }),
        expect.objectContaining({ name: "webhook_recovery", result: "unknown" }),
      ]),
    )
    expect(checks.find(({ name }) => name === "delivery_history")?.detail).toContain("HTTP 403")
  })

  it.each([404, 422])(
    "does not report Contents access as verified after HTTP %s",
    async (status) => {
      const fetch = providerFetch({ commitStatus: status })

      const checks = await checkGitHubWebhookCommunication(input, { fetch })

      expect(checks).toContainEqual(
        expect.objectContaining({ name: "repository_workflow_access", result: "fail" }),
      )
    },
  )

  it("reports a signed receipt and run import without inferring their association or recovery", async () => {
    const database = {} as PrismaClient
    const fetch = providerFetch({ deliveries: [delivery()] })
    vi.mocked(findGitHubWebhookEvidence).mockResolvedValue({
      receipt: { event: "workflow_run", createdAt: new Date("2026-01-01T00:02:00Z") },
      build: { state: "successful", workflowCompletedAt: new Date("2026-01-01T00:03:00Z") },
      redelivery: { state: "succeeded", attempts: 1, failureCode: null },
    })

    const checks = await checkGitHubWebhookCommunication(
      { ...input, deliveryGuid: "delivery-guid", database },
      { fetch },
    )

    expect(findGitHubWebhookEvidence).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ deliveryGuid: "delivery-guid", githubRepositoryId: 56, runId: 7 }),
    )
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "signed_receipt", result: "pass" }),
        expect.objectContaining({ name: "run_build_import", result: "pass" }),
        expect.objectContaining({ name: "delivery_to_run", result: "unknown" }),
        expect.objectContaining({ name: "webhook_recovery", result: "unknown" }),
      ]),
    )
  })

  it.each([{ installation_id: 99 }, { repository_id: 99 }])(
    "does not claim a signed receipt from a different provider scope (%j)",
    async (scope) => {
      const database = {} as PrismaClient
      const fetch = providerFetch({ deliveries: [delivery(scope)] })
      vi.mocked(findGitHubWebhookEvidence).mockResolvedValue({
        receipt: { event: "workflow_run", createdAt: new Date("2026-01-01T00:02:00Z") },
        build: { state: "successful", workflowCompletedAt: new Date("2026-01-01T00:03:00Z") },
        redelivery: { state: "succeeded", attempts: 1, failureCode: null },
      })

      const checks = await checkGitHubWebhookCommunication(
        { ...input, deliveryGuid: "delivery-guid", database },
        { fetch },
      )

      expect(checks).toContainEqual(
        expect.objectContaining({ name: "signed_receipt", result: "unknown" }),
      )
      expect(checks).toContainEqual(
        expect.objectContaining({ name: "delivery_to_run", result: "unknown" }),
      )
      expect(findGitHubWebhookEvidence).not.toHaveBeenCalled()
    },
  )

  it("does not claim a signed receipt when the recorded event differs from the provider delivery", async () => {
    const database = {} as PrismaClient
    const fetch = providerFetch({ deliveries: [delivery()] })
    vi.mocked(findGitHubWebhookEvidence).mockResolvedValue({
      receipt: { event: "push", createdAt: new Date("2026-01-01T00:02:00Z") },
      build: null,
      redelivery: null,
    })

    const checks = await checkGitHubWebhookCommunication(
      { ...input, deliveryGuid: "delivery-guid", database },
      { fetch },
    )

    expect(checks).toContainEqual(
      expect.objectContaining({ name: "signed_receipt", result: "fail" }),
    )
  })

  it("distinguishes an unreadable delivery history from an absent GUID", async () => {
    const database = {} as PrismaClient
    const checks = await checkGitHubWebhookCommunication(
      { ...input, deliveryGuid: "delivery-guid", database },
      { fetch: providerFetch({ deliveryStatus: 403 }) },
    )

    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "signed_receipt",
        result: "unknown",
        detail: "Delivery history could not be read. A signed receipt was not checked.",
      }),
    )
    expect(findGitHubWebhookEvidence).not.toHaveBeenCalled()
  })

  it("distinguishes no GUID from a GUID outside the latest 100 deliveries", async () => {
    const database = {} as PrismaClient
    const fetch = providerFetch({
      deliveries: Array.from({ length: 100 }, (_, index) =>
        delivery({ id: index + 1, guid: `other-${index}` }),
      ),
      nextPage: true,
    })
    vi.mocked(findGitHubWebhookEvidence).mockResolvedValue({
      receipt: null,
      build: null,
      redelivery: null,
    })

    const withoutGuid = await checkGitHubWebhookCommunication({ ...input, database }, { fetch })
    const missingGuid = await checkGitHubWebhookCommunication(
      { ...input, deliveryGuid: "unseen-guid", database },
      { fetch },
    )

    const withoutReceipt = withoutGuid.find(({ name }) => name === "signed_receipt")
    const missingReceipt = missingGuid.find(({ name }) => name === "signed_receipt")
    expect(withoutReceipt).toMatchObject({ result: "unknown" })
    expect(missingReceipt).toMatchObject({ result: "unknown" })
    expect(withoutReceipt?.detail).toMatch(/guid/i)
    expect(withoutReceipt?.detail).toMatch(/not|no|supply|provide|missing|without/i)
    expect(missingReceipt?.detail).toMatch(
      /(?:latest|recent)[^\d]{0,20}100|100.{0,20}latest|100.{0,20}recent/i,
    )
    expect(missingReceipt?.detail).toMatch(/not|n't|outside|absent|no matching/i)
    expect(missingReceipt?.detail).not.toBe(withoutReceipt?.detail)
    const historyCalls = fetch.mock.calls.filter(([url]) => {
      const requestUrl = new URL(url instanceof Request ? url.url : url.toString())
      return requestUrl.pathname === "/app/hook/deliveries"
    })
    expect(historyCalls).toHaveLength(2)
    for (const [url] of historyCalls) {
      const requestUrl = new URL(url instanceof Request ? url.url : url.toString())
      expect(requestUrl.searchParams.get("per_page")).toBe("100")
      expect(requestUrl.searchParams.has("cursor")).toBe(false)
    }
  })
})
