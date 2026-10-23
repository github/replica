import React, { useEffect, useState } from "react"
import { useChannel, useParameter, useStorybookState } from "storybook/manager-api"

import type { UsageIndex } from "../analyze-usage/types"
import { UsageView } from "../usage-view"
import type { UsageViewProps } from "../usage-view/types"

export function UsagePanel() {
  const initialIndex = useParameter<UsageIndex | undefined>("componentUsageIndex")
  const [updatedIndex, setUpdatedIndex] = useState<UsageIndex>()
  const emit = useChannel({ "storybook/component-usage": setUpdatedIndex })
  useEffect(() => {
    emit("storybook/component-usage/request")
  }, [emit])
  const usageIndex = updatedIndex ?? initialIndex
  const { storyId, index } = useStorybookState()
  if (!usageIndex || !index)
    return (
      <p style={{ padding: "1rem" }} role="status">
        Loading source usage...
      </p>
    )

  function normalize(path: string) {
    return path.replace(/^\.\//, "")
  }
  const current = storyId ? index[storyId] : undefined
  const importPath = current && "importPath" in current ? current.importPath : undefined
  const paths = importPath ? (usageIndex.stories[normalize(importPath)] ?? []) : []
  const storyLinks: UsageViewProps["storyLinks"] = {}

  for (const entry of Object.values(index)) {
    if (entry.type !== "story") continue
    const path = normalize(entry.importPath)
    // Link to one real indexed story per component, not an inferred ID.
    for (const target of usageIndex.stories[path] ?? []) {
      const links = (storyLinks[target] ??= [])
      if (!links.some((link) => link.title === entry.title)) {
        links.push({ id: entry.id, title: entry.title })
      }
    }
  }

  return (
    <UsageView
      entries={paths.flatMap((path) => {
        const usage = usageIndex.components[path]
        return usage ? [{ path, usage }] : []
      })}
      storyLinks={storyLinks}
    />
  )
}
