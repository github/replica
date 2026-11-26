import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

import { loadLearningMcp } from "."

it("loads the learning tools that sit beside the configured command", async () => {
  const cliPath = fileURLToPath(
    new URL("../../../../../packages/learning/bin/replica-learning.mjs", import.meta.url),
  )

  const mcp = await loadLearningMcp(cliPath)

  expect(new mcp.LearningError("not_found", "Missing.")).toMatchObject({ code: "not_found" })
  const server = mcp.createLearningMcpServer({})
  await server.close()
})
