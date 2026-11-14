import type { RunCommand } from "../../../installer/types.ts"
import type { PostgresAvailability } from "../profile.ts"
import { supportsPostgresProfile } from "../supports-postgres-profile/index.ts"

export function createPostgresAvailability(run: RunCommand): PostgresAvailability {
  const catalogues = new Map<string, Promise<unknown>>()
  const waiting: (() => void)[] = []
  let active = 0
  async function load(subscriptionId: string, location: string): Promise<unknown> {
    if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve))
    else active++
    try {
      return JSON.parse(
        await run(
          "az",
          [
            "postgres",
            "flexible-server",
            "list-skus",
            "--subscription",
            subscriptionId,
            "--location",
            location,
            "--query",
            "[].{status:status,restricted:restricted,supportedServerVersions:supportedServerVersions[].{name:name,status:status},supportedServerEditions:supportedServerEditions[].{name:name,status:status,supportedServerSkus:supportedServerSkus[].{name:name,status:status}}}",
            "--output",
            "json",
            "--only-show-errors",
          ],
          { label: "Check regional PostgreSQL SKUs and versions" },
        ),
      ) as unknown
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
  return async (subscriptionId, location, profile) => {
    const key = `${subscriptionId.toLowerCase()}/${location.toLowerCase()}`
    let catalogue = catalogues.get(key)
    if (!catalogue) {
      catalogue = load(subscriptionId, location).catch((error: unknown) => {
        if (catalogues.get(key) === catalogue) catalogues.delete(key)
        throw error
      })
      catalogues.set(key, catalogue)
    }
    try {
      return supportsPostgresProfile(await catalogue, profile)
    } catch (error) {
      if (catalogues.get(key) === catalogue) catalogues.delete(key)
      throw error
    }
  }
}
