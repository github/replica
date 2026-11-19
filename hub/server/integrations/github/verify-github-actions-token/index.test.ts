import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose"
import { describe, expect, it } from "vitest"

import { githubActionsIssuer } from "./constants"
import { verifyGitHubActionsToken } from "."

const audience = "https://hub.example.test"
const workflowPath = ".github/workflows/replica.yml"
const sha = "a".repeat(40)

async function fixture() {
  const { privateKey, publicKey } = await generateKeyPair("RS256")
  const jwk = { ...(await exportJWK(publicKey)), kid: "actions", alg: "RS256" }
  const keys = createLocalJWKSet({ keys: [jwk] })
  async function sign(overrides: Record<string, unknown> = {}, signingKey = privateKey) {
    const now = Math.floor(Date.now() / 1000)
    return new SignJWT({
      repository: "octo/prototype",
      repository_id: "42",
      ref: "refs/heads/feature/login",
      ref_type: "branch",
      event_name: "push",
      workflow_ref: "octo/prototype/.github/workflows/replica.yml@refs/heads/feature/login",
      sha,
      run_id: "9001",
      run_attempt: "2",
      iss: githubActionsIssuer,
      aud: audience,
      iat: now,
      exp: now + 300,
      ...overrides,
    })
      .setProtectedHeader({ alg: "RS256", kid: "actions" })
      .sign(signingKey)
  }
  return { keys, sign }
}

describe("verifyGitHubActionsToken", () => {
  it("returns the run identity for a Replica workflow branch push", async () => {
    const { keys, sign } = await fixture()
    await expect(
      verifyGitHubActionsToken(await sign(), { audience, keys, workflowPath }),
    ).resolves.toEqual({
      status: "verified",
      run: {
        githubRepositoryId: 42,
        repository: "octo/prototype",
        branchName: "feature/login",
        commitSha: sha,
        runId: 9001,
        runAttempt: 2,
      },
    })
  })

  it("rejects tokens for another audience or signed by another key", async () => {
    const { keys, sign } = await fixture()
    const other = await generateKeyPair("RS256")
    await expect(
      verifyGitHubActionsToken(await sign(), {
        audience: "https://other.example",
        keys,
        workflowPath,
      }),
    ).resolves.toEqual({ status: "invalid" })
    await expect(
      verifyGitHubActionsToken(await sign({}, other.privateKey), { audience, keys, workflowPath }),
    ).resolves.toEqual({ status: "invalid" })
  })

  it("rejects expired tokens and tokens issued outside GitHub Actions", async () => {
    const { keys, sign } = await fixture()
    await expect(
      verifyGitHubActionsToken(await sign({ exp: Math.floor(Date.now() / 1000) - 60 }), {
        audience,
        keys,
        workflowPath,
      }),
    ).resolves.toEqual({ status: "invalid" })
    await expect(
      verifyGitHubActionsToken(await sign({ iss: "https://issuer.example.test" }), {
        audience,
        keys,
        workflowPath,
      }),
    ).resolves.toEqual({ status: "invalid" })
  })

  it.each([
    ["no expiration", { exp: undefined }],
    ["no issue time", { iat: undefined }],
    ["an issue time more than ten minutes ago", { iat: Math.floor(Date.now() / 1000) - 660 }],
  ])("rejects authenticated tokens with %s", async (_name, overrides) => {
    const { keys, sign } = await fixture()
    await expect(
      verifyGitHubActionsToken(await sign(overrides), { audience, keys, workflowPath }),
    ).resolves.toEqual({ status: "invalid" })
  })

  it.each([
    ["missing repository ID", { repository_id: undefined }],
    ["invalid run ID", { run_id: "not-a-run" }],
    ["run ID outside JavaScript's safe integer range", { run_id: "9007199254740993" }],
    ["missing run attempt", { run_attempt: undefined }],
    ["invalid commit", { sha: "not-a-commit" }],
  ])("rejects authenticated tokens with a %s", async (_name, overrides) => {
    const { keys, sign } = await fixture()
    await expect(
      verifyGitHubActionsToken(await sign(overrides), { audience, keys, workflowPath }),
    ).resolves.toEqual({ status: "invalid" })
  })

  it.each([
    [
      "another workflow",
      { workflow_ref: "octo/prototype/.github/workflows/other.yml@refs/heads/main" },
    ],
    [
      "another repository's workflow",
      { workflow_ref: "octo/other/.github/workflows/replica.yml@refs/heads/main" },
    ],
    ["a pull request run", { event_name: "pull_request" }],
    ["a tag", { ref: "refs/tags/v1", ref_type: "tag" }],
    ["the workflow installation branch", { ref: "refs/heads/replica/install-workflow" }],
  ])("forbids %s", async (_name, overrides) => {
    const { keys, sign } = await fixture()
    const result = await verifyGitHubActionsToken(await sign(overrides), {
      audience,
      keys,
      workflowPath,
    })
    expect(result.status).toBe("forbidden")
  })
})
