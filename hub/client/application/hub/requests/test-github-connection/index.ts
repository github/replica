import { githubConnectionTestSchema } from "@application/hub/github-setup-contracts"

import { bootstrapSecretHeader } from "../get-github-setup-status"
import { requestJson } from "../request-json"

export function testGitHubConnection(request: Request, bootstrapSecret?: string) {
  return requestJson(
    new URL("/api/settings/github/test", request.url),
    githubConnectionTestSchema,
    {
      method: "POST",
      signal: request.signal,
      headers: bootstrapSecret ? { [bootstrapSecretHeader]: bootstrapSecret } : undefined,
    },
  )
}
