import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { CopilotTokenCheckError } from "./errors.ts"

const checkTimeoutMilliseconds = 20_000

function classify(error: unknown): "refused" | "unavailable" {
  const message = String(error instanceof Error ? error.message : error).slice(0, 500)
  return /\b40[13]\b|unauthori[sz]ed|forbidden|authenticat|not signed in|no copilot|subscription|access denied/i.test(
    message,
  )
    ? "refused"
    : "unavailable"
}

export async function checkCopilotToken(token: string): Promise<void> {
  const sdk = await import("@github/copilot-sdk").catch((error: unknown) => {
    throw new CopilotTokenCheckError("unavailable", { cause: error })
  })
  const home = await mkdtemp(path.join(tmpdir(), "replica-hub-copilot-"))
  const client = new sdk.CopilotClient({
    baseDirectory: home,
    gitHubToken: token,
    logLevel: "error",
    mode: "empty",
    useLoggedInUser: false,
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      (async () => {
        await client.start()
        const authentication = await client.getAuthStatus()
        if (!authentication?.isAuthenticated) throw new CopilotTokenCheckError("refused")
        await client.listModels()
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new CopilotTokenCheckError("unavailable")),
          checkTimeoutMilliseconds,
        )
      }),
    ])
  } catch (error) {
    if (error instanceof CopilotTokenCheckError) throw error
    throw new CopilotTokenCheckError(classify(error), { cause: error })
  } finally {
    if (timeout) clearTimeout(timeout)
    await client.stop().catch(() => undefined)
    await rm(home, { force: true, recursive: true })
  }
}
