import { globSync, readFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parse } from "yaml"

export interface Dependency {
  ecosystem: "npm" | "github-actions"
  name: string
  version: string
  source: string
}

interface PublicationMetadata {
  time?: Record<string, unknown>
  commit?: { committer?: { date?: unknown } }
}

export function loadDependencies(root: string): Dependency[] {
  const dependencies = new Map<string, Dependency>()
  function add(dependency: Dependency) {
    const key = `${dependency.ecosystem}:${dependency.name}@${dependency.version}`
    const existing = dependencies.get(key)
    if (existing) existing.source += `, ${dependency.source}`
    else dependencies.set(key, dependency)
  }
  for (const path of globSync("**/package-lock.json", {
    cwd: root,
    exclude: ["**/node_modules/**", ".git/**", "starter/**"],
  })) {
    const lock = JSON.parse(readFileSync(resolve(root, path), "utf8"))
    if (!lock.packages || lock.lockfileVersion < 2) {
      throw new Error(`${path}: dependency age requires a lockfile with package metadata`)
    }
    for (const [location, value] of Object.entries(lock.packages)) {
      const pkg = value as { link?: boolean; name?: string; version?: string }
      if (!location.includes("node_modules/") || pkg.link || !pkg.version) continue
      const tail = location.split("node_modules/").at(-1)!
      const name =
        pkg.name ??
        tail
          .split("/")
          .slice(0, tail.startsWith("@") ? 2 : 1)
          .join("/")
      add({ ecosystem: "npm", name, version: pkg.version, source: path })
    }
  }
  for (const path of globSync([".github/workflows/**/*.{yml,yaml}", "actions/**/*.{yml,yaml}"], {
    cwd: root,
    exclude: ["**/node_modules/**"],
  })) {
    function visit(value: unknown) {
      if (!value || typeof value !== "object") return
      for (const [key, child] of Object.entries(value)) {
        if (key !== "uses") {
          visit(child)
          continue
        }
        if (typeof child !== "string") throw new Error(`${path}: invalid Action reference`)
        if (child.startsWith("./")) continue
        const match = /^([\w.-]+\/[\w.-]+(?:\/[\w./-]+)?)@([a-f0-9]{40})$/.exec(child)
        if (!match)
          throw new Error(`${path}: external actions must use a full commit SHA: ${child}`)
        add({ ecosystem: "github-actions", name: match[1], version: match[2], source: path })
      }
    }
    visit(parse(readFileSync(resolve(root, path), "utf8")))
  }
  return [...dependencies.values()]
}

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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = resolve(import.meta.dirname, "..")
    const result = await auditDependencies(loadDependencies(root))
    if (result.failures.length) {
      console.error(
        `Dependency age policy failed. Versions must be published on or before ${result.cutoff.toISOString()}.`,
      )
      console.error(result.failures.map((failure) => `- ${failure}`).join("\n"))
      process.exitCode = 1
    } else {
      console.log(
        `Dependency age policy passed for ${result.checkedCount} dependencies (${relative(process.cwd(), root) || "."}).`,
      )
    }
  } catch (error) {
    console.error(`Dependency age policy failed: ${(error as Error).message}`)
    process.exitCode = 1
  }
}
