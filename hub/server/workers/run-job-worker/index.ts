import { z } from "zod"

import { createJobWorker } from "../../integrations/bullmq/create-job-worker/index.ts"
import type { JobConnection, JobProcessor } from "../../integrations/bullmq/types.ts"

export async function runJobWorker({
  shutdownTimeoutMs = 30_000,
  ...options
}: JobConnection & {
  processors: JobProcessor[]
  concurrency?: number
  shutdownTimeoutMs?: number
}) {
  z.number().int().positive().parse(shutdownTimeoutMs)
  const worker = createJobWorker(options)
  let stopped = false
  let resolveStop: () => void
  function stop() {
    stopped = true
    resolveStop()
  }
  const stopping = new Promise<void>((resolve) => {
    resolveStop = resolve
  })
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)

  let running: Promise<void> | undefined
  try {
    await Promise.race([worker.waitUntilReady(), stopping])
    if (stopped) return
    running = worker.run()
    options.logger.info({ queue: options.name }, "Job worker ready")
    await Promise.race([running, stopping])
  } finally {
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
    options.logger.info({ queue: options.name }, "Job worker stopping")
    let timer: ReturnType<typeof setTimeout> | undefined
    async function drain() {
      await worker.close()
      await running
    }
    try {
      await Promise.race([
        drain(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("Job worker exceeded its shutdown deadline."))
          }, shutdownTimeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
}
