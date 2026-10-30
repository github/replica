import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { CopilotAppContinuation } from "."
import type { CopilotAppContinuationCopy } from "./types"

describe("CopilotAppContinuation()", () => {
  it("waits for a click and keeps a safe new-tab link available", async () => {
    vi.useFakeTimers()
    try {
      const submission = {
        url: "https://github.com/copilot/app/launch?open=ghapp%3A%2F%2Fsession%2Fnew",
        prompt: "Build a prototype",
      }
      const copy: CopilotAppContinuationCopy = {
        continuationHeading: "Continue in Copilot app",
        continueMessage: "An agent will start working on your plan in the GitHub Copilot app.",
        installMessage: "The app must be installed on this device.",
        downloadLabel: "Download the app",
        downloadUrl: "https://github.com/github/app#install",
        openAppLabel: "Open Copilot App",
        closeLabel: "Close Copilot app dialog",
        copyPromptLabel: "Copy prompt",
        copiedLabel: "Copied prompt",
        copyErrorLabel: "Could not copy the prompt.",
      }
      const open = vi.spyOn(window, "open").mockReturnValue(null)
      const onOpenApp = vi.fn()
      render(<CopilotAppContinuation submission={submission} copy={copy} onOpenApp={onOpenApp} />)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(open).not.toHaveBeenCalled()
      expect(onOpenApp).not.toHaveBeenCalled()
      expect(screen.getByRole("status")).toBeEmptyDOMElement()
      const link = screen.getByRole("link", { name: copy.openAppLabel })
      expect(link).toHaveAttribute("href", submission.url)
      expect(link).toHaveAttribute("target", "_blank")
      expect(link).toHaveAttribute("rel", "noopener noreferrer")
      expect(link).toHaveTextContent(copy.openAppLabel)
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument()

      fireEvent.click(link)
      expect(onOpenApp).toHaveBeenCalledExactlyOnceWith(submission.url)
      expect(link).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
