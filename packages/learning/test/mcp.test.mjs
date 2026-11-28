import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createLearningMcpServer } from "../src/mcp.mjs"

async function connect(backend, options) {
  const server = createLearningMcpServer(backend, options)
  const client = new Client({ name: "test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return { client, server }
}

describe("createLearningMcpServer", () => {
  it("omits review support when the backend cannot show review forms", async () => {
    const { client, server } = await connect({})

    try {
      const { tools } = await client.listTools()
      assert.equal(
        tools.some(({ name }) => name === "review_learnings"),
        false,
      )
      assert.doesNotMatch(client.getInstructions(), /review_learnings|waitingForReview/)
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("asks for session submission at the configured cadence", async () => {
    const atEnd = await connect({})
    const eachRequest = await connect({}, { submitEachRequest: true })

    try {
      assert.match(atEnd.client.getInstructions(), /When the session ends, call submit_session/)
      assert.doesNotMatch(atEnd.client.getInstructions(), /After you finish each request/)
      assert.match(
        eachRequest.client.getInstructions(),
        /After you finish each request, call submit_session/,
      )
      assert.doesNotMatch(
        eachRequest.client.getInstructions(),
        /When the session ends, call submit_session/,
      )
    } finally {
      await Promise.all([
        atEnd.client.close(),
        atEnd.server.close(),
        eachRequest.client.close(),
        eachRequest.server.close(),
      ])
    }
  })

  it("masks unexpected backend errors and passes the original error to onError", async () => {
    const backendError = new Error("database credentials at /private/store.db")
    let reportedError
    const { client, server } = await connect(
      {
        getGuidance: async () => {
          throw backendError
        },
      },
      {
        onError: (error) => {
          reportedError = error
        },
      },
    )

    try {
      const result = await client.callTool({ name: "get_guidance", arguments: {} })
      assert.equal(result.isError, true)
      assert.equal(result.content[0].text, "The learning store could not complete this request.")
      assert.strictEqual(reportedError, backendError)
    } finally {
      await client.close()
      await server.close()
    }
  })
})
