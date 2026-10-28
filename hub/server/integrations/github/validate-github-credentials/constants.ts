import { z } from "zod"

const githubIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .max(30)

export const credentialsSchema = z
  .object({
    appId: githubIdSchema,
    installationId: githubIdSchema,
    clientId: z.string().min(1).max(200),
    clientSecret: z.string().min(1).max(1000),
    privateKey: z.string().min(1).max(16384),
  })
  .strict()
