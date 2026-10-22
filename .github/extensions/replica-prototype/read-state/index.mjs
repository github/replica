import { mkdir, readFile } from "node:fs/promises"
import { readErrorCode } from "../read-error-code/index.mjs"
import { writeState } from "../write-state/index.mjs"
const STATE_VERSION = 1
export async function readState(context) {
  await mkdir(context.stateDirectory, { recursive: true })
  try {
    const content = await readFile(context.stateFile, "utf8")
    return validateStoredState(JSON.parse(content))
  } catch (error) {
    if (readErrorCode(error) !== "ENOENT") {
      if (error instanceof SyntaxError) {
        throw new Error(`Stored Replica prototype state is invalid JSON: ${context.stateFile}`, {
          cause: error,
        })
      }
      throw error
    }
  }
  const state = {
    version: STATE_VERSION,
    prototypeUrl: context.normalizedUrl,
    name: context.name,
    publishRequest: {
      state: "idle",
      requestedAt: null,
      messageId: null,
      error: null,
    },
    stats: emptyStats(context),
    updatedAt: new Date().toISOString(),
  }
  await writeState(context, state)
  return state
}
function validateStoredState(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== STATE_VERSION
  ) {
    throw new Error("Stored Replica prototype state has an unsupported format.")
  }
  return value
}
function emptyStats(context) {
  return {
    branch: context.target.branch,
    branchError: "Status has not been refreshed.",
    comparison: {
      branch: null,
      source: null,
      behind: null,
      error: "Status has not been refreshed.",
    },
    repository: context.target.repository,
    repositoryError: "Status has not been refreshed.",
    commitSha: context.target.commitSha,
    publishedUrl: context.target.publishedUrl,
    workingTree: "unavailable",
    workingTreeError: "Status has not been refreshed.",
    replicaWorkflowExists: false,
    remoteBranch: { state: "loading", repository: null, branch: null, commitSha: null },
    workflow: {
      state: "unavailable",
      detail: "Status has not been refreshed.",
      run: null,
    },
    urlHost: context.urlHost,
    refreshedAt: null,
  }
}
