import { waitFor } from "@testing-library/react"
import type { RouterHistory } from "@tanstack/history"
import { afterEach, describe, expect, it } from "vitest"

import { createPrototypeHistory } from "."

let history: RouterHistory | undefined

describe("createPrototypeHistory()", () => {
  afterEach(() => {
    history?.destroy()
    history = undefined
    window.history.replaceState({}, "", "/")
  })

  it.each([
    ["/", "/", "", ""],
    ["/#/activity", "/activity", "", ""],
    ["/#/about?tab=docs#team", "/about", "?tab=docs", "#team"],
    ["/#contents", "/", "", "#contents"],
    ["/?edition=summer#contents", "/", "?edition=summer", "#contents"],
  ])("reads %s without treating a section anchor as a page", (url, pathname, search, hash) => {
    window.history.replaceState({}, "", url)
    history = createPrototypeHistory()

    expect(history.location).toMatchObject({ pathname, search, hash })
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(url)
  })

  it("retains hash-based routes, route queries and nested section anchors", () => {
    history = createPrototypeHistory()
    history.push("/activity?filter=unread#details")
    history.flush()

    expect(window.location.hash).toBe("#/activity?filter=unread#details")
    expect(history.location).toMatchObject({
      pathname: "/activity",
      search: "?filter=unread",
      hash: "#details",
    })
  })

  it("writes root section links as native fragments", () => {
    history = createPrototypeHistory()
    history.push("/#contents")
    history.flush()

    expect(window.location.hash).toBe("#contents")
    expect(history.location).toMatchObject({ pathname: "/", hash: "#contents" })
  })

  it("follows native anchor navigation without replacing the home page route", async () => {
    history = createPrototypeHistory()
    window.location.hash = "contents"

    await waitFor(() =>
      expect(history?.location).toMatchObject({ pathname: "/", hash: "#contents" }),
    )
    expect(window.location.hash).toBe("#contents")
  })
})
