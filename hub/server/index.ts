import "dotenv/config"

import { createApp } from "#server/create-app"
import { createIdentityRuntime } from "#server/domains/identity/create-runtime"

const port = Number(process.env.PORT ?? 3001)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.")
}

const identity = await createIdentityRuntime(process.env)

createApp(identity).listen(port, "127.0.0.1", () => {
  console.info(`Hub API listening at http://127.0.0.1:${port}`)
})
