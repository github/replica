import { realpath } from "node:fs/promises"
import path from "node:path"

import { readChecksFile, validateChecksConfigFiles } from "./files.mjs"
import { validateChecksConfig } from "./index.mjs"

try {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Usage: node validate.mjs [repository-directory]\nValidates .replica/checks.json and its guidance files without running checks.",
    )
  } else {
    if (args.length > 1 || args.some((argument) => argument.startsWith("-")))
      throw new Error("Usage: node validate.mjs [repository-directory]")
    const root = await realpath(path.resolve(args[0] ?? "."))
    const source = await readChecksFile(root, ".replica/checks.json", 8 * 1024 * 1024)
    let value
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source))
    } catch (cause) {
      throw new Error(".replica/checks.json must contain valid UTF-8 JSON.", { cause })
    }
    const config = validateChecksConfig(value)
    await validateChecksConfigFiles(config, root)
    console.log(`Valid .replica/checks.json: ${config.checks.length} check(s).`)
  }
} catch (cause) {
  console.error(
    `Checks configuration validation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
  )
  process.exitCode = 1
}
