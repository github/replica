import { globSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

import { parse } from "yaml"

import type { Dependency } from "./types.ts"

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
