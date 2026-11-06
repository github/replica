import { buildResponseSchema } from "@application/hub/contracts"

import { requestJson } from "../request-json"

export function getBuild(
  request: Request,
  repositoryId: number,
  prototypeId: number,
  buildNumber: number,
) {
  return requestJson(
    new URL(
      `/api/repositories/${repositoryId}/prototypes/${prototypeId}/builds/${buildNumber}`,
      request.url,
    ),
    buildResponseSchema,
    {
      signal: request.signal,
    },
  )
}
