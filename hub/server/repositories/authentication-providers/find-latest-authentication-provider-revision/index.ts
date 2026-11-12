import type { FindLatestAuthenticationProviderRevisionDatabase } from "./types.ts"

export async function findLatestAuthenticationProviderRevision(
  database: FindLatestAuthenticationProviderRevisionDatabase,
  key: string,
) {
  const provider = await database.authenticationProvider.findUnique({
    where: { key },
    select: {
      enabled: true,
      revisions: {
        orderBy: { revision: "desc" },
        select: { configurationDigest: true, revision: true },
        take: 1,
      },
    },
  })
  const latest = provider?.revisions[0]
  if (!provider || !latest) return null
  return { enabled: provider.enabled, ...latest }
}
