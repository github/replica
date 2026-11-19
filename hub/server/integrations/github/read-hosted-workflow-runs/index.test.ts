import { generateKeyPairSync } from "node:crypto"
import { expect, it, vi } from "vitest"

import { createGitHubInstallationClient } from "../create-installation-client"
import { readHostedWorkflowRuns, readSuccessfulWorkflowAttempt } from "."
import { selectHostedBuildArtifact } from "../select-hosted-build-artifact"

const credentials = {
  appId: "12",
  installationId: "34",
  privateKey: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey,
}
const repository = { defaultBranch: "main", githubRepositoryId: 7, nameWithOwner: "octo/repo" }
const base = "/repos/octo/repo/actions"
const run = {
  id: 21,
  path: ".github/workflows/replica.yml",
  event: "push",
  repository: { id: 7 },
  head_repository: { id: 7 },
  head_branch: "feature/example",
  head_sha: "a".repeat(40),
  run_attempt: 2,
  status: "completed",
  conclusion: "success",
  created_at: "2026-11-18T02:00:00Z",
  run_started_at: "2026-11-19T02:00:00Z",
  updated_at: "2026-11-19T02:05:00Z",
}
const expected = { id: 21n, attempt: 2, branchName: run.head_branch, commitSha: run.head_sha }

async function installation(responses: Record<string, unknown>) {
  const fetch = vi.fn<typeof globalThis.fetch>((url) => {
    const path = new URL(url instanceof Request ? url.url : url).pathname
    if (path === "/app/installations/34/access_tokens")
      return Promise.resolve(Response.json({ token: "synthetic" }))
    if (!Object.hasOwn(responses, path)) throw new Error("Unexpected fake GitHub request")
    return Promise.resolve(Response.json(responses[path]))
  })
  return createGitHubInstallationClient(credentials, { fetch })
}

it("never treats fork, pull-request, or different workflow output as an eligible push run", async () => {
  const client = await installation({
    [`${base}/workflows/replica.yml/runs`]: {
      workflow_runs: [
        run,
        { ...run, id: 22, head_repository: { id: 13 } },
        { ...run, id: 23, event: "pull_request" },
        { ...run, id: 24, path: ".github/workflows/other.yml" },
      ],
    },
  })
  expect(await readHostedWorkflowRuns(client, repository)).toMatchObject([expected])
})

it.each([
  { run_attempt: 1 },
  { head_sha: "b".repeat(40) },
  { head_branch: "another" },
  { repository: { id: 19 } },
])("rejects mismatched exact-attempt evidence: %j", async (incorrect) => {
  const client = await installation({
    [`${base}/runs/21/attempts/2`]: { ...run, ...incorrect },
  })
  await expect(readSuccessfulWorkflowAttempt(client, repository, expected)).rejects.toThrow()
})

it("selects only the artifact created in the saved attempt window and refuses duplicates", async () => {
  function artifact(id: number, created_at: string) {
    return { id, name: "replica-build-v1", created_at, expired: false }
  }
  const archive = artifact(32, "2026-11-19T02:04:00Z")
  async function select(artifacts: ReturnType<typeof artifact>[]) {
    const client = await installation({
      [`${base}/runs/21/attempts/2`]: run,
      [`${base}/runs/21/artifacts`]: { artifacts, total_count: artifacts.length },
    })
    const times = await readSuccessfulWorkflowAttempt(client, repository, expected)
    return selectHostedBuildArtifact(client, repository, expected, times)
  }
  expect(
    await select([
      artifact(31, "2026-11-18T02:01:00Z"),
      archive,
      artifact(33, "2026-11-19T02:15:00Z"),
    ]),
  ).toEqual({ status: "found", id: 32n })
  expect(await select([archive, { ...archive, id: 34 }])).toEqual({ status: "duplicate" })
  expect(await select([{ ...archive, expired: true }])).toEqual({ status: "expired" })
})
