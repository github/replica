import { once } from "node:events"
import pino from "pino"

import { prisma } from "../../integrations/prisma/index.ts"
import { createAuthenticationRouteDependencies } from "../../routes/api/auth/create-authentication-route-dependencies/index.ts"
import { createProductRouteDependencies } from "../../routes/api/product/create-product-route-dependencies/index.ts"
import { runApi } from "../index.ts"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl || !process.send) throw new Error("Run this fixture through the database test.")
const connection = new URL(databaseUrl)
if (
  !["localhost", "127.0.0.1"].includes(connection.hostname) ||
  !/^\/replica_test_[0-9a-f]{16}_[1-9]\d*$/.test(connection.pathname)
) {
  throw new Error("The review fixture requires an isolated test database.")
}
const authentication = await createAuthenticationRouteDependencies(process.env)
const controller = new AbortController()
const logger = pino({ level: "silent" })
let port: unknown
let listening = false
logger.info = (input: unknown) => {
  if (typeof input === "object" && input && "port" in input) port = input.port
  if (input === "Review live updates are listening") listening = true
  if (typeof port === "number" && listening) process.send?.({ port })
}
const stopping = runApi({
  port: 0,
  databaseUrl,
  authentication,
  product: createProductRouteDependencies({ scopeGitHubMembers: Boolean(authentication.github) }),
  logger,
  signal: controller.signal,
})
try {
  await Promise.race([once(process, "disconnect"), stopping])
} finally {
  controller.abort()
  await stopping
  await prisma.$disconnect()
}
