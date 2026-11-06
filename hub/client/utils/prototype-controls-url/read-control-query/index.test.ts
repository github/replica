import { describe, expect, it } from "vitest"

import { encodeControlValues } from "../encode-control-values"
import { withControlQuery } from "../with-control-query"
import { readControlQuery } from "."

describe("URL control settings", () => {
  it("round-trips all ordinary value types across scopes in stable order", () => {
    const values = {
      shared: {
        title: 'A & B? "hello" #/你好',
        enabled: false,
        count: 0,
        opacity: 0.5,
        options: ["B", "A"],
        empty: "",
      },
      anotherPage: { layout: "grid" },
    }
    const query = encodeControlValues(values)
    expect(readControlQuery(query)).toEqual({ scopes: values, notice: "" })
    expect([...new URLSearchParams(query).keys()]).toEqual([
      "rc.anotherPage.layout",
      "rc.shared.count",
      "rc.shared.empty",
      "rc.shared.enabled",
      "rc.shared.opacity",
      "rc.shared.options",
      "rc.shared.title",
    ])
  })

  it("supports manually appended strings, booleans, numbers and JSON arrays", () => {
    expect(
      readControlQuery(
        "rc.page.layout=grid&rc.page.enabled=true&rc.page.count=3&rc.page.options=%5B%22A%22%5D",
      ).scopes,
    ).toEqual({ page: { layout: "grid", enabled: true, count: 3, options: ["A"] } })
  })

  it("discards duplicate and invalid entries, while preserving independent valid settings", () => {
    const parsed = readControlQuery(
      "rc.page.title=a&rc.page.title=b&rc.page.object=%7B%7D&rc..bad=1&rc.page.count=4&rc.page.list=%5B1%5D&other=retained",
    )
    expect(parsed.scopes).toEqual({ page: { count: 4 } })
    expect(parsed.notice).toMatch(/invalid/)
  })

  it("safely handles prototype-like identifiers", () => {
    const values = { constructor: { constructor: "own value" } }
    expect(readControlQuery(encodeControlValues(values)).scopes).toEqual(values)
    expect(readControlQuery("rc.__proto__.name=bad").notice).toMatch(/invalid/)
    expect({}).not.toHaveProperty("name")
  })

  it("rejects oversized state instead of truncating or creating a success-shaped URL", () => {
    expect(() => encodeControlValues({ page: { title: "x".repeat(8192) } })).toThrow(/8 KB/)
    expect(readControlQuery(`rc.page.title=${"x".repeat(8192)}`)).toEqual({
      scopes: {},
      notice: "Control settings in this URL exceed 8 KB. Defaults were used.",
    })
    const query = encodeControlValues({ page: { title: "x".repeat(8000) } })
    expect(new Blob([query]).size).toBeLessThanOrEqual(8192)
    expect(readControlQuery(query).notice).toBe("")
  })

  it("only replaces control parameters, never the page, ordinary query or fragment", () => {
    const base =
      "https://hub.example/share/id?return_path=%2Fsettings%3Ftab%3Dall&source=review&rc.old.flag=true#destination"
    const url = new URL(withControlQuery(base, encodeControlValues({ page: { enabled: false } })))
    expect(url.pathname).toBe("/share/id")
    expect(url.searchParams.get("return_path")).toBe("/settings?tab=all")
    expect(url.searchParams.get("source")).toBe("review")
    expect(url.hash).toBe("#destination")
    expect(url.searchParams.get("rc.page.enabled")).toBe("false")
    expect(url.searchParams.has("rc.old.flag")).toBe(false)
    expect(new URL(withControlQuery(url.href, "")).searchParams.has("rc.page.enabled")).toBe(false)
  })
})
