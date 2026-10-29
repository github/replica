#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto"
import { readFile, stat } from "node:fs/promises"

function usage() {
  console.error(
    "Usage: REPLICA_PUBLISH_TOKEN=... node script/publish-artifact.mjs HUB_URL PROTOTYPE_ID ARTIFACT_PATH [current|preview]",
  )
}

const [, , hubUrl, prototypeId, artifactPath, promoteChannel] = process.argv
const token = process.env.REPLICA_PUBLISH_TOKEN
if (
  !hubUrl ||
  !prototypeId ||
  !artifactPath ||
  !token ||
  (promoteChannel && !["current", "preview"].includes(promoteChannel))
) {
  usage()
  process.exitCode = 2
} else {
  const bytes = await readFile(artifactPath)
  const details = await stat(artifactPath)
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  const idempotencyKey = process.env.REPLICA_IDEMPOTENCY_KEY ?? randomUUID()
  console.error(`Replica idempotency key: ${idempotencyKey}`)
  const response = await fetch(
    new URL(`/api/publishing/prototypes/${prototypeId}/versions`, hubUrl),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        manifest: {
          schemaVersion: 1,
          prototypeId,
          artifact: {
            format: process.env.REPLICA_ARTIFACT_FORMAT ?? "replica.prototype.bundle",
            version: process.env.REPLICA_ARTIFACT_VERSION ?? "1",
            digest,
            sizeBytes: bytes.length,
            builtAt: details.mtime.toISOString(),
          },
          provenance: {
            provider: process.env.REPLICA_PROVENANCE_PROVIDER ?? "local-cli",
            ...(process.env.REPLICA_SOURCE_URL
              ? { sourceUrl: process.env.REPLICA_SOURCE_URL }
              : {}),
            ...(process.env.REPLICA_REVISION ? { revision: process.env.REPLICA_REVISION } : {}),
            ...(process.env.REPLICA_REF ? { ref: process.env.REPLICA_REF } : {}),
            ...(process.env.REPLICA_PIPELINE ? { pipeline: process.env.REPLICA_PIPELINE } : {}),
            ...(process.env.REPLICA_RUN_ID ? { runId: process.env.REPLICA_RUN_ID } : {}),
          },
        },
        artifactBase64: bytes.toString("base64"),
        ...(promoteChannel ? { promoteChannel } : {}),
      }),
    },
  )
  const result = await response.text()
  if (!response.ok) {
    console.error(`Publish failed (${response.status}): ${result}`)
    process.exitCode = 1
  } else {
    process.stdout.write(`${result}\n`)
  }
}
