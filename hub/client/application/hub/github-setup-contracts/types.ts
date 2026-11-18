import type { z } from "zod"

import type { githubConnectionTestSchema, githubSettingKeySchema, githubSetupStatusSchema } from "."

export type GitHubSettingKey = z.infer<typeof githubSettingKeySchema>
export type GitHubSetupStatus = z.infer<typeof githubSetupStatusSchema>
export type GitHubConnectionCheck = z.infer<typeof githubConnectionTestSchema>["checks"][number]
