import { readFile } from "node:fs/promises"

import { describe, expect, it } from "vitest"

function mappingBlock(source: string, key: string, indentation: number) {
  const lines = source.split("\n")
  const start = lines.findIndex((line) => line === `${" ".repeat(indentation)}${key}:`)
  const block: string[] = []

  if (start < 0) return ""

  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && line.search(/\S/) <= indentation) break
    block.push(line)
  }

  return block.join("\n")
}

describe("Hub devcontainer", () => {
  it("selects GitHub authentication explicitly for local startup", async () => {
    const compose = await readFile(
      new URL("../.devcontainer/compose.yaml", import.meta.url),
      "utf8",
    )
    const appService = mappingBlock(compose, "app", 2)
    const environment = mappingBlock(appService, "environment", 4)
    const values = new Map(
      environment
        .trim()
        .split("\n")
        .map((line): [string, string] => {
          const [key = "", value = ""] = line.trim().split(/:\s+/, 2)
          return [key, value]
        }),
    )

    expect(values.get("HUB_AUTH_PROVIDER")).toBe("github")
  })
})
