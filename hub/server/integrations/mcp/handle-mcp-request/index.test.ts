import { once } from "node:events"
import type { AddressInfo } from "node:net"
import express from "express"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { expect, it, onTestFinished } from "vitest"

import { handleMcpRequest } from "."

it("answers an MCP call whose body Express already parsed", async () => {
  const app = express()
  app.use(express.json())
  app.post("/mcp", async (request, response) => {
    const server = new McpServer({ name: "test", version: "1.0.0" })
    server.registerTool("ping", { description: "Replies." }, () => ({
      content: [{ type: "text", text: "pong" }],
    }))
    await handleMcpRequest(server, request, response)
  })
  const listener = app.listen(0, "127.0.0.1")
  onTestFinished(() => void listener.close())
  await once(listener, "listening")

  const response = await fetch(`http://127.0.0.1:${(listener.address() as AddressInfo).port}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "ping", arguments: {} },
    }),
  })

  expect(await response.json()).toMatchObject({
    id: 1,
    result: { content: [{ type: "text", text: "pong" }] },
  })
})
