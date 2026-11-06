import type seed from "../seed.json"

export type FixtureBuild = Omit<(typeof seed.builds)[number], "startedAt"> & {
  startedAt: string | null
}
