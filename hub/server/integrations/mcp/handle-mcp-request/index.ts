import type { Request, Response } from "express"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"

interface McpServer {
  connect(transport: StreamableHTTPServerTransport): Promise<void>
  close(): Promise<void>
}

/**
 * Answers one MCP request with a fresh server. Nothing is kept between requests, so a
 * revoked connection or lost access takes effect on the next call.
 */
export async function handleMcpRequest(server: McpServer, request: Request, response: Response) {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  response.on("close", () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(request, response, request.body)
}
