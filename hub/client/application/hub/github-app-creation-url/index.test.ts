import { describe, expect, it } from "vitest"

import { githubAppCreationUrl } from "."

const urls = {
  homepage: "https://hub.example.com",
  callback: "https://hub.example.com/api/auth/github/callback",
  setup: "https://hub.example.com/settings/github/setup?step=install",
  webhook: "https://hub.example.com/api/github/webhooks",
}

describe("githubAppCreationUrl()", () => {
  it("prefills an organization-owned private App", () => {
    const url = new URL(githubAppCreationUrl(urls, " octo-org "))

    expect(url.pathname).toBe("/organizations/octo-org/settings/apps/new")
    expect(url.searchParams.get("name")).toBe("Replica Hub (octo-org)")
    expect(url.searchParams.getAll("callback_urls[]")).toEqual([urls.callback])
    expect(url.searchParams.get("setup_url")).toBe(urls.setup)
    expect(url.searchParams.get("webhook_active")).toBe("true")
    expect(url.searchParams.get("public")).toBe("false")
    expect(url.searchParams.get("contents")).toBe("write")
    expect(url.searchParams.has("administration")).toBe(false)
    expect(url.searchParams.has("workflows")).toBe(false)
    expect(url.searchParams.getAll("events[]")).toContain("installation_target")
    expect(url.searchParams.get("members")).toBe("read")
    expect(url.searchParams.getAll("events[]")).toContain("organization")
  })

  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])(
    "uses the personal account and disables webhooks for %s",
    (homepage) => {
      const local = { ...urls, homepage }
      const url = new URL(githubAppCreationUrl(local, ""))

      expect(url.pathname).toBe("/settings/apps/new")
      expect(url.searchParams.get("webhook_active")).toBe("false")
    },
  )
})
