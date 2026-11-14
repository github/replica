export const guidedPostgresProfile = {
  postgres_sku: "B_Standard_B1ms",
  postgres_version: "17",
} as const

export interface PostgresProfile {
  postgres_sku: string
  postgres_version: string
}

export type PostgresAvailability = (
  subscriptionId: string,
  location: string,
  profile: PostgresProfile,
) => Promise<boolean>
