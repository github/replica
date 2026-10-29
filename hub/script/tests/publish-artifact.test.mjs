import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { it } from "node:test"

const script = fileURLToPath(new URL("../publish-artifact.mjs", import.meta.url))
const artifact = fileURLToPath(new URL("../../package.json", import.meta.url))
const prototypeId = "50d2e31f-8aa1-4b67-8fb4-67f045b89a0d"

function runPublisher(hubUrl, idempotencyKey) {
  const child = spawn(process.execPath, [script, hubUrl, prototypeId, artifact], {
    env: {
      ...process.env,
      REPLICA_PUBLISH_TOKEN: "test-token",
      ...(idempotencyKey ? { REPLICA_IDEMPOTENCY_KEY: idempotencyKey } : {}),
    },
  })
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk
  })
  return once(child, "close").then(([code, signal]) => ({ code, signal, stdout, stderr }))
}

it("prints the idempotency key before a failed publish so it can be reused", async (t) => {
  const receivedKeys = []
  let requestCount = 0
  const server = createServer((request, response) => {
    receivedKeys.push(request.headers["idempotency-key"])
    request.resume()
    request.on("end", () => {
      requestCount += 1
      if (requestCount === 1) {
        response.writeHead(503, { "content-type": "application/json" })
        response.end('{"error":"response lost"}')
      } else {
        response.writeHead(201, { "content-type": "application/json" })
        response.end('{"replayed":true}')
      }
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => server.close())
  const address = server.address()
  assert.ok(address && typeof address === "object")
  const hubUrl = `http://127.0.0.1:${address.port}`

  const failed = await runPublisher(hubUrl)
  const generatedKey = failed.stderr.match(
    /Replica idempotency key: ([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i,
  )?.[1]
  assert.equal(failed.code, 1)
  assert.equal(failed.signal, null)
  assert.ok(generatedKey)
  assert.match(failed.stderr, /Publish failed \(503\)/)

  const retried = await runPublisher(hubUrl, generatedKey)
  assert.equal(retried.code, 0)
  assert.equal(retried.signal, null)
  assert.equal(retried.stderr, `Replica idempotency key: ${generatedKey}\n`)
  assert.equal(retried.stdout, '{"replayed":true}\n')
  assert.deepEqual(receivedKeys, [generatedKey, generatedKey])
})
