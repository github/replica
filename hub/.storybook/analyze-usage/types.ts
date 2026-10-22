export type SourceUsage = {
  consumers: { path: string; lines: number[] }[]
  surfaces: string[]
}

export type UsageIndex = {
  components: Record<string, SourceUsage>
  stories: Record<string, string[]>
}
