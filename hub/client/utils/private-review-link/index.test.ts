import { describe, expect, it } from "vitest"

import { privateReviewLink } from "."

const BASE_URL = "https://hub.example.test/repositories/2001/prototypes/1"

describe("privateReviewLink()", () => {
  it("keeps a thread link on its pinned Build and preserves the exact preview route", () => {
    const route = "/design%2Fdetails?label=a%26b&space=a%20b&label=second#section%2Ftwo"
    const base = new URL(BASE_URL)
    base.search = new URLSearchParams({
      grant: "discard",
      preview_origin: "https://preview.example.test",
      "rc.page.title": '"Draft"',
      notification: "73",
      build: "3",
      comment: "12",
      return_path: "/stale",
    }).toString()
    base.hash = "hub-ui"

    const link = new URL(
      privateReviewLink({ baseUrl: base.href, buildNumber: 7, route, threadId: 42 })!,
    )

    expect(link.origin + link.pathname).toBe(BASE_URL)
    expect(link.hash).toBe("")
    expect([...link.searchParams]).toHaveLength(3)
    expect(Object.fromEntries(link.searchParams)).toEqual({
      build: "7",
      comment: "42",
      return_path: route,
    })
  })

  it("keeps an unpinned link on the default Build", () => {
    const link = new URL(
      privateReviewLink({ baseUrl: `${BASE_URL}?build=3`, route: "/#/settings" })!,
    )

    expect(Object.fromEntries(link.searchParams)).toEqual({ return_path: "/#/settings" })
  })

  it("keeps the pinned thread when no return path was supplied", () => {
    const link = new URL(privateReviewLink({ baseUrl: BASE_URL, buildNumber: 7, threadId: 42 })!)
    expect(Object.fromEntries(link.searchParams)).toEqual({ build: "7", comment: "42" })
  })

  it.each([
    ["absolute URL", "https://elsewhere.example.test/review"],
    ["network-path URL", "//elsewhere.example.test/review"],
    ["backslash in path", "/\\elsewhere.example.test/review"],
    ["missing leading slash", "review"],
    ["empty string", ""],
    ["over the byte limit", `/review?q=${"a".repeat(2_048)}`],
    ["malformed percent encoding", "/review/50%"],
  ])("returns no link for an explicit invalid location: %s", (_reason, route) => {
    expect(privateReviewLink({ baseUrl: BASE_URL, buildNumber: 7, route, threadId: 42 })).toBeNull()
  })
})
