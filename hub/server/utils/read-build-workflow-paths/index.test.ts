import { describe, expect, it } from "vitest"

import { readBuildWorkflowPaths } from "."

describe("readBuildWorkflowPaths()", () => {
  it("uses the legacy workflow when builds or workflows is omitted without validating other metadata", () => {
    for (const configuration of [
      { version: 1 },
      { version: 1, builds: {} },
      { version: 1, hub: null, templates: "validated by the template consumer" },
    ]) {
      expect(readBuildWorkflowPaths(configuration)).toEqual([".github/workflows/replica.yml"])
    }
  })

  it("selects only the configured direct workflow files, including both extensions and the path limit", () => {
    const prefix = ".github/workflows/"
    const longest = `${prefix}${"a".repeat(255 - prefix.length - 4)}.yml`
    const workflows = [
      ".github/workflows/Publish_proto-1.2.yaml",
      longest,
      ...Array.from({ length: 8 }, (_, index) => `${prefix}build-${index}.yml`),
    ]

    expect(readBuildWorkflowPaths({ version: 1, builds: { workflows } })).toEqual(workflows)
  })

  it.each([null, [], "configuration", {}, { version: 2 }, { version: 1, unexpected: true }])(
    "rejects an unsupported configuration rather than selecting the legacy workflow: %j",
    (value) => {
      expect(() => readBuildWorkflowPaths(value)).toThrow(/version|configuration/i)
    },
  )

  it.each([
    null,
    [],
    "builds",
    { workflow: ".github/workflows/build.yml" },
    { workflows: null },
    { workflows: ".github/workflows/build.yml" },
    { workflows: [] },
    { workflows: Array.from({ length: 11 }, (_, index) => `.github/workflows/${index}.yml`) },
    { workflows: [".github/workflows/build.yml", ".github/workflows/build.yml"] },
  ])("rejects invalid explicit build selection with an actionable error: %j", (builds) => {
    expect(() => readBuildWorkflowPaths({ version: 1, builds })).toThrow(/builds|workflows/i)
  })

  it.each([
    42,
    "",
    ".github/workflows/../build.yml",
    ".github/workflows/nested/build.yml",
    ".github/workflows/build.yml@refs/heads/proto/test",
    ".github/workflows/build.yml?ref=main",
    ".github/workflows/build.yml#main",
    "https://github.com/o/r/.github/workflows/build.yml",
    "refs/heads/main:.github/workflows/build.yml",
    "/.github/workflows/build.yml",
    ".github\\workflows\\build.yml",
    ".github/workflows/%2e%2e.yml",
    ".github/workflows/.hidden.yml",
    ".github/workflows/-build.yml",
    ".github/workflows/build file.yml",
    ".github/workflows/build.YML",
    ".github/workflows/build.json",
    ".github/workflows/build.yml\n",
    `.github/workflows/${"a".repeat(235)}.yml`,
  ])("rejects a workflow path outside the direct-file contract: %j", (workflow) => {
    expect(() => readBuildWorkflowPaths({ version: 1, builds: { workflows: [workflow] } })).toThrow(
      /workflows/i,
    )
  })
})
