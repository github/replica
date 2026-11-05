import type { RequestHandler } from "express"

import { redirectAuthenticationStart } from "../../../../../../integrations/express/redirect-authentication-start/index.ts"
import type { StartAuthenticationDependencies } from "../../../types.ts"

export function post(dependencies: StartAuthenticationDependencies): RequestHandler {
  return async (_request, response, next) => {
    try {
      redirectAuthenticationStart(response, dependencies.secureCookie, await dependencies.start())
    } catch (error) {
      next(error)
    }
  }
}
