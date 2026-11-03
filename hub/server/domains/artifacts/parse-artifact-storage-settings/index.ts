import { isAbsolute } from "node:path"
import { z } from "zod"

import type { ArtifactStorageSettings } from "../create-artifact-storage/types.ts"

const settingsSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("filesystem"),
      directory: z
        .string()
        .min(1)
        .refine((value) => isAbsolute(value) && !value.includes("\0")),
    })
    .strict(),
  z
    .object({
      provider: z.literal("azure-blob"),
      accountUrl: z.string().regex(/^https:\/\/[a-z0-9]{3,24}\.blob\.core\.windows\.net\/?$/),
      container: z.string().regex(/^(?!.*--)[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
      managedIdentityClientId: z.uuid().optional(),
    })
    .strict(),
])

export function parseArtifactStorageSettings(input: unknown): ArtifactStorageSettings {
  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) throw new Error("Artifact storage configuration is invalid.")
  if (
    parsed.data.provider === "filesystem" &&
    parsed.data.directory.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("Artifact storage configuration is invalid.")
  }
  return parsed.data
}
