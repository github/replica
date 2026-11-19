import { randomUUID } from "node:crypto"

import { createArtifactStorage } from "../../../server/domains/artifacts/create-artifact-storage/index.ts"
import type { PrismaClient } from "../../../server/generated/prisma/client.ts"

export async function seedLocalWorkspace(
  prisma: PrismaClient,
  repositoryPath: string,
  artifactDirectory: string,
) {
  const storage = await createArtifactStorage({
    provider: "filesystem",
    directory: artifactDirectory,
  })
  const storageKey = "welcome_smoke_html"
  const bytes = Buffer.from(
    '<!doctype html><html lang="en"><title>Welcome prototype</title><main><h1>Welcome prototype</h1><button type="button">Example action</button></main></html>',
  )
  const write = await storage.write(storageKey, bytes)
  if (write.status !== "ok") throw new Error(`Could not save the smoke Build: ${write.status}.`)

  const registeredAt = new Date("2026-01-01T00:00:00Z")
  const templateArtifacts = [
    { path: "dist/index.html", kind: "dist", value: "<h1>Default template</h1>" },
    { path: "dist/field-notes/index.html", kind: "dist", value: "<h1>Field notes template</h1>" },
    {
      path: "templates.json",
      kind: "manifest",
      value: JSON.stringify({
        version: 1,
        templates: [
          {
            id: "field-notes",
            name: "Field notes",
            category: "Collection",
            description: "A field guide for trails and notes.",
            path: "/field-notes/",
          },
        ],
      }),
    },
  ] as const
  const savedTemplates = await Promise.all(
    templateArtifacts.map(async ({ path, kind, value }, index) => {
      const storageKey = `smoke_template_${index}`
      const artifact = Buffer.from(value)
      const result = await storage.write(storageKey, artifact)
      if (result.status !== "ok")
        throw new Error(`Could not save template artifact: ${result.status}.`)
      return { kind, path, storageKey, byteLength: artifact.byteLength }
    }),
  )
  await prisma.repository.create({
    data: {
      nameWithOwner: "local/validation",
      defaultBranch: "main",
      localPath: repositoryPath,
      prototypes: {
        create: [
          {
            id: randomUUID(),
            branchName: "main",
            replica: true,
            builds: {
              create: [
                {
                  id: randomUUID(),
                  number: 1,
                  state: "successful",
                  startedAt: registeredAt,
                  finishedAt: registeredAt,
                  artifacts: { create: savedTemplates },
                },
                {
                  id: randomUUID(),
                  number: 2,
                  state: "failed",
                  startedAt: new Date("2026-01-02T00:00:00Z"),
                  finishedAt: new Date("2026-01-02T00:00:00Z"),
                },
              ],
            },
          },
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
