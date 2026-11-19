import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { createArtifactStorage } from "../../../server/domains/artifacts/create-artifact-storage"
import { prisma } from "../../../server/integrations/prisma"

export async function seedLocalWorkspace(root: string, artifactDirectory: string) {
  const storage = await createArtifactStorage({
    provider: "filesystem",
    directory: artifactDirectory,
  })
  const storageKey = "welcome_smoke_html"
  const bytes = Buffer.from(
    '<!doctype html><html lang="en"><title>Welcome prototype</title><main><h1>Welcome prototype</h1></main></html>',
  )
  const write = await storage.write(storageKey, bytes)
  if (write.status !== "ok") throw new Error(`Could not save the smoke Build: ${write.status}.`)

  const registeredAt = new Date("2026-01-01T00:00:00Z")
  await prisma.repository.create({
    data: {
      nameWithOwner: "local/validation",
      defaultBranch: "main",
      localPath: join(root, "validation"),
      prototypes: {
        create: [
          {
            id: randomUUID(),
            branchName: "prototype/welcome",
            name: "Welcome",
            registeredAt,
            builds: {
              create: {
                id: randomUUID(),
                number: 1,
                state: "successful",
                startedAt: registeredAt,
                finishedAt: registeredAt,
                artifacts: {
                  create: {
                    kind: "dist",
                    path: "dist/index.html",
                    storageKey,
                    byteLength: bytes.byteLength,
                  },
                },
              },
            },
          },
          { id: randomUUID(), branchName: "prototype/no-build", name: "No Build", registeredAt },
          { id: randomUUID(), branchName: "prototype/listing-draft" },
        ],
      },
    },
  })
}
