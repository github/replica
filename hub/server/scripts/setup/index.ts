import "dotenv/config"
import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { logger } from "../../integrations/pino/index.ts"
import { withSetupLock } from "../../integrations/postgres/with-setup-lock/index.ts"

export async function setup() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("Setup requires DATABASE_URL.")
  if (
    process.env.DATABASE_RUNTIME_ROLE !== undefined &&
    (process.env.DATABASE_RUNTIME_ROLE !== "replica_runtime" ||
      new URL(databaseUrl).username !== "replica_migration")
  ) {
    throw new Error("Separate roles require replica_runtime and a replica_migration database URL.")
  }
  const learningMigrationUrl = process.env.REPLICA_LEARNING_MIGRATION_DATABASE_URL
  const learningRuntimeRole = process.env.REPLICA_LEARNING_RUNTIME_ROLE
  if (
    (learningRuntimeRole && learningRuntimeRole !== "replica_learning_runtime") ||
    (learningRuntimeRole && !learningMigrationUrl)
  ) {
    throw new Error("Learning runtime grants require the learning migration URL and runtime role.")
  }
  const controller = new AbortController()
  function stop() {
    controller.abort()
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  try {
    await withSetupLock({
      databaseUrl,
      signal: controller.signal,
      run: async (signal) => {
        const extension = import.meta.url.endsWith(".js") ? "js" : "ts"
        const jobScript = new URL(`../setup-jobs/index.${extension}`, import.meta.url)
        const grantScript = new URL(
          `../grant-runtime-database-access/index.${extension}`,
          import.meta.url,
        )
        const learningGrantScript = new URL(
          `../grant-learning-database-access/index.${extension}`,
          import.meta.url,
        )
        const steps = [
          {
            name: "prisma",
            args: [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
          },
          { name: "jobs", args: [fileURLToPath(jobScript)] },
          ...(process.env.DATABASE_RUNTIME_ROLE
            ? [{ name: "runtime-grants", args: [fileURLToPath(grantScript)] }]
            : []),
          ...(learningMigrationUrl
            ? [
                {
                  name: "learning-migrate",
                  args: [
                    resolve(
                      process.env.REPLICA_LEARNING_CLI ??
                        "../packages/learning/bin/replica-learning.mjs",
                    ),
                    "migrate",
                  ],
                },
              ]
            : []),
          ...(learningRuntimeRole
            ? [{ name: "learning-grants", args: [fileURLToPath(learningGrantScript)] }]
            : []),
        ]
        for (const { name, args } of steps) {
          signal.throwIfAborted()
          logger.info({ step: name }, "Hub setup step started")
          // Migration tools can include database URLs in diagnostics; keep their output private.
          const child = spawn(process.execPath, args, { stdio: "ignore" })
          let timeout: ReturnType<typeof setTimeout> | undefined
          function terminate() {
            child.kill("SIGTERM")
            timeout = setTimeout(() => child.kill("SIGKILL"), 5_000)
          }
          signal.addEventListener("abort", terminate, { once: true })
          if (signal.aborted) terminate()
          try {
            await new Promise<void>((resolve, reject) => {
              child.once("error", reject)
              child.once("close", (code) => {
                if (code === 0) resolve()
                else reject(new Error("Hub setup step failed; check database and schema access."))
              })
            })
            signal.throwIfAborted()
          } finally {
            signal.removeEventListener("abort", terminate)
            clearTimeout(timeout)
          }
        }
      },
    })
    logger.info("Hub setup completed")
  } finally {
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await setup()
  } catch (error) {
    logger.fatal(
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      "Hub setup failed; check database access, migrations, and concurrent releases",
    )
    process.exitCode = 1
  }
}
