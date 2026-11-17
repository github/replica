import { describe, expect, it } from "vitest"

import { getUrlOrigin } from "."

describe("getUrlOrigin()", () => {
  it("uses the authorized Build origin for Hub access URLs", () => {
    const url = new URL(
      "https://hub.example.test/api/repositories/repository/prototypes/prototype/builds/7/access",
    )
    url.searchParams.set("target", "preview")
    url.searchParams.set(
      "preview_origin",
      "https://00000000-0000-4000-8000-000000000007.preview.example.test",
    )

    expect(getUrlOrigin(url.toString())).toBe(
      "https://00000000-0000-4000-8000-000000000007.preview.example.test",
    )
  })

  it("does not accept an embedded origin on unrelated URLs", () => {
    expect(
      getUrlOrigin(
        "https://untrusted.example.test/page?preview_origin=https://preview.example.test",
      ),
    ).toBe("https://untrusted.example.test")
  })
})
