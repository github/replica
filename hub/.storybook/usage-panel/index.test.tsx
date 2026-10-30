import React from "react"
import { act, render, screen } from "@testing-library/react"
import { useChannel, useParameter, useStorybookState } from "storybook/manager-api"
import { describe, expect, it, vi } from "vitest"

import type { UsageIndex } from "../analyze-usage/types"
import type { UsageViewProps } from "../usage-view/types"
import { UsagePanel } from "."

vi.mock("storybook/manager-api", () => ({
  useChannel: vi.fn(),
  useParameter: vi.fn(),
  useStorybookState: vi.fn(),
}))
vi.mock("../usage-view", () => ({
  UsageView: ({ entries }: UsageViewProps) => <output>{JSON.stringify(entries)}</output>,
}))

describe("UsagePanel()", () => {
  it("requests the current report on mount and renders subsequent usage updates", () => {
    const path = "app/components/widget/index.tsx"
    const latest: UsageIndex = {
      components: {
        [path]: {
          consumers: [{ path: "app/pages/example.tsx", lines: [3] }],
          surfaces: [],
        },
      },
      stories: { "app/components/widget/stories.tsx": [path] },
    }
    vi.mocked(useParameter).mockReturnValue({ components: {}, stories: {} })
    vi.mocked(useStorybookState).mockReturnValue({
      storyId: "widget--default",
      index: {
        "widget--default": {
          type: "story",
          id: "widget--default",
          title: "Widget",
          importPath: "./app/components/widget/stories.tsx",
        },
      },
    } as unknown as ReturnType<typeof useStorybookState>)
    let receive: ((index: UsageIndex) => void) | undefined
    const emit = vi.fn(() => receive?.(latest))
    vi.mocked(useChannel).mockImplementation((handlers) => {
      receive = handlers["storybook/component-usage"]
      return emit
    })

    render(<UsagePanel />)
    expect(emit).toHaveBeenCalledWith("storybook/component-usage/request")
    expect(screen.getByRole("status").textContent).toContain("app/pages/example.tsx")

    act(() => receive?.({ ...latest, components: { [path]: { consumers: [], surfaces: [] } } }))
    expect(screen.getByRole("status").textContent).not.toContain("app/pages/example.tsx")
    expect(screen.getByRole("status").textContent).toContain(path)
  })
})
