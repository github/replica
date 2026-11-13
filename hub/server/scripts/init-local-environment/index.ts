import { randomBytes } from "node:crypto"
import { chmod, readFile, rename, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { parseArgs } from "node:util"

import { updateEnvironmentFile } from "./update-environment-file/index.ts"

const { values: options } = parseArgs({ options: { "private-key": { type: "string" } } })
const environmentPath = resolve(".env")

async function readOptional(path: string) {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

async function readPrivateKey(path: string) {
  const pem = await readFile(path, "utf8")
  if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(pem)) {
    throw new Error(`${path} is not a PEM private key downloaded from the GitHub App.`)
  }
  return Buffer.from(pem).toString("base64")
}

const existing = await readOptional(environmentPath)
const values: Record<string, string> = {
  HUB_APPLICATION_ORIGIN: "http://127.0.0.1:5173",
  HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  HUB_BOOTSTRAP_SECRET: randomBytes(32).toString("base64url"),
}
if (options["private-key"]) {
  values.GITHUB_APP_PRIVATE_KEY_BASE64 = await readPrivateKey(options["private-key"])
}
const { content, changes } = updateEnvironmentFile(
  existing ?? (await readFile(resolve(".env.example"), "utf8")),
  values,
)

const temporaryPath = `${environmentPath}.${process.pid}.tmp`
await writeFile(temporaryPath, content, { mode: 0o600 })
await rename(temporaryPath, environmentPath)
await chmod(environmentPath, 0o600)

console.log(existing === null ? "Created .env from .env.example." : "Updated .env.")
for (const { key, outcome } of changes) {
  console.log(outcome === "added" ? `  Added ${key}` : `  Kept existing ${key}`)
}
console.log("Restart the API, then open /settings/github/setup to finish GitHub App setup.")
