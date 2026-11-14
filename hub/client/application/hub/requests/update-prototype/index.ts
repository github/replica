import { prototypeEditSchema, prototypeResponseSchema } from "@application/hub/contracts"
import type { PrototypeEdit } from "@application/hub/contracts/types"

import { requestJson } from "../request-json"

export function updatePrototype(
  request: Request,
  repositoryId: string,
  prototypeId: string,
  details: PrototypeEdit,
) {
  return requestJson(
    new URL(`/api/repositories/${repositoryId}/prototypes/${prototypeId}`, request.url),
    prototypeResponseSchema,
    {
      method: "PATCH",
      signal: request.signal,
      body: JSON.stringify(prototypeEditSchema.parse(details)),
    },
  )
}
