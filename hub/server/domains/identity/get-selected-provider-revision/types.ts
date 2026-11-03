import type { AuthenticationProviderRecord } from "../run-provider-revision-transaction/types.ts"

export interface GetSelectedProviderRevisionDependencies {
  findAuthenticationProvider(key: string): Promise<AuthenticationProviderRecord | null>
}
