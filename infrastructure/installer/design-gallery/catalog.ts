import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { scenes, sourceBindings } from "./scenes.ts"
import type { Scene } from "./types.ts"

export function orderedScenes(catalog: readonly Scene[] = scenes) {
  const ids = new Set<string>()
  const chapters = new Set<string>()
  let chapter = ""
  if (!catalog.length) throw new Error("The design catalog is empty.")
  return catalog.map((scene, index) => {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(scene.id) || ids.has(scene.id)) {
      throw new Error(`Invalid or duplicate semantic scene ID: ${scene.id}`)
    }
    ids.add(scene.id)
    if (scene.group !== chapter) {
      if (chapters.has(scene.group)) throw new Error(`Split catalog chapter: ${scene.group}`)
      chapter = scene.group
      chapters.add(chapter)
    }
    for (const key of ["group", "title", "source", "purpose", "decision", "consequence"] as const) {
      if (!scene[key].trim()) throw new Error(`Scene ${scene.id} needs ${key}.`)
    }
    if (!Number.isInteger(scene.columns) || !Number.isInteger(scene.rows) ||
        scene.columns < 20 || scene.columns > 200 || scene.rows < 5 || scene.rows > 100) {
      throw new Error(`Invalid terminal dimensions for ${scene.id}.`)
    }
    if (scene.kind === "field" && !scene.field) throw new Error(`Missing field for ${scene.id}.`)
    if (scene.kind === "select" && !scene.options?.length) {
      throw new Error(`Missing options for ${scene.id}.`)
    }
    return { ...scene, ordinal: index + 1, label: `${String(index + 1).padStart(3, "0")} · ${scene.title}` }
  })
}

export async function verifySources(repository: string) {
  for (const [path, expected] of Object.entries(sourceBindings)) {
    const actual = createHash("sha256").update(await readFile(resolve(repository, path))).digest("hex")
    if (actual !== expected) {
      throw new Error(
        `Design fixture source changed: ${path}. Review its scenes and annotations, then update its SHA-256 in scenes.ts. Do not refresh bindings without reviewing the copy.`,
      )
    }
  }
}
