import { describe, expect, it } from "vitest"

import { resolveAnalyticsAddress } from "../../integrations/analytics-https/send-request"
import { parsePublicEndpoint } from "."

describe("analytics public HTTPS endpoints", () => {
  const policy = { hubHosts: ["hub.example.com"], outboundHosts: new Set(["events.example.com"]) }

  it("rejects ambiguous targets and credential-bearing configuration before resolution", () => {
    expect(
      parsePublicEndpoint("https://events.example.com/collect?version=1", policy).hostname,
    ).toBe("events.example.com")
    for (const url of [
      "http://events.example.com/collect",
      "https://events.example.com:444/collect",
      "https://127.0.0.1/collect",
      "https://[::1]/collect",
      "https://events.example.com@hub.example.com/collect",
      "https://events.example.com/collect?api_token=synthetic",
      "https://events.example.com/collect?version=%7b%7bsecret%7d%7d",
      "https://events.example.com/collect#fragment",
      "https://not-allowlisted.example.com/collect",
    ])
      expect(() => parsePublicEndpoint(url, policy)).toThrow()
    expect(() =>
      parsePublicEndpoint("https://preview.hub.example.com/collect", { hubHosts: policy.hubHosts }),
    ).toThrow()
  })

  it("refuses a host when any answer is private, special-purpose, or IPv4-mapped", async () => {
    const publicV4 = "93.184.215.14"
    const publicV6 = "2606:4700:4700::1111"
    await expect(
      resolveAnalyticsAddress("events.example.com", () => Promise.resolve([publicV4, publicV6])),
    ).resolves.toBe(publicV4)
    for (const address of [
      "127.0.0.1",
      "10.1.1.1",
      "169.254.169.254",
      "168.63.129.16",
      "fd00::1",
      "::ffff:93.184.215.14",
      "2001:db8::1",
    ]) {
      await expect(
        resolveAnalyticsAddress("events.example.com", () => Promise.resolve([publicV4, address])),
      ).rejects.toMatchObject({ code: "unsafe_endpoint" })
    }
  })
})
