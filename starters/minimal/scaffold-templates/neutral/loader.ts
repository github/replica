import seed from "@data/seeds/__SCAFFOLD_SLUG__.json"

export type SeedItem = {
  id: string
  title: string
  summary: string
}

export type RawSeed = {
  title: string
  description: string
  items: SeedItem[]
}

export type ViewModel = RawSeed & {
  itemCount: number
}

const rawSeed: RawSeed = seed

export function assemble(raw: RawSeed): ViewModel {
  return { ...raw, itemCount: raw.items.length }
}

export function load(): ViewModel {
  return assemble(rawSeed)
}
