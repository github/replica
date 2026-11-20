import { once } from "node:events"

import { createTcpForwarder } from "./create-tcp-forwarder/index.ts"

const runtimeForwarder = createTcpForwarder({
  listenHost: "127.0.0.1",
  listenPort: 8010,
  targetHost: "host.docker.internal",
  targetPort: 8010,
})
const apiForwarder = createTcpForwarder({
  listenHost: "0.0.0.0",
  listenPort: 3002,
  targetHost: "127.0.0.1",
  targetPort: 3001,
})

try {
  await Promise.all([once(runtimeForwarder, "listening"), once(apiForwarder, "listening")])
  await import("../start-local-api/index.ts")
} finally {
  runtimeForwarder.close()
  apiForwarder.close()
}
