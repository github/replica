import type { Request } from "express"

import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value/index.ts"
import { hubSessionCookieName } from "../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import type { AdministratorRouteDependencies } from "../../auth/types.ts"

export async function readAdministratorSession(
  request: Request,
  dependencies: Pick<AdministratorRouteDependencies, "findSession">,
) {
  const sessionValue = readCookie(request, hubSessionCookieName)
  return sessionValue
    ? dependencies.findSession(hashAuthenticationValue(sessionValue))
    : Promise.resolve(null)
}
