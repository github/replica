import { Client } from "pg"

export class DecisionModelControlBusyError extends Error {
  constructor() {
    super("Another decision-model control operation is still running.")
    this.name = "DecisionModelControlBusyError"
  }
}

export async function withDecisionModelControlLock<T>(input: {
  databaseUrl: string
  run: (signal: AbortSignal) => Promise<T>
}) {
  const client = new Client({
    connectionString: input.databaseUrl,
    connectionTimeoutMillis: 5_000,
  })
  const controller = new AbortController()
  let rejectConnection!: (error: Error) => void
  const connectionFailed = new Promise<never>((_resolve, reject) => {
    rejectConnection = reject
  })
  void connectionFailed.catch(() => {})
  client.on("error", () => {
    const error = new Error("Hub lost its decision-model control lock connection.")
    controller.abort(error)
    rejectConnection(error)
  })
  let running: Promise<T> | undefined
  try {
    await client.connect()
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(1919242348, 3) AS locked",
    )
    if (!result.rows[0]?.locked) throw new DecisionModelControlBusyError()
    running = input.run(controller.signal)
    return await Promise.race([running, connectionFailed])
  } finally {
    controller.abort()
    try {
      await running
    } finally {
      await client.end()
    }
  }
}
