import { z } from "zod"

export const installationBranch = "replica/install-workflow"
export const replicaWorkflowPath = ".github/workflows/replica.yml"
export const replicaArtifactName = "replica-build-v1"

export const githubId = z.number().int().positive()
export const githubCommitSha = z.string().regex(/^[0-9a-f]{40}$/)
export const githubBranchName = z
  .string()
  .refine(
    (value) =>
      Buffer.byteLength(value) <= 255 &&
      !/[\p{Cc}\p{Cs}\s~^:?*[\]\\]|\.\.|@\{/u.test(value) &&
      !value.endsWith(".") &&
      value !== "@" &&
      value
        .split("/")
        .every((segment) => segment && !segment.startsWith(".") && !segment.endsWith(".lock")),
  )

export function githubRepositoryPath(nameWithOwner: string) {
  const parts = nameWithOwner.split("/")
  if (
    parts.length !== 2 ||
    parts.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === "..")
  ) {
    throw new Error("GitHub returned an invalid repository name.")
  }
  return `/repos/${parts.join("/")}`
}
