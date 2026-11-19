import { Client } from "pg"

export async function withLearningExecutionLock<T>({
  databaseUrl,
  run,
  signal,
}: {
  databaseUrl: string
  run: (
    signal: AbortSignal,
    controls: {
      runWithoutRepositoryAuthorityLock: <Result>(
        operation: () => Promise<Result>,
      ) => Promise<Result>
    },
  ) => Promise<T>
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
    await client.query("SELECT pg_advisory_lock_shared(1919242348, 3)")
    controller.signal.throwIfAborted()
    running = run(controller.signal, {
      runWithoutRepositoryAuthorityLock: async <Result>(operation: () => Promise<Result>) => {
        const unlocked = await client.query<{ unlocked: boolean }>(
          "SELECT pg_advisory_unlock_shared(1919242348, 3) AS unlocked",
        )
        if (!unlocked.rows[0]?.unlocked) {
          throw new Error("Hub could not release its repository authority lock.")
        }
        try {
          return await operation()
        } finally {
          await client.query("SELECT pg_advisory_lock_shared(1919242348, 3)")
        }
      },
    })
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
