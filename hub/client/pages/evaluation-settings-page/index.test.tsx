import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { EvaluationSettingsPage } from "."

describe("EvaluationSettingsPage()", () => {
  it("allows screenshots only once the repository is evaluated", () => {
    const onChange = vi.fn()
    render(
      <EvaluationSettingsPage
        busy={false}
        data={{
          repositoryName: "github/prototype",
          learningsPath: "/repositories/2001/learnings",
          budget: { limitCredits: "100", usedCredits: "0", editable: false },
          evaluations: {
            editable: true,
            enabled: false,
            screenshotsAllowed: false,
            screenshotsRecord: null,
          },
        }}
        onChange={onChange}
      />,
      { wrapper: HubThemeProvider },
    )

    fireEvent.click(screen.getByRole("switch", { name: "Evaluate github/prototype" }))

    expect(screen.getByRole("switch", { name: "Allow screenshots" })).toBeDisabled()
    expect(onChange).toHaveBeenCalledWith({ enabled: true })
  })
})
