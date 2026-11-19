import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { GitHubProviderRequestError } from "../errors.ts"
import { createGitHubWebhookDeliveriesClient } from "./index.ts"

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const input = { appId: "12", privateKey }
const delivery = {
  id: 9,
  guid: "0b0e7f5e-6d9a-11ef-8f0a-0242ac120002",
  delivered_at: "2026-12-15T10:00:00Z",
  status_code: null,
  event: "workflow_job",
  installation_id: 34,
}

function respondWith(response: Response) {
  return vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response))
}

describe("createGitHubWebhookDeliveriesClient", () => {
  it("lists deliveries and follows GitHub's next cursor", async () => {
    const fetch = respondWith(
      new Response(JSON.stringify([delivery]), {
        headers: {
          link: '<https://api.github.com/app/hook/deliveries?per_page=100&cursor=v1_9>; rel="next"',
        },
      }),
    )
    const client = createGitHubWebhookDeliveriesClient(input, { fetch })

    const page = await client.listDeliveries("v1_8")

    expect(page).toEqual({
      deliveries: [
        {
          id: 9,
          guid: delivery.guid,
          deliveredAt: new Date(delivery.delivered_at),
          statusCode: 0,
          event: "workflow_job",
          installationId: 34,
        },
      ],
      nextCursor: "v1_9",
    })
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.href).toBe("https://api.github.com/app/hook/deliveries?per_page=100&cursor=v1_8")
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer ey/)
  })

  it.each([
    '<https://evil.example/app/hook/deliveries?per_page=100&cursor=x>; rel="next"',
    '<https://api.github.com/app/installations?per_page=100&cursor=x>; rel="next"',
    '<https://api.github.com/app/hook/deliveries?per_page=100&cursor=x&redirect=1>; rel="next"',
  ])("rejects an unexpected next link %s", async (link) => {
    const fetch = respondWith(new Response(JSON.stringify([]), { headers: { link } }))
    const client = createGitHubWebhookDeliveriesClient(input, { fetch })

    await expect(client.listDeliveries(null)).rejects.toBeInstanceOf(GitHubProviderRequestError)
  })

  it.each([
    [202, "requested"],
    [404, "unavailable"],
    [410, "unavailable"],
  ] as const)("reports redelivery status %i as %s", async (status, result) => {
    const fetch = respondWith(new Response(null, { status }))
    const client = createGitHubWebhookDeliveriesClient(input, { fetch })

    await expect(client.redeliver(9)).resolves.toBe(result)
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.pathname).toBe("/app/hook/deliveries/9/attempts")
    expect(init.method).toBe("POST")
  })

  it("throws when GitHub cannot accept a redelivery", async () => {
    const client = createGitHubWebhookDeliveriesClient(input, {
      fetch: respondWith(new Response(null, { status: 503 })),
    })

    await expect(client.redeliver(9)).rejects.toBeInstanceOf(GitHubProviderRequestError)
  })
})
