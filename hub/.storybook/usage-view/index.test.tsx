import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { UsageView } from "./index"

describe("UsageView()", () => {
  it("opens related stories in the manager and source files outside the preview", () => {
    render(
      <UsageView
        entries={[
          {
            path: "app/javascript/components/example/index.tsx",
            usage: {
              consumers: [
                {
                  path: "app/javascript/features/example/index.tsx",
                  lines: [12],
                },
              ],
              surfaces: ["app/javascript/pages/example/index.tsx"],
            },
          },
        ]}
        storyLinks={{
          "app/javascript/features/example/index.tsx": [
            { id: "components-example--default", title: "Example component" },
          ],
          "app/javascript/pages/example/index.tsx": [
            { id: "hub-pages-example--default", title: "Example page" },
          ],
        }}
      />,
    )

    const storyLinks = [
      screen.getByRole("link", { name: "Example component" }),
      screen.getByRole("link", { name: "Example page" }),
    ]
    for (const link of storyLinks) {
      expect(link).toHaveAttribute("target", "_parent")
    }

    const sourceLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.startsWith("https://github.com/"))
    expect(sourceLinks).toHaveLength(3)
    for (const link of sourceLinks) {
      expect(link).toHaveAttribute("target", "_blank")
      expect(link).toHaveAttribute("rel", "noreferrer")
    }
  })
})
