import { createHash } from "node:crypto"

import { discoverLocalRepositories } from "../../../integrations/git/discover-local-repositories/index.ts"
import { readLocalBuildPackage } from "../../../integrations/local-replica-build/read-local-build-package/index.ts"
import { runLocalReplicaBuild } from "../../../integrations/local-replica-build/run-local-replica-build/index.ts"
import type { LocalReplicaBuildRunner } from "../../../integrations/local-replica-build/run-local-replica-build/types.ts"
import { completeLocalBuildFailure } from "../../../repositories/local-builds/complete-local-build-failure/index.ts"
import { completeLocalBuildSuccess } from "../../../repositories/local-builds/complete-local-build-success/index.ts"
import { findLocalDeveloper } from "../../../repositories/local-builds/find-local-developer/index.ts"
import { markLocalBuildRunning } from "../../../repositories/local-builds/mark-local-build-running/index.ts"
import { prepareLocalBuild } from "../../../repositories/local-builds/prepare-local-build/index.ts"
import type { LocalBuildSynchronizationSummary, SynchronizeLocalBuildsInput } from "./types.ts"

function artifactKey(buildId: string, artifactPath: string) {
  const pathDigest = createHash("sha256").update(artifactPath).digest("hex").slice(0, 32)
  return `build${buildId.replaceAll("-", "")}${pathDigest}`
}

export async function synchronizeLocalBuilds({
  database,
  storage,
  prototypeRoot,
  actionRoot,
  temporaryRoot,
  logger,
  discover = discoverLocalRepositories,
  runBuild = runLocalReplicaBuild,
}: SynchronizeLocalBuildsInput): Promise<LocalBuildSynchronizationSummary> {
  const localDeveloper = await findLocalDeveloper(database)
  if (!localDeveloper) {
    throw new Error("Sign in as the local developer before running local Builds.")
  }
  const discovery = await discover(prototypeRoot)
  const summary: LocalBuildSynchronizationSummary = {
    repositories: discovery.repositories.length,
    branches: 0,
    queued: 0,
    unchanged: 0,
    successful: 0,
    failed: 0,
    discoveryFailures: discovery.failures.length,
  }
  for (const failure of discovery.failures) {
    logger.warn(
      { repositoryPath: failure.path, errorType: failure.errorType },
      "Local repository discovery failed",
    )
  }

  for (const repository of discovery.repositories) {
    for (const branch of repository.branches) {
      summary.branches += 1
      let prepared
      try {
        prepared = await prepareLocalBuild(database, {
          repositoryPath: repository.path,
          repositoryName: repository.name,
          defaultBranch: repository.defaultBranch,
          branchName: branch.name,
          commitSha: branch.commitSha,
          authorName: branch.authorName,
          authorEmail: branch.authorEmail,
          authoredAt: branch.authoredAt,
          localUserId: localDeveloper.userId,
        })
      } catch (error) {
        summary.failed += 1
        logger.error(
          {
            repositoryPath: repository.path,
            branchName: branch.name,
            errorType: error instanceof Error ? error.name : "UnknownError",
          },
          "Local Build preparation failed",
        )
        continue
      }
      if (prepared.status === "unchanged") {
        summary.unchanged += 1
        continue
      }
      summary.queued += 1
      let result: Awaited<ReturnType<LocalReplicaBuildRunner>> | undefined
      let started = false
      const newlyWrittenKeys: string[] = []
      try {
        await markLocalBuildRunning(database, prepared.buildId)
        started = true
        result = await runBuild({
          repositoryPath: repository.path,
          commitSha: branch.commitSha,
          actionRoot,
          temporaryRoot,
        })
        const files = await readLocalBuildPackage(result.packageDirectory)
        const artifacts = []
        for (const file of files) {
          const storageKey = artifactKey(prepared.buildId, file.path)
          const write = await storage.write(storageKey, file.bytes)
          if (write.status === "ok") newlyWrittenKeys.push(storageKey)
          else if (write.status === "already-exists") {
            const existing = await storage.read(storageKey)
            if (
              existing.status !== "ok" ||
              !Buffer.from(existing.bytes).equals(Buffer.from(file.bytes))
            ) {
              throw new Error(`Artifact storage contains different bytes for ${file.path}.`)
            }
          } else {
            throw new Error(`Artifact storage rejected ${file.path} with ${write.status}.`)
          }
          artifacts.push({
            path: file.path,
            kind: file.kind,
            storageKey,
            byteLength: file.bytes.byteLength,
          })
        }
        await completeLocalBuildSuccess(database, prepared.buildId, prepared.prototypeId, artifacts)
        summary.successful += 1
      } catch (error) {
        for (const key of newlyWrittenKeys) await storage.delete(key)
        const message = error instanceof Error ? error.message : "The local Build failed."
        if (started) {
          await completeLocalBuildFailure(
            database,
            prepared.buildId,
            message || "The local Build failed.",
          ).catch((persistenceError) => {
            logger.error(
              {
                buildId: prepared.buildId,
                errorType:
                  persistenceError instanceof Error ? persistenceError.name : "UnknownError",
              },
              "Local Build failure persistence failed",
            )
          })
        }
        summary.failed += 1
        logger.error(
          {
            repositoryPath: repository.path,
            branchName: branch.name,
            buildId: prepared.buildId,
            errorType: error instanceof Error ? error.name : "UnknownError",
          },
          "Local Build failed",
        )
      } finally {
        await result?.cleanup().catch((error) => {
          logger.warn(
            {
              buildId: prepared.buildId,
              errorType: error instanceof Error ? error.name : "UnknownError",
            },
            "Local Build cleanup failed",
          )
        })
      }
    }
  }

  return summary
}
