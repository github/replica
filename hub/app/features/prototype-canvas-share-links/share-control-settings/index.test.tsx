import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ShareControlSettings } from "."
import { shareCopy } from "@hooks/use-canvas-share-links/en"

describe("ShareControlSettings()", () => {
  it("shows the warning only when settings are included and the published version differs", () => {
    const onChange = vi.fn()
    const view = render(
      <ThemeProvider>
        <ShareControlSettings included={false} onChange={onChange} publishedVersionDiffers />
      </ThemeProvider>,
    )
    const checkbox = screen.getByRole("checkbox", { name: shareCopy.includeControlSettings })
    expect(checkbox).not.toBeChecked()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)

    view.rerender(
      <ThemeProvider>
        <ShareControlSettings included onChange={onChange} publishedVersionDiffers />
      </ThemeProvider>,
    )
    expect(checkbox).toBeChecked()
    expect(screen.getByRole("alert")).toHaveTextContent(shareCopy.controlSettingsWarning)
    expect(screen.getByRole("alert")).toHaveClass("hub-alert--warning")
    expect(checkbox).toHaveAccessibleDescription(shareCopy.controlSettingsDescription)
    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenLastCalledWith(false)

    view.rerender(
      <ThemeProvider>
        <ShareControlSettings included onChange={onChange} publishedVersionDiffers={false} />
      </ThemeProvider>,
    )
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("disables the checkbox while a share request is pending", () => {
    const onChange = vi.fn()
    render(
      <ThemeProvider>
        <ShareControlSettings
          included={false}
          onChange={onChange}
          publishedVersionDiffers
          disabled
        />
      </ThemeProvider>,
    )
    const checkbox = screen.getByRole("checkbox", { name: shareCopy.includeControlSettings })
    expect(checkbox).toBeDisabled()
    expect(onChange).not.toHaveBeenCalled()
  })
})
