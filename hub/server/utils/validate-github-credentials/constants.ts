import { z } from "zod"

export const credentialsSchema = z
  .object({
    appId: z
      .string()
      .regex(/^[1-9]\d*$/)
      .max(30),
    clientId: z.string().min(1).max(200),
    clientSecret: z.string().min(1).max(1000),
    privateKey: z.string().min(1).max(16384),
  })
  .strict()
