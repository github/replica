import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { usePrototypeViewerUrl } from "."

describe("usePrototypeViewerUrl()", () => {
  it("copies a logical template route that can reopen on a newer Build", () => {
    const mount = "/previews/github/2001/4001/"
    const previewUrl = new URL(
      "/api/repositories/2001/template-builds/4001/access",
      "https://hub.example.test",
    )
    previewUrl.searchParams.set("route", "/welcome")
    const { result } = renderHook(() =>
      usePrototypeViewerUrl({
        selectedBuild: { number: 1, previewUrl: previewUrl.href },
        initiallyMinimized: false,
        buildSelection: "ignore",
        route: {
          pathname: `${mount}checkout`,
          search: "?step=2",
          hash: "#shipping",
        },
        previewMount: mount,
        enabled: false,
      }),
    )

    const search = new URL(result.current.viewerUrl).searchParams
    expect(search.get("return_path")).toBe("/checkout?step=2#shipping")
    expect(search.get("return_path_kind")).toBe("logical")
    expect(search.has("build")).toBe(false)
  })
})
