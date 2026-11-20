import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { checkGitHubWebhookCommunication } from "./index.ts"

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })

describe("checkGitHubWebhookCommunication()", () => {
  it("separates App auth, webhook configuration, installation reads, and unobserved signed receipt", async () => {
    function respond(url: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) {
      const path = new URL(url instanceof Request ? url.url : url).pathname
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
          url: "https://wrong.example/private?secret=hidden",
          content_type: "json",
          insecure_ssl: "0",
          secret: "webhook-secret",
        })
      if (path === "/app/hook/deliveries")
        return new Response('{"private":"provider body"}', { status: 403 })
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
        return Response.json({ sha: "a".repeat(40), author: null })
      throw new Error("Unexpected request")
    }
    const fetch = vi.fn<typeof globalThis.fetch>((...args) => Promise.resolve(respond(...args)))
    const checks = await checkGitHubWebhookCommunication(
      {
        credentials: { appId: "12", installationId: "34", privateKey },
        applicationOrigin: "https://hub.example",
        githubRepositoryId: 56,
        runId: 7,
      },
      { fetch },
    )

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "private_key", result: "pass" }),
        expect.objectContaining({ name: "installation", result: "pass" }),
        expect.objectContaining({ name: "webhook_configuration", result: "fail" }),
        expect.objectContaining({ name: "webhook_events", result: "pass" }),
        expect.objectContaining({ name: "repository_workflow_access", result: "pass" }),
        expect.objectContaining({
          name: "delivery_history",
          result: "fail",
        }),
        expect.objectContaining({ name: "signed_receipt_and_processing", result: "unknown" }),
      ]),
    )
    expect(checks.find(({ name }) => name === "delivery_history")?.detail).toContain("HTTP 403")
    expect(JSON.stringify(checks)).not.toMatch(
      /hidden|installation-secret|webhook-secret|provider body/,
    )
  })
})
