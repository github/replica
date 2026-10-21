import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { describe, it } from "node:test"

import { validateChecksConfig } from "./index.mjs"

const require = createRequire(new URL("../../../../hub/package.json", import.meta.url))
const Ajv = require("ajv")

describe("prototype checks JSON Schema", () => {
  it("gives editors and the runtime the same structural decisions for accepted v2 branches", async () => {
    const schema = JSON.parse(await readFile(new URL("./schema.v2.json", import.meta.url), "utf8"))
    const accepts = new Ajv({
      strict: true,
      strictTypes: false,
      allErrors: true,
    }).compile(schema)
    const minimal = {
      version: 2,
      base: "main",
      checks: [
        {
          id: "review",
          name: "Review",
          runner: { type: "agent", instructions: "checks/review.md" },
        },
      ],
    }
    const cases = [
      [true, (value) => value],
      [true, (value) => (value.$schema = "./checks.schema.json")],
      [true, (value) => (value.pages = [])],
      [true, (value) => (value.checks[0].criteria = [])],
      [
        true,
        (value) =>
          (value.checks[0].runner = {
            type: "command",
            command: ["node", "checks/lint.mjs"],
            image: "node:24",
            report: "exit-code",
            failureExitCodes: [1, 123],
          }),
      ],
      [false, (value) => (value.$schema = 2)],
      [false, (value) => (value.version = 3)],
      [false, (value) => (value.checks = [])],
      [false, (value) => (value.checks[0].runner.instructions = "checks/*.md")],
      [false, (value) => (value.checks[0].runner.instructions = "../review.md")],
      [false, (value) => (value.checks[0].runner.type = "shell")],
      [false, (value) => (value.checks[0].runner.command = ["node"])],
      [false, (value) => (value.checks[0].runner.capabilities = ["write"])],
      [false, (value) => (value.checks[0].automatic = 1)],
      [false, (value) => (value.checks[0].timeoutSeconds = 601)],
      [false, (value) => (value.base = "-main")],
      [false, (value) => (value.checks[0].context = ["docs//guide.md"])],
      [false, (value) => (value.checks[0].name = "   ")],
    ]
    for (const [expected, change] of cases) {
      const value = structuredClone(minimal)
      change(value)
      assert.equal(accepts(value), expected, JSON.stringify(value))
      if (expected) assert.doesNotThrow(() => validateChecksConfig(value))
      else assert.throws(() => validateChecksConfig(value))
    }
  })
})
