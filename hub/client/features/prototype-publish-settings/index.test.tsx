import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { PublishSettings } from "."

describe("PublishSettings()", () => {
  it.each(["saving", "publishing"] as const)(
    "keeps focus on the switch while %s and blocks changes",
    (busy) => {
      const save = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
      const preference = {
        remember: false,
        loading: false,
        saving: false,
        error: "",
        save,
        retry: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      }
      const view = render(
        <ThemeProvider>
          <PublishSettings preference={preference} />
        </ThemeProvider>,
      )
      const toggle = screen.getByRole("switch", { name: "Always commit changes before publishing" })
      toggle.focus()
      view.rerender(
        <ThemeProvider>
          <PublishSettings
            preference={{ ...preference, saving: busy === "saving" }}
            disabled={busy === "publishing"}
          />
        </ThemeProvider>,
      )
      expect(toggle).toHaveFocus()
      expect(toggle).toHaveAttribute("aria-disabled", "true")
      expect(toggle).not.toBeDisabled()
      fireEvent.click(toggle)
      expect(save).not.toHaveBeenCalled()
    },
  )
})
