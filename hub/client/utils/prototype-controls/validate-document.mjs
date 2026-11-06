import { readFileSync } from "node:fs"
import { validateControlsDocument } from "./controls.mjs"

try {
  const source = readFileSync(process.argv[2] ?? 0, "utf8")
  if (Buffer.byteLength(source) > 256_000)
    throw new Error("controls.replica.json exceeds the 256,000-byte limit.")
  validateControlsDocument(JSON.parse(source))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
