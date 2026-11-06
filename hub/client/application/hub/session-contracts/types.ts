import type { z } from "zod"

import type { sessionResponseSchema } from "."

export type SessionResponse = z.infer<typeof sessionResponseSchema>
