import { z } from "zod"

export function parseRuntimeConfig(env: NodeJS.ProcessEnv) {
  const mode = z
    .enum(["api", "combined", "on-demand", "scheduled", "setup"])
    .parse(env.RUNTIME_MODE ?? "api")
  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(env.PORT ?? 3001)
  const host = z
    .string()
    .trim()
    .min(1)
    .parse(env.HOST ?? "127.0.0.1")
  const shutdownTimeoutMs = z.coerce
    .number()
    .int()
    .min(1)
    .max(300_000)
    .parse(env.SHUTDOWN_TIMEOUT_MS ?? 30_000)
  const concurrency = z.coerce.number().int().min(1).max(100)
  const databaseUrl = mode === "api" ? env.DATABASE_URL : z.string().min(1).parse(env.DATABASE_URL)
  if (databaseUrl) {
    let url: URL
    try {
      url = new URL(databaseUrl)
    } catch {
      throw new Error("DATABASE_URL must be a PostgreSQL connection URL.")
    }
    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
      throw new Error("DATABASE_URL must be a PostgreSQL connection URL.")
    }
  }
  if (env.CLIENT_DIRECTORY !== undefined && !env.CLIENT_DIRECTORY.trim()) {
    throw new Error("CLIENT_DIRECTORY must be a nonempty directory.")
  }
  return {
    mode,
    hasArtifactStorage: [
      "ARTIFACT_STORAGE_PROVIDER",
      "ARTIFACT_STORAGE_DIRECTORY",
      "AZURE_STORAGE_ACCOUNT",
      "AZURE_STORAGE_CONTAINER",
    ].some((name) => env[name] !== undefined),
    port,
    host,
    shutdownTimeoutMs,
    databaseUrl,
    clientDirectory: env.CLIENT_DIRECTORY,
    onDemandConcurrency: concurrency.parse(env.ON_DEMAND_JOB_CONCURRENCY ?? 1),
    scheduledConcurrency: concurrency.parse(env.SCHEDULED_JOB_CONCURRENCY ?? 1),
  }
}
