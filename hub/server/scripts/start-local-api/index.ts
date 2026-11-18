import "dotenv/config"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"

// Make local sign-in the default for the development API. Use dev:api:live when
// testing a real provider.
process.env.NODE_ENV ??= "development"
process.env.HUB_LOCAL_MODE = "true"
process.env.HUB_LOCAL_SIGN_IN = "true"
if (!process.env.ARTIFACT_STORAGE_PROVIDER && process.platform === "linux") {
  process.env.ARTIFACT_STORAGE_PROVIDER = "filesystem"
}
if (process.env.ARTIFACT_STORAGE_PROVIDER === "filesystem") {
  process.env.ARTIFACT_STORAGE_DIRECTORY ??= resolve("storage/artifacts")
  await mkdir(process.env.ARTIFACT_STORAGE_DIRECTORY, { recursive: true })
}
process.env.HUB_PREVIEW_ORIGIN ??= `http://preview.localhost:${process.env.PORT ?? "3001"}`

await import("../../index.ts")
