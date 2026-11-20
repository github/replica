import { z } from "zod"

const workflowPath = z
  .string()
  .max(255)
  .regex(/^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9_.-]*\.ya?ml$/)
const configuration = z.strictObject({
  version: z.literal(1),
  hub: z.unknown().optional(),
  templates: z.unknown().optional(),
  builds: z
    .strictObject({
      workflows: z.array(workflowPath).min(1).max(10).optional(),
    })
    .optional(),
})

/** Reads the repository's workflow selection without treating metadata as templates. */
export function readBuildWorkflowPaths(value: unknown): string[] {
  const parsed = configuration.safeParse(value)
  if (!parsed.success) {
    throw new Error(
      ".github/replica.json must be a version 1 configuration; builds.workflows must contain 1 to 10 unique .github/workflows/<filename>.yml or .yaml paths (at most 255 characters each).",
      { cause: parsed.error },
    )
  }
  const paths = parsed.data.builds?.workflows ?? [".github/workflows/replica.yml"]
  if (new Set(paths).size !== paths.length) {
    throw new Error(".github/replica.json builds.workflows must not contain duplicate paths.")
  }
  return paths
}
