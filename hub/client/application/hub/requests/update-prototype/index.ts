import { prototypeDetailsSchema, prototypeResponseSchema } from "@application/hub/contracts"
import type { PrototypeDetails } from "@application/hub/contracts/types"

import { requestJson } from "../request-json"

export function updatePrototype(
  request: Request,
  repositoryId: string,
  prototypeId: string,
  details: PrototypeDetails,
) {
  return requestJson(
    new URL(`/api/repositories/${repositoryId}/prototypes/${prototypeId}`, request.url),
    prototypeResponseSchema,
    {
      method: "PATCH",
      signal: request.signal,
      body: JSON.stringify(prototypeDetailsSchema.parse(details)),
    },
  )
}
