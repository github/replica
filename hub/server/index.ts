import "dotenv/config"

import { createApp } from "./create-app/index.ts"
import { createAuthenticationRuntime } from "./domains/authentication/create-runtime/index.ts"
import { log } from "./integrations/pino/log/index.ts"

const port = Number(process.env.PORT ?? 3001)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.")
}

const authentication = await createAuthenticationRuntime(process.env)
const reconciliationInterval = setInterval(() => {
  void authentication.githubAuthorization.reconcileDue().catch(() => {
    log("error", "GitHub authorization reconciliation failed", {
      reason: "reconciliation_failed",
    })
  })
}, 15 * 60_000)
reconciliationInterval.unref()

createApp({ authentication }).listen(port, "127.0.0.1", () => {
  log("info", "Hub API listening", { host: "127.0.0.1", port })
})
