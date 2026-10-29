import type { Prisma } from "../../generated/prisma/client.ts"

export interface AuthenticationProviderInput {
  key: string
  type: "github" | "oidc"
  enabled: boolean
  revision: number
  issuer: string
  configuration: Prisma.InputJsonValue
}
