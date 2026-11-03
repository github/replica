import { Client } from "pg"

export async function withSetupLock({
  databaseUrl,
  run,
  signal,
}: {
  databaseUrl: string
  run: (signal: AbortSignal) => Promise<void>
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
    const error = new Error("Setup lost its database lock connection.")
    controller.abort(error)
    rejectConnection(error)
  })
  let running: Promise<void> | undefined
  try {
    if (signal?.aborted) controller.abort(signal.reason)
    controller.signal.throwIfAborted()
    await client.connect()
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(1919242348, 1) AS locked",
    )
    if (!result.rows[0]?.locked) throw new Error("Another Hub setup is already running.")
    controller.signal.throwIfAborted()
    running = run(controller.signal)
    await Promise.race([running, connectionFailed])
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
