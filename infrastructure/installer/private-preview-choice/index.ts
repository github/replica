import { readerHostname, repositoryId } from "../config/index.ts"
import type { PrivatePreviewChoice, WizardUI } from "../types.ts"

const readerOptions = [
  {
    label: "Off: no reader ingress or Hub playback (default). An existing reader stays disabled.",
    value: "off",
  },
  { label: "On: run the shared reader and let Hub open private Builds", value: "on" },
  {
    label: "Remove: delete the reader app and its grants. Published Builds are kept.",
    value: "removed",
  },
] as const

async function ask<T>(
  ui: WizardUI,
  message: string,
  initial: string,
  parse: (value: string) => T | undefined,
  problem: string,
): Promise<T> {
  let value = initial
  while (true) {
    value = (await ui.text(message, value)).trim()
    const parsed = parse(value)
    if (parsed !== undefined) return parsed
    ui.notice?.("error", problem)
  }
}

export async function askPrivatePreview(
  ui: WizardUI,
  saved: PrivatePreviewChoice | undefined,
): Promise<PrivatePreviewChoice> {
  const current = saved?.reader ?? "off"
  const reader = (await ui.select(
    "Private prototype service. Off is the default; turning it on exposes a reader that serves private Builds to signed-in users.",
    [...readerOptions].sort((left, right) => Number(right.value === current) - Number(left.value === current)),
  )) as PrivatePreviewChoice["reader"]
  if (!readerOptions.some(({ value }) => value === reader))
    throw new Error("Choose a supported private preview setting.")
  if (reader === "removed") return { reader, inline: false, writerRepositoryIds: [] }
  let inline = false
  let hostname: string | undefined
  if (reader === "on") {
    inline =
      (await ui.select("Play private Builds inline on the Build page?", [
        ...(saved?.inline
          ? [{ label: "Inline and new tab", value: "on" }, { label: "New tab only", value: "off" }]
          : [{ label: "New tab only", value: "off" }, { label: "Inline and new tab", value: "on" }]),
      ])) === "on"
    hostname = await ask(
      ui,
      "Reader hostname under Hub's hostname, such as preview.replica.example.com. Leave blank to use the generated Container Apps hostname when Hub also uses one.",
      saved?.hostname ?? "",
      (value) => (!value ? null : value.length <= 253 && readerHostname.test(value) ? value : undefined),
      "Enter one lowercase hostname without a scheme, path, port, or wildcard.",
    ) ?? undefined
  }
  const writerRepositoryIds = await ask(
    ui,
    "Publish new proto/* Builds for these numeric GitHub repository IDs, separated by commas. Leave blank to keep publishing off.",
    saved?.writerRepositoryIds.join(",") ?? "",
    (value) => {
      const ids = value ? value.split(",").map((id) => id.trim()) : []
      return ids.every((id) => repositoryId.test(id)) && new Set(ids).size === ids.length ? ids : undefined
    },
    "Enter distinct numeric repository IDs separated by commas, or leave blank.",
  )
  return { reader, inline, ...(hostname ? { hostname } : {}), writerRepositoryIds }
}
