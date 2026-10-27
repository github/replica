import { z } from "zod"

export const httpErrorSchema = z.object({ status: z.int().min(400).max(599) })
