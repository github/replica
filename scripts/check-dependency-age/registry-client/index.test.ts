import { describe, expect, it, vi } from "vitest"

import type { Dependency } from "../load-dependencies/types.ts"
import { registryClient } from "."

describe("registryClient()", () => {
  it("uses registry version publication and Action commit time with shared metadata requests", async () => {
    const requests: { url: string; authorization: string | null }[] = []
    const request = vi.fn<typeof fetch>(async (url, options) => {
      requests.push({
        url: String(url),
        authorization: new Headers(options?.headers).get("Authorization"),
      })
      return new Response(
        JSON.stringify(
          String(url).includes("registry.npmjs.org")
            ? { time: { "1.0.0": "2026-01-01T00:00:00Z", "2.0.0": "2026-01-02T00:00:00Z" } }
            : {
                commit: {
                  author: { date: "2025-01-01T00:00:00Z" },
                  committer: { date: "2026-01-03T00:00:00Z" },
                },
              },
        ),
      )
    })
    const client = registryClient(request, "test-token")
    const dependency: Dependency = {
      ecosystem: "npm",
      name: "@scope/pkg",
      version: "1.0.0",
      source: "package-lock.json",
    }
    await expect(
      Promise.all([
        client(dependency),
        client({ ...dependency, version: "2.0.0" }),
        client({
          ecosystem: "github-actions",
          name: "owner/repo/path",
          version: "a".repeat(40),
          source: "action.yml",
        }),
      ]),
    ).resolves.toEqual(["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "2026-01-03T00:00:00Z"])
    expect(requests).toEqual([
      { url: "https://registry.npmjs.org/%40scope%2Fpkg", authorization: null },
      {
        url: `https://api.github.com/repos/owner/repo/commits/${"a".repeat(40)}`,
        authorization: "Bearer test-token",
      },
    ])
  })

  it("fails closed for registry errors, missing timestamps, and invalid timestamps", async () => {
    const dependency: Dependency = {
      ecosystem: "npm",
      name: "example",
      version: "1.0.0",
      source: "package-lock.json",
    }
    for (const response of [
      new Response("unavailable", { status: 503 }),
      new Response(JSON.stringify({ time: {} })),
      new Response(JSON.stringify({ time: { "1.0.0": "not a date" } })),
    ]) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(response)
      const client = registryClient(request)
      await expect(client(dependency)).rejects.toThrow(/returned 503|publication time/)
    }
  })
})
