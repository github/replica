import { errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose"
import { z } from "zod"

import { githubActionsIssuer } from "./constants.ts"
import type { GitHubActionsTokenResult } from "./types.ts"

const positiveInteger = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/)
  .transform(Number)
  .refine(Number.isSafeInteger)

const claimsSchema = z.object({
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  repository_id: positiveInteger,
  ref: z.string(),
  ref_type: z.string(),
  event_name: z.string(),
  workflow_ref: z.string(),
  sha: z.string(),
  run_id: positiveInteger,
  run_attempt: positiveInteger,
})

/**
 * Verifies a GitHub Actions OIDC token for Hub and confirms it came from a branch push
 * run of the repository's Replica workflow. Key-fetch failures throw so callers retry.
 */
export async function verifyGitHubActionsToken(
  token: string,
  options: { audience: string; keys: JWTVerifyGetKey; workflowPath: string },
): Promise<GitHubActionsTokenResult> {
  let payload: JWTPayload
  try {
    const verified = await jwtVerify(token, options.keys, {
      issuer: githubActionsIssuer,
      audience: options.audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat"],
      maxTokenAge: "10m",
    })
    payload = verified.payload
  } catch (error) {
    if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) {
      return { status: "invalid" }
    }
    throw error
  }
  const parsed = claimsSchema.safeParse(payload)
  if (!parsed.success) return { status: "invalid" }
  const claims = parsed.data
  if (claims.workflow_ref.split("@")[0] !== `${claims.repository}/${options.workflowPath}`) {
    return { status: "forbidden", reason: `Only ${options.workflowPath} may publish Builds.` }
  }
  const branchName = claims.ref.startsWith("refs/heads/") ? claims.ref.slice(11) : ""
  if (
    claims.event_name !== "push" ||
    claims.ref_type !== "branch" ||
    !branchName ||
    branchName === "replica/install-workflow"
  ) {
    return { status: "forbidden", reason: "Only branch push runs may publish Builds." }
  }
  if (!/^[0-9a-f]{40}$/.test(claims.sha)) return { status: "invalid" }
  return {
    status: "verified",
    run: {
      githubRepositoryId: claims.repository_id,
      repository: claims.repository,
      branchName,
      commitSha: claims.sha,
      runId: claims.run_id,
      runAttempt: claims.run_attempt,
    },
  }
}
