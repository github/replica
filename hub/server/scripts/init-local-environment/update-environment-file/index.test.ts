import { describe, expect, it } from "vitest"

import { updateEnvironmentFile } from "./index.ts"

describe("updateEnvironmentFile", () => {
  it("fills commented and empty assignments in place and appends absent keys", () => {
    const result = updateEnvironmentFile("# HUB_BOOTSTRAP_SECRET=\nPORT=3001\nGITHUB_APP_ID=\n", {
      HUB_BOOTSTRAP_SECRET: "bootstrap",
      GITHUB_APP_ID: "42",
      GITHUB_APP_PRIVATE_KEY_BASE64: "a2V5",
    })

    expect(result.content).toBe(
      "HUB_BOOTSTRAP_SECRET=bootstrap\nPORT=3001\nGITHUB_APP_ID=42\nGITHUB_APP_PRIVATE_KEY_BASE64=a2V5\n",
    )
    expect(result.changes.map(({ outcome }) => outcome)).toEqual(["added", "added", "added"])
  })

  it("never replaces a configured value", () => {
    const original = "# HUB_BOOTSTRAP_SECRET=\nHUB_BOOTSTRAP_SECRET=existing\n"

    const result = updateEnvironmentFile(original, { HUB_BOOTSTRAP_SECRET: "replacement" })

    expect(result.content).toBe(original)
    expect(result.changes).toEqual([{ key: "HUB_BOOTSTRAP_SECRET", outcome: "kept" }])
  })

  it.each([
    "HUB_BOOTSTRAP_SECRET = existing\n",
    "export HUB_BOOTSTRAP_SECRET=existing\n",
    "HUB_BOOTSTRAP_SECRET: existing\n",
    'HUB_BOOTSTRAP_SECRET="existing" # kept\n',
  ])("keeps a value dotenv reads from %j", (original) => {
    const result = updateEnvironmentFile(original, { HUB_BOOTSTRAP_SECRET: "replacement" })

    expect(result.content).toBe(original)
    expect(result.changes).toEqual([{ key: "HUB_BOOTSTRAP_SECRET", outcome: "kept" }])
  })

  it.each([
    ['HUB_BOOTSTRAP_SECRET="" # unset\n', "HUB_BOOTSTRAP_SECRET=new\n"],
    [
      "HUB_BOOTSTRAP_SECRET=old\nexport HUB_BOOTSTRAP_SECRET = \n",
      "HUB_BOOTSTRAP_SECRET=old\nHUB_BOOTSTRAP_SECRET=new\n",
    ],
  ])("fills the empty assignment dotenv reads last in %j", (original, expected) => {
    const result = updateEnvironmentFile(original, { HUB_BOOTSTRAP_SECRET: "new" })

    expect(result.content).toBe(expected)
  })

  it("does not treat a longer key as the configured key", () => {
    const result = updateEnvironmentFile("HUB_BOOTSTRAP_SECRET_OLD=existing\n", {
      HUB_BOOTSTRAP_SECRET: "new",
    })

    expect(result.content).toBe("HUB_BOOTSTRAP_SECRET_OLD=existing\nHUB_BOOTSTRAP_SECRET=new\n")
  })
})
