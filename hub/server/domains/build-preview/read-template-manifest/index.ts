import { z } from "zod"

import { normalizeStartPage } from "../../../utils/normalize-start-page/index.ts"
import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types.ts"

export const templateIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const maximumManifestBytes = 16 * 1024
function text(length: number) {
  return z.string().refine((value) => {
    const characters = [...value]
    return (
      Boolean(value.trim()) &&
      characters.length <= length &&
      !/\p{Cs}/u.test(value) &&
      characters.every(
        (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      )
    )
  })
}

export function templateReturnPath(value: string) {
  if (!value.startsWith("/") || !normalizeStartPage(value)) return null
  const url = new URL(value, "http://preview.invalid")
  return normalizeStartPage(`${url.pathname}${url.search}${url.hash}`)
}

const manifestSchema = z.strictObject({
  version: z.literal(1),
  templates: z
    .array(
      z.strictObject({
        id: templateIdSchema.refine((value) => value !== "default"),
        name: text(120),
        category: text(80),
        description: text(500),
        path: z.string().transform((path, context) => {
          const route = templateReturnPath(path)
          const pathname = route ? decodeURIComponent(route.split(/[?#]/, 1)[0]!) : null
          if (!route || pathname === null || /[\s%]/u.test(pathname)) {
            context.addIssue({ code: "custom", message: "Invalid template route." })
            return z.NEVER
          }
          return route
        }),
      }),
    )
    .max(12)
    .refine((entries) => new Set(entries.map(({ id }) => id)).size === entries.length),
})

export class TemplateManifestUnavailable extends Error {
  constructor() {
    super("Hub could not read the saved template manifest.")
  }
}

export async function readTemplateManifest(
  artifact: { storageKey: string; byteLength: number } | undefined,
  storage: Pick<ArtifactStorage, "read"> | undefined,
) {
  if (!artifact) return []
  if (!storage || artifact.byteLength > maximumManifestBytes)
    throw new TemplateManifestUnavailable()
  const stored = await storage.read(artifact.storageKey)
  if (
    stored.status !== "ok" ||
    stored.bytes.byteLength !== artifact.byteLength ||
    stored.bytes.byteLength > maximumManifestBytes
  )
    throw new TemplateManifestUnavailable()
  try {
    return manifestSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes)),
    ).templates
  } catch {
    throw new TemplateManifestUnavailable()
  }
}
