import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

for (const [description, environment, expected, unexpected] of [
  [
    "a reserved name",
    { AZURE_KEY_VAULT_SECRET_REFERENCES: "synthetic-value" },
    /deployment-owned settings and secret-reference names cannot be\s+overridden/,
    /Credential-named settings/,
  ],
  [
    "a reserved name alongside a credential name",
    { AZURE_KEY_VAULT_SECRET_REFERENCES: "synthetic-value", SERVICE_API_KEY: "synthetic-value" },
    /deployment-owned settings and secret-reference names cannot be\s+overridden/,
    /Credential-named settings/,
  ],
  [
    "an otherwise valid credential name",
    { SERVICE_API_KEY: "synthetic-value" },
    /Credential-named settings/,
    /deployment-owned settings and secret-reference names cannot be\s+overridden/,
  ],
]) {
  test(`${description} receives appropriate recovery advice`, () => {
    const result = spawnSync(
      "terraform",
      [
        "test",
        "-no-color",
        "-test-directory=tests/diagnostics",
        "-var",
        `runtime_environment_variables=${JSON.stringify(environment)}`,
      ],
      { encoding: "utf8" },
    )

    assert.ifError(result.error)
    assert.equal(result.status, 1)
    const output = result.stdout + result.stderr
    assert.match(output, expected)
    assert.doesNotMatch(output, unexpected)
  })
}
