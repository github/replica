import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { CopyableTextInput } from "."
import styles from "./styles.css?inline"

const props = {
  value: "https://replica.example/share/12345678-1234-1234-1234-123456789abc",
  label: "Usability review",
  copyLabel: "Copy link",
  copiedLabel: "Copied",
  copyErrorLabel: "Copy failed",
}

describe("CopyableTextInput()", () => {
  it("fades long URLs into an opaque themed button without changing compact controls", () => {
    const { rerender } = render(<CopyableTextInput {...props} />)
    const rules = [...styles.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    const buttonRule = rules.find(([, selector]) =>
      selector?.includes(".copyable-text-input__button:is(button)"),
    )
    const fadeRule = rules.find(([, selector]) =>
      selector?.includes(".copyable-text-input__button::before"),
    )
    const inputRule = rules.find(
      ([, selector, declarations]) =>
        selector?.includes(".copyable-text-input__input") &&
        declarations?.includes("text-overflow: clip;"),
    )
    const button = screen.getByRole("button", { name: "Copy link" })
    const input = screen.getByRole("textbox")

    expect(button.matches(buttonRule![1]!.trim())).toBe(true)
    expect(button.matches(fadeRule![1]!.replace("::before", "").trim())).toBe(true)
    expect(input.matches(inputRule![1]!.trim())).toBe(true)
    expect(buttonRule?.[2]).toContain("background-color: var(--hub-canvas-default);")
    for (const state of ["hover", "active"]) {
      expect(buttonRule?.[2]).toMatch(
        new RegExp(
          `--brand-button-subtle-bgColor-${state}:\\s*color-mix\\(\\s*in srgb,\\s*var\\(--hub-fg-default\\) \\d+%,\\s*var\\(--hub-canvas-default\\)\\s*\\)`,
        ),
      )
    }
    expect(fadeRule?.[2]).toContain(
      "background: linear-gradient(to right, transparent, var(--hub-canvas-default));",
    )
    expect(fadeRule?.[2]).toContain("pointer-events: none;")
    expect(styles).toContain("text-overflow: clip;")

    rerender(<CopyableTextInput {...props} compact />)

    const compactButton = screen.getByRole("button", { name: "Copy link" })
    expect(compactButton).toBeInTheDocument()
    expect(compactButton.matches(buttonRule![1]!.trim())).toBe(false)
    expect(compactButton.matches(fadeRule![1]!.replace("::before", "").trim())).toBe(false)
    expect(screen.getByRole("textbox").matches(inputRule![1]!.trim())).toBe(false)
  })

  it("shows a labeled read-only URL and a copy button within the input control", () => {
    const { container } = render(<CopyableTextInput {...props} />)

    expect(screen.getByRole("textbox", { name: "Usability review" })).toHaveValue(props.value)
    expect(screen.getByRole("textbox")).toHaveAttribute("readonly")
    expect(screen.getByRole("button", { name: "Copy link" })).toHaveAttribute("type", "button")
    expect(container.querySelector(".copyable-text-input__control")).toContainElement(
      screen.getByRole("button"),
    )
    expect(container.querySelector(".copyable-text-input__control")).toContainElement(
      screen.getByRole("textbox"),
    )
  })

  it("keeps the compact copy button beside the read-only URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    const { container } = render(<CopyableTextInput {...props} compact />)

    const input = screen.getByRole("textbox", { name: "Usability review" })
    const button = screen.getByRole("button", { name: "Copy link" })
    expect(container.firstElementChild).toHaveClass("copyable-text-input--compact")
    expect(input).toHaveAttribute("readonly")
    expect(button.previousElementSibling).toBe(input)
    expect(button).toHaveAccessibleDescription("Copy link")

    fireEvent.click(button)

    expect(writeText).toHaveBeenCalledExactlyOnceWith(props.value)
    expect(await screen.findByRole("button", { name: "Copied" })).toHaveAccessibleDescription(
      "Copied",
    )
  })

  it("copies the URL and names the successful action", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    const { container } = render(<CopyableTextInput {...props} />)
    const announcement = container.querySelector('[aria-live="polite"]')
    expect(announcement).toHaveTextContent("")

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }))

    expect(writeText).toHaveBeenCalledExactlyOnceWith(props.value)
    expect(await screen.findByRole("button", { name: "Copied" })).toHaveAttribute("title", "Copied")
    expect(announcement).toHaveTextContent("Copied")
    expect(announcement).toHaveAttribute("aria-atomic", "true")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("announces clipboard failure and resets a previously copied label", async () => {
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Clipboard unavailable"))
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    render(<CopyableTextInput {...props} />)

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }))
    fireEvent.click(await screen.findByRole("button", { name: "Copied" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed")
    expect(screen.getByRole("button", { name: "Copy link" })).toHaveAttribute("title", "Copy link")
    expect(writeText).toHaveBeenCalledTimes(2)
  })

  it("does not mark a new URL as copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    const { rerender } = render(<CopyableTextInput {...props} />)

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument())
    rerender(<CopyableTextInput {...props} value="https://replica.example/share/another" />)

    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument()
    expect(screen.getByRole("textbox")).toHaveValue("https://replica.example/share/another")
  })
})
