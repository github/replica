import { appliedLearningsResponseSchema } from "@application/hub/learnings-contracts"

import { requestJson } from "../request-json"

/** Reads what agents said they applied in the commit a Build was made from. */
export function getAppliedLearnings(
  request: Request,
  repositoryId: string,
  prototypeId: string,
  commitSha: string,
) {
  const url = new URL(`/api/repositories/${repositoryId}/learnings/applied`, request.url)
  url.searchParams.set("prototype", prototypeId)
  url.searchParams.set("commit", commitSha)
  return requestJson(url, appliedLearningsResponseSchema, { signal: request.signal })
}
