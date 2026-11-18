import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

test("reserved runtime names do not suggest moving them to secret references", () => {
  const result = spawnSync(
    "terraform",
    ["test", "-no-color", "-test-directory=tests/diagnostics"],
    { encoding: "utf8" },
  )

  assert.ifError(result.error)
  assert.equal(result.status, 1)
  const output = result.stdout + result.stderr
  assert.match(output, /deployment-owned settings and secret-reference names cannot be\s+overridden/)
  assert.doesNotMatch(output, /Credential-named settings/)
})
