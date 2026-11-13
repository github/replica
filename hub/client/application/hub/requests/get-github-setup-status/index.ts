import { githubSetupStatusSchema } from "@application/hub/github-setup-contracts"

import { requestJson } from "../request-json"

export const bootstrapSecretHeader = "x-hub-bootstrap-secret"

export function getGitHubSetupStatus(request: Request, bootstrapSecret?: string) {
  return requestJson(new URL("/api/settings/github/status", request.url), githubSetupStatusSchema, {
    signal: request.signal,
    headers: bootstrapSecret ? { [bootstrapSecretHeader]: bootstrapSecret } : undefined,
  })
}
