import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value/index.ts"
import type { CurrentSessionDependencies } from "../../auth/types.ts"

export function readProductSession(value: string | null, dependencies: CurrentSessionDependencies) {
  return value ? dependencies.restore(hashAuthenticationValue(value)) : Promise.resolve(null)
}
