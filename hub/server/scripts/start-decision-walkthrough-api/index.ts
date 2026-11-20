import { once } from "node:events"

import { createTcpForwarder } from "./create-tcp-forwarder/index.ts"

const runtimeForwarder = createTcpForwarder({
  listenHost: "127.0.0.1",
  listenPort: 8010,
  targetHost: "decision-runtime",
  targetPort: 8010,
})

try {
  await once(runtimeForwarder, "listening")
  await import("../start-local-api/index.ts")
} finally {
  runtimeForwarder.close()
}
