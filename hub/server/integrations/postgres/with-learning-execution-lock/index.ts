import { Client } from "pg"

export async function withLearningExecutionLock<T>({
  databaseUrl,
  run,
  signal,
}: {
  databaseUrl: string
  run: (signal: AbortSignal) => Promise<T>
  signal?: AbortSignal
}) {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 })
  const controller = new AbortController()
  function abort() {
    controller.abort(signal?.reason)
  }
  signal?.addEventListener("abort", abort, { once: true })
  let rejectConnection!: (error: Error) => void
  const connectionFailed = new Promise<never>((_resolve, reject) => {
    rejectConnection = reject
  })
  void connectionFailed.catch(() => {})
  client.on("error", () => {
    const error = new Error("Hub lost its learning execution lock connection.")
    controller.abort(error)
    rejectConnection(error)
  })
  let running: Promise<T> | undefined
  try {
    if (signal?.aborted) controller.abort(signal.reason)
    controller.signal.throwIfAborted()
    await client.connect()
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(1919242348, 2) AS locked",
    )
    if (!result.rows[0]?.locked) throw new Error("Another learning operation is still running.")
    controller.signal.throwIfAborted()
    running = run(controller.signal)
    return await Promise.race([running, connectionFailed])
  } finally {
    controller.abort()
    signal?.removeEventListener("abort", abort)
    try {
      await running
    } finally {
      await client.end()
    }
  }
}
