import { z } from "zod"

export const installationTokenSchema = z.object({ token: z.string().min(1) })
