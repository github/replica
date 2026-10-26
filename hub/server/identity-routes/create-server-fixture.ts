import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { onTestFinished } from "vitest"

import { createApp } from "../create-app/index.ts"
import { createFixture } from "../domains/identity/create-service/create-fixture.ts"

export async function createServerFixture() {
  const fixture = createFixture()
  const server = createServer(createApp(fixture))
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo

  return {
    ...fixture,
    request: (path: string, options?: RequestInit) =>
      fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual", ...options }),
  }
}
