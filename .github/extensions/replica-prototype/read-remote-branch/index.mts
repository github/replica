// Edit index.mts; rebuild index.mjs with Hub's extension:modules:build command.
import { runCommand } from "../run-command/index.mjs"

type BranchIdentity = {
  repository: string | null
  branch: string | null
  commitSha: string | null
}

type RemoteBranchResult = BranchIdentity &
  (
    | { state: "detached" | "unknown"; error: string }
    | { state: "present"; remoteSha: string }
    | { state: "absent"; remoteSha: null }
  )

type BranchRef = { ref: string; object: { type: "commit"; sha: string } }

// Matching refs returns [] for a missing branch; authorization/HTTP errors stay unknown.
export async function readRemoteBranch(
  { repository, branch, commitSha, repositoryPath }: BranchIdentity & { repositoryPath: string },
  run: typeof runCommand = runCommand,
): Promise<RemoteBranchResult> {
  const identity = { repository, branch, commitSha }
  if (!branch)
    return {
      ...identity,
      state: "detached",
      error: "Open a named branch before publishing.",
    }
  if (!repository || !commitSha)
    return {
      ...identity,
      state: "unknown",
      error: "The GitHub origin or checkout commit could not be verified.",
    }
  const result = await run(
    "gh",
    [
      "api",
      "--hostname",
      "github.com",
      `repos/${repository}/git/matching-refs/heads/${encodeURIComponent(branch)}`,
    ],
    repositoryPath,
  )
  if (!result.ok) return { ...identity, state: "unknown", error: result.error }
  let refs: unknown
  try {
    refs = JSON.parse(result.stdout)
  } catch {
    return {
      ...identity,
      state: "unknown",
      error: "GitHub returned invalid branch data.",
    }
  }
  if (
    !Array.isArray(refs) ||
    !refs.every(
      (ref: unknown): ref is BranchRef =>
        typeof ref === "object" &&
        ref !== null &&
        "ref" in ref &&
        typeof ref.ref === "string" &&
        /^refs\/heads\//.test(ref.ref) &&
        "object" in ref &&
        typeof ref.object === "object" &&
        ref.object !== null &&
        "type" in ref.object &&
        ref.object.type === "commit" &&
        "sha" in ref.object &&
        typeof ref.object.sha === "string" &&
        /^[0-9a-f]{40}$/.test(ref.object.sha),
    )
  )
    return {
      ...identity,
      state: "unknown",
      error: "GitHub returned invalid branch refs.",
    }
  const exact = refs.find((ref) => ref.ref === `refs/heads/${branch}`)
  return exact
    ? { ...identity, state: "present", remoteSha: exact.object.sha }
    : { ...identity, state: "absent", remoteSha: null }
}
