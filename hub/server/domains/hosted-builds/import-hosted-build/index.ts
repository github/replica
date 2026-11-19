import { createHash } from "node:crypto"

import {
  GitHubArtifactDownloadTooLarge,
  GitHubInstallationHttpError,
  InvalidGitHubInstallationEvidence,
  type GitHubInstallationClient,
} from "../../../integrations/github/create-installation-client/index.ts"
import { githubRepositoryPath } from "../../../integrations/github/hosted-build-evidence.ts"
import { readSuccessfulWorkflowAttempt } from "../../../integrations/github/read-hosted-workflow-runs/index.ts"
import { selectHostedBuildArtifact } from "../../../integrations/github/select-hosted-build-artifact/index.ts"
import type { GitHubRepositoryEvidence } from "../../../integrations/github/types.ts"
import { InvalidBuildZip } from "../../../integrations/zip/read-build-zip/index.ts"
import {
  claimHostedImport,
  pinHostedArtifact,
  stopHostedImport,
  type HostedImportIdentity,
  type RetainedHostedArtifact,
} from "../../../repositories/hosted-builds/retain-hosted-import/index.ts"
import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types.ts"
import { publishHostedBuild } from "../publish-hosted-build/index.ts"
import {
  InvalidHostedBuildPackage,
  maxArtifactDownloadBytes,
  readHostedBuildPackage,
} from "../read-hosted-build-package/index.ts"
import {
  withHostedBuildRepository,
  type HostedBuildAuthority,
} from "../with-hosted-build-repository/index.ts"

const absent = {
  missing: "GitHub did not provide a replica-build-v1 artifact for this workflow attempt.",
  expired: "The replica-build-v1 artifact expired before Hub could download it.",
  duplicate: "GitHub provided more than one replica-build-v1 artifact for this workflow attempt.",
}

function terminalFailure(error: unknown) {
  if (
    error instanceof InvalidHostedBuildPackage ||
    error instanceof InvalidBuildZip ||
    error instanceof GitHubArtifactDownloadTooLarge
  )
    return error.message
  if (error instanceof InvalidGitHubInstallationEvidence)
    return "GitHub returned invalid evidence for this workflow attempt or artifact."
  if (
    error instanceof GitHubInstallationHttpError &&
    !error.limited &&
    [401, 403, 404, 410].includes(error.status)
  )
    return "GitHub no longer provides the workflow attempt or artifact to this installation."
  return undefined
}

export async function importHostedBuild(
  authority: HostedBuildAuthority,
  client: GitHubInstallationClient,
  storage: ArtifactStorage,
  repository: GitHubRepositoryEvidence,
  build: HostedImportIdentity & { branchName: string; artifactId: bigint | null },
) {
  const claim = await withHostedBuildRepository(authority, (transaction) =>
    claimHostedImport(transaction, build),
  )
  if (!claim) return "skipped"
  const staged: string[] = []
  let publicationStarted = false
  let published = false
  let failure: string | undefined
  try {
    let artifactId = build.artifactId
    if (!artifactId) {
      const run = {
        id: build.runId,
        attempt: build.runAttempt,
        branchName: build.branchName,
        commitSha: build.commitSha,
      }
      const window = await readSuccessfulWorkflowAttempt(client, repository, run)
      const selected = await selectHostedBuildArtifact(client, repository, run, window)
      if (selected.status !== "found") {
        failure = absent[selected.status]
        return "failed"
      }
      if (
        !(await withHostedBuildRepository(authority, (transaction) =>
          pinHostedArtifact(transaction, claim, selected.id),
        ))
      ) {
        return "skipped"
      }
      artifactId = selected.id
    }

    const path = `${githubRepositoryPath(repository.nameWithOwner)}/actions/artifacts/${artifactId}/zip`
    const archive = await client.download(path, maxArtifactDownloadBytes)
    const artifacts: RetainedHostedArtifact[] = []
    for await (const file of readHostedBuildPackage(archive)) {
      const digest = createHash("sha256").update(file.path).digest("hex")
      const storageKey = `hosted${claim.leaseId.replaceAll("-", "")}${digest}`
      staged.push(storageKey)
      const result = await storage.write(storageKey, file.bytes)
      if (result.status === "already-exists") {
        const existing = await storage.read(storageKey)
        if (existing.status === "unavailable")
          throw new Error("Artifact storage is temporarily unavailable.")
        if (existing.status !== "ok" || !file.bytes.equals(existing.bytes))
          throw new InvalidHostedBuildPackage("conflicts with retained storage")
      } else if (result.status !== "ok") {
        if (result.status === "too-large" || result.status === "invalid-key")
          throw new InvalidHostedBuildPackage("was rejected by artifact storage")
        throw new Error("Artifact storage is temporarily unavailable.")
      }
      artifacts.push({
        path: file.path,
        byteLength: file.bytes.length,
        kind: file.kind,
        storageKey,
      })
    }
    publicationStarted = true
    if (await publishHostedBuild(authority, claim, artifactId, artifacts)) {
      published = true
      return "successful"
    }
    publicationStarted = false
    return "skipped"
  } catch (error) {
    failure = terminalFailure(error)
    return failure ? "failed" : "retryable"
  } finally {
    // If the publication transaction's result is unknown, only clean up after fencing it out.
    if (!published) {
      const released = await stopHostedImport(authority.database, claim, failure)
      if (released || !publicationStarted) {
        for (const key of staged) await storage.delete(key)
      }
    }
  }
}
