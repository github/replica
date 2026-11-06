import { prototypeDetailsSchema, prototypeResponseSchema } from "../../contracts"
import type { PrototypeDetails } from "../../contracts/types"
import { requestJson } from "../request-json"

export function updatePrototype(
  request: Request,
  repositoryId: number,
  prototypeId: number,
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
