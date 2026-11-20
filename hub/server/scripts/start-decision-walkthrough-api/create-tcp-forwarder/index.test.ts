import { once } from "node:events"
import { createConnection, createServer, type AddressInfo } from "node:net"
import { describe, expect, it } from "vitest"

import { createTcpForwarder } from "."

describe("createTcpForwarder()", () => {
  it("forwards bytes between one local listener and target", async () => {
    const target = createServer((socket) => socket.end("ready"))
    target.listen(0, "127.0.0.1")
    await once(target, "listening")
    const targetPort = (target.address() as AddressInfo).port
    const forwarder = createTcpForwarder({
      listenHost: "127.0.0.1",
      listenPort: 0,
      targetHost: "127.0.0.1",
      targetPort,
    })
    await once(forwarder, "listening")
    const forwarderPort = (forwarder.address() as AddressInfo).port
    const client = createConnection({ host: "127.0.0.1", port: forwarderPort })
    let response = ""
    client.setEncoding("utf8")
    client.on("data", (chunk) => {
      response += chunk.toString()
    })
    await once(client, "close")

    expect(response).toBe("ready")
    await Promise.all([
      new Promise<void>((resolve, reject) =>
        forwarder.close((error) => (error ? reject(error) : resolve())),
      ),
      new Promise<void>((resolve, reject) =>
        target.close((error) => (error ? reject(error) : resolve())),
      ),
    ])
  })
})
