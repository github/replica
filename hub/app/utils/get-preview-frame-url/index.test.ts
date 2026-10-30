import { describe, expect, it } from "vitest"

import { getPreviewFrameUrl } from "."

describe("getPreviewFrameUrl()", () => {
  it.each([
    ["http://b1.preview.example.com/#stations", "http://b1.preview.example.com/"],
    [
      "http://b1.preview.example.com/copilot?tab=activity#welcome",
      "http://b1.preview.example.com/copilot?tab=activity",
    ],
    ["/prototype-preview/index.html#team%20members", "/prototype-preview/index.html"],
  ])("defers the section fragment in %s until the preview is loaded", (url, expected) => {
    expect(getPreviewFrameUrl(url)).toBe(expected)
  })

  it.each([
    undefined,
    "http://b1.preview.example.com/",
    "http://b1.preview.example.com/#",
    "http://b1.preview.example.com/#/activity?tab=details#team",
    "http://b1.preview.example.com/#!/settings",
    "/prototype-preview/index.html#/settings",
  ])("preserves normal and hash-router URLs such as %s", (url) => {
    expect(getPreviewFrameUrl(url)).toBe(url)
  })
})
