import { data } from "react-router"
import { z } from "zod"

import { ApiRequestError } from "@application/hub/requests/api-request-error"

export const canvasConnectionsPath = "/canvas/connections"
export const canvasCodeSchema = z
  .string()
  .length(10)
  .regex(/^[A-F0-9]+$/)

export const canvasApprovalSchema = z
  .object({
    code: canvasCodeSchema,
    repository: z.string().min(1),
    expiresAt: z.iso.datetime(),
  })
  .strict()

export const canvasConnectionsSchema = z
  .object({
    connections: z.array(
      z
        .object({
          id: z.number().int().positive(),
          repository: z.string().min(1),
          expiresAt: z.iso.datetime(),
          inactiveAt: z.iso.datetime().nullable(),
        })
        .strict(),
    ),
  })
  .strict()

export function canvasActionError(error: unknown) {
  if (!(error instanceof ApiRequestError)) throw error
  return data({ error: error.message }, { status: error.status || 503 })
}

export function canvasFormDestination(form: FormData, base: string) {
  const action = form.get("_action")
  const url = typeof action === "string" ? URL.parse(action, base) : null
  return url?.origin === new URL(base).origin ? url : null
}
