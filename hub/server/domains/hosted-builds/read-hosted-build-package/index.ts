import { z } from "zod"
import { validateControlsDocument } from "#controls-validation"

import { validateBuildScreenshot } from "../../../integrations/png/validate-build-screenshot/index.ts"
import { readBuildZip } from "../../../integrations/zip/read-build-zip/index.ts"
import { normalizeStartPage } from "../../../utils/normalize-start-page/index.ts"

const mib = 1024 * 1024
const maxDistBytes = 100 * mib
const maxPackageBytes = 150 * mib
export const maxArtifactDownloadBytes = maxPackageBytes + 8 * mib
const maxFileBytes = 25 * mib
const maxManifestBytes = 16 * 1024
const maxControlsBytes = 256_000
const maxDistEntries = 2_000
const maxEntries = 2_090
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "narrow", width: 390, height: 844 },
]
const utf8 = new TextDecoder("utf-8", { fatal: true })

function templateText(max: number) {
  return z.string().refine((value) => {
    const characters = [...value]
    return (
      value.trim() &&
      !/\p{Cs}/u.test(value) &&
      characters.length <= max &&
      characters.every(
        (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      )
    )
  })
}

const manifestSchema = z.strictObject({
  version: z.literal(1),
  templates: z
    .array(
      z.strictObject({
        id: z
          .string()
          .max(64)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .refine((id) => id !== "default"),
        name: templateText(120),
        category: templateText(80),
        description: templateText(500),
        path: z.string().refine((route) => {
          if (!route.startsWith("/") || !normalizeStartPage(route)) return false
          const pathname = decodeURIComponent(route.split(/[?#]/, 1)[0] ?? "")
          if (/[\s%]/u.test(pathname)) return false
          const url = new URL(route, "https://preview.invalid")
          const serialized = `${url.pathname}${url.search}${url.hash}`
          return (
            url.origin === "https://preview.invalid" &&
            Buffer.byteLength(serialized) <= 2048 &&
            /^(?:[a-z0-9._~!$&'()*+,;=:@/-]|%[0-9a-f]{2})*$/i.test(url.pathname) &&
            /^(?:[a-z0-9._~!$&'()*+,;=:@/?-]|%[0-9a-f]{2})*$/i.test(url.hash.slice(1))
          )
        }),
      }),
    )
    .max(12),
})

export class InvalidHostedBuildPackage extends Error {
  constructor(reason: string) {
    super(`The Replica artifact ${reason}.`)
    this.name = "InvalidHostedBuildPackage"
  }
}

function safePath(path: string) {
  const segments = path.split("/")
  return (
    path.length <= 2048 &&
    segments.length <= 21 &&
    segments.every(
      (part) =>
        /^[\x20-\x7e]{1,255}$/.test(part) &&
        !/[\\<>:"|?*]|[ .]$/.test(part) &&
        part.toLowerCase() !== ".replica-internal" &&
        !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
}

/** Validates the V2 action layout and yields checked entries one at a time for immutable storage. */
export async function* readHostedBuildPackage(archive: Buffer) {
  const entries = readBuildZip(archive, maxEntries, maxFileBytes)
  const paths = new Map<string, { path: string; directory: boolean }>()
  const declared = new Set<string>()
  const distPaths = new Set<string>()
  const files = new Map<string, (typeof entries)[number]>()
  let total = 0
  let distBytes = 0

  for (const entry of entries) {
    const { path, directory, byteLength } = entry
    if (
      !safePath(path) ||
      !(
        path.startsWith("dist/") ||
        path.startsWith("screenshots/") ||
        (directory && ["dist", "screenshots"].includes(path)) ||
        (!directory && path === "templates.json")
      ) ||
      declared.has(path)
    )
      throw new InvalidHostedBuildPackage("contains an unsupported or duplicate path")
    declared.add(path)
    let prefix = ""
    const segments = path.split("/")
    for (const [index, segment] of segments.entries()) {
      prefix = prefix ? `${prefix}/${segment}` : segment
      const folded = prefix.toLowerCase()
      const isDirectory = directory || index < segments.length - 1
      const existing = paths.get(folded)
      if (existing && (existing.path !== prefix || existing.directory !== isDirectory))
        throw new InvalidHostedBuildPackage("contains paths that conflict")
      paths.set(folded, { path: prefix, directory: isDirectory })
      if (prefix.startsWith("dist/")) distPaths.add(prefix)
    }
    if (directory) {
      entry.read()
      continue
    }
    total += byteLength
    if (path.startsWith("dist/")) distBytes += byteLength
    const limit =
      path === "templates.json"
        ? maxManifestBytes
        : path === "dist/controls.replica.json"
          ? maxControlsBytes
          : maxFileBytes
    if (byteLength > limit || total > maxPackageBytes || distBytes > maxDistBytes)
      throw new InvalidHostedBuildPackage("exceeds a file or package size limit")
    files.set(path, entry)
  }
  if (distPaths.size > maxDistEntries || !files.has("dist/index.html"))
    throw new InvalidHostedBuildPackage("is missing dist/index.html or has too many dist entries")

  let templateIds: string[] = []
  const manifest = files.get("templates.json")
  if (manifest) {
    try {
      const parsed = manifestSchema.parse(JSON.parse(utf8.decode(manifest.read())))
      templateIds = parsed.templates.map(({ id }) => id)
      if (new Set(templateIds).size !== templateIds.length) throw new Error()
    } catch {
      throw new InvalidHostedBuildPackage("contains an invalid templates.json")
    }
  }
  const controls = files.get("dist/controls.replica.json")
  if (controls) {
    try {
      validateControlsDocument(JSON.parse(utf8.decode(controls.read())))
    } catch {
      throw new InvalidHostedBuildPackage("contains invalid Controls definitions")
    }
  }

  const screenshots = new Map<string, (typeof viewports)[number]>()
  for (const dir of ["screenshots", ...templateIds.map((id) => `screenshots/templates/${id}`)]) {
    for (const viewport of viewports) screenshots.set(`${dir}/${viewport.name}.png`, viewport)
  }
  if ([...screenshots.keys()].some((path) => files.has(path.replace(/\.png$/, "-dark.png")))) {
    for (const [path, viewport] of [...screenshots])
      screenshots.set(path.replace(/\.png$/, "-dark.png"), viewport)
  }
  const screenshotDirs = new Set([
    "screenshots",
    ...templateIds.flatMap((id) => ["screenshots/templates", `screenshots/templates/${id}`]),
  ])
  if (
    [...screenshots.keys()].some((path) => !files.has(path)) ||
    [...paths.values()].some(
      ({ path, directory }) =>
        path.startsWith("screenshots/") &&
        !(directory ? screenshotDirs.has(path) : screenshots.has(path)),
    )
  )
    throw new InvalidHostedBuildPackage("does not contain exactly the expected screenshots")

  for (const [path, entry] of files) {
    const bytes = entry.read()
    const screenshot = screenshots.get(path)
    if (screenshot && !(await validateBuildScreenshot(bytes, screenshot.width, screenshot.height)))
      throw new InvalidHostedBuildPackage("contains an invalid screenshot")
    const kind = screenshot ? "screenshot" : path === "templates.json" ? "manifest" : "dist"
    yield { path, kind, bytes } as const
  }
}
