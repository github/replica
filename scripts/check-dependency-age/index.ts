import { relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { auditDependencies } from "./audit-dependencies/index.ts"
import { loadDependencies } from "./load-dependencies/index.ts"

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = resolve(import.meta.dirname, "../..")
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
