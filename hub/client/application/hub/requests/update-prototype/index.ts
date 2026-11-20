import { prototypeEditSchema, prototypeResponseSchema } from "@application/hub/contracts"
import type { PrototypeEdit } from "@application/hub/contracts/types"

import { requestJson } from "../request-json"

export function updatePrototype(
  request: Request,
  repositoryId: string,
  prototypeId: string,
  details: PrototypeEdit,
  listing = false,
) {
  const collection = listing ? "prototype-management" : "prototypes"
  return requestJson(
    new URL(`/api/repositories/${repositoryId}/${collection}/${prototypeId}`, request.url),
    prototypeResponseSchema,
    {
      method: "PATCH",
      signal: request.signal,
      body: JSON.stringify(prototypeEditSchema.parse(details)),
    },
  )
}
