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
  it("defaults to GitHub while allowing hub/.env to select OIDC", async () => {
    const compose = await readFile(
      new URL("../.devcontainer/compose.yaml", import.meta.url),
      "utf8",
    )
    const defaults = await readFile(
      new URL("../.devcontainer/default.env", import.meta.url),
      "utf8",
    )
    const appService = mappingBlock(compose, "app", 2)
    const environmentFiles = mappingBlock(appService, "env_file", 4)

    expect(defaults.trim()).toBe("HUB_AUTH_PROVIDER=github")
    expect(environmentFiles).toMatch(/- path: default\.env[\s\S]*- path: \.\.\/\.env/)
    expect(environmentFiles).toMatch(/path: \.\.\/\.env[\s\S]*required: false/)
    expect(mappingBlock(appService, "environment", 4)).not.toContain("HUB_AUTH_PROVIDER")
  })
})
