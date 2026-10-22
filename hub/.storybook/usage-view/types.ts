import type { SourceUsage } from "../analyze-usage/types"

export type UsageViewProps = {
  entries: { path: string; usage: SourceUsage }[]
  storyLinks: Record<string, { id: string; title: string }[]>
}
