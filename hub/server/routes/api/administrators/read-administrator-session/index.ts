import type { Request } from "express"

import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value/index.ts"
import { readHubSessionCookie } from "../../../../integrations/express/read-hub-session-cookie/index.ts"
import type { AdministratorRouteDependencies } from "../../auth/types.ts"

export async function readAdministratorSession(
  request: Request,
  dependencies: Pick<AdministratorRouteDependencies, "findSession">,
) {
  const sessionValue = readHubSessionCookie(request)
  return sessionValue
    ? dependencies.findSession(hashAuthenticationValue(sessionValue))
    : Promise.resolve(null)
}
