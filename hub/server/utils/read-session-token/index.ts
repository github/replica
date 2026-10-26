import type { Request } from "express"

import { getIdentityCookies } from "#server/utils/get-identity-cookies"
import type { IdentitySettings } from "#server/utils/identity-contracts/types"
import { readCookie } from "#server/utils/read-cookie"

export function readSessionToken(request: Request, settings: IdentitySettings): string {
  return readCookie(request.headers.cookie, getIdentityCookies(settings).sessionName)
}
