import type { Dependency } from "../load-dependencies/types.ts"
import type { PublicationMetadata } from "./types.ts"

export function registryClient(
  request: typeof fetch = fetch,
  token = process.env.GH_TOKEN,
): (dependency: Dependency) => Promise<string> {
  const cache = new Map<string, Promise<PublicationMetadata>>()
  function json(url: string, github = false): Promise<PublicationMetadata> {
    if (!cache.has(url)) {
      cache.set(
        url,
        (async () => {
          const response = await request(url, {
            headers: github && token ? { Authorization: `Bearer ${token}` } : {},
            signal: AbortSignal.timeout(30_000),
          })
          if (!response.ok) throw new Error(`${new URL(url).host} returned ${response.status}`)
          return (await response.json()) as PublicationMetadata
        })(),
      )
    }
    return cache.get(url)!
  }
  return async (dependency) => {
    let timestamp: unknown
    if (dependency.ecosystem === "npm") {
      const metadata = await json(
        `https://registry.npmjs.org/${encodeURIComponent(dependency.name)}`,
      )
      timestamp = metadata.time?.[dependency.version]
    } else {
      const repository = dependency.name.split("/").slice(0, 2).join("/")
      const metadata = await json(
        `https://api.github.com/repos/${repository}/commits/${dependency.version}`,
        true,
      )
      timestamp = metadata.commit?.committer?.date
    }
    if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))) {
      throw new Error("publication time is unavailable or invalid")
    }
    return timestamp
  }
}
