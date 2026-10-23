import type { Dependency } from "../load-dependencies/types.ts"
import { registryClient } from "../registry-client/index.ts"

export async function auditDependencies(
  dependencies: Dependency[],
  {
    publishedAt = registryClient(),
    now = new Date(),
  }: {
    publishedAt?: (dependency: Dependency) => Promise<string>
    now?: Date
  } = {},
) {
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  if (!Number.isFinite(cutoff.getTime())) throw new Error("Audit time is invalid")
  const failures: string[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(16, dependencies.length) }, async () => {
      while (next < dependencies.length) {
        const dependency = dependencies[next++]
        const identity = `${dependency.ecosystem}:${dependency.name}@${dependency.version} (${dependency.source})`
        try {
          const value = await publishedAt(dependency)
          const timestamp = Date.parse(value)
          if (!Number.isFinite(timestamp)) throw new Error("publication time is invalid")
          if (timestamp > cutoff.getTime()) failures.push(`${identity} was published at ${value}`)
        } catch (error) {
          failures.push(`${identity} could not be verified: ${(error as Error).message}`)
        }
      }
    }),
  )
  return { checkedCount: dependencies.length, cutoff, failures: failures.sort() }
}
