import type { z } from "zod"

import type { copilotConnectionStatusSchema } from "."

export type CopilotConnectionStatus = z.infer<typeof copilotConnectionStatusSchema>
