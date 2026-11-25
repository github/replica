import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { ScreenshotConsentPrototype } from "."
import type { ScreenshotConsentPrototypeData } from "./types"

function renderPrototype(data: ScreenshotConsentPrototypeData) {
  return render(<ScreenshotConsentPrototype data={data} />, { wrapper: HubThemeProvider })
}

describe("ScreenshotConsentPrototype()", () => {
  it("records the permission and who granted it", () => {
    renderPrototype({
      repositoryName: "github/prototype",
      personName: "@mona",
      consentRecordedAt: "November 24, 2026",
      evaluatorName: "Prototype quality reviewer",
      consentEvaluatorName: null,
      evaluationAvailable: true,
      consent: null,
    })

    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Allow screenshot capture and automated review" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Save permission" }))

    expect(
      screen.getByRole("checkbox", { name: "Allow screenshot capture and automated review" }),
    ).toBeChecked()
    expect(screen.getByText("Recorded by @mona · Just now")).toBeVisible()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("records a decline without granting permission", () => {
    renderPrototype({
      repositoryName: "github/prototype",
      personName: "@mona",
      consentRecordedAt: "November 24, 2026",
      evaluatorName: "Prototype quality reviewer",
      consentEvaluatorName: null,
      evaluationAvailable: true,
      consent: null,
    })

    fireEvent.click(screen.getByRole("button", { name: "Decline screenshot permission" }))

    expect(
      screen.getByRole("checkbox", { name: "Allow screenshot capture and automated review" }),
    ).not.toBeChecked()
    expect(screen.getByText("Recorded by @mona · Just now")).toBeVisible()
    expect(screen.queryByText(/Deletion has been requested/)).not.toBeInTheDocument()
  })

  it("does not allow review when the repository admin has not enabled evaluation", () => {
    renderPrototype({
      repositoryName: "github/prototype",
      personName: "@mona",
      consentRecordedAt: "November 24, 2026",
      evaluatorName: "Prototype quality reviewer",
      consentEvaluatorName: null,
      evaluationAvailable: false,
      consent: null,
    })

    expect(
      screen.getByRole("checkbox", {
        name: "Allow screenshot capture and automated review",
      }),
    ).toBeDisabled()
    expect(
      screen.getByText("Your repository admin has not enabled automated evaluation."),
    ).toBeVisible()
  })

  it("allows withdrawing an existing permission while evaluation is unavailable", () => {
    renderPrototype({
      repositoryName: "github/prototype",
      personName: "@mona",
      consentRecordedAt: "November 24, 2026",
      evaluatorName: "Prototype quality reviewer",
      consentEvaluatorName: "Prototype quality reviewer",
      evaluationAvailable: false,
      consent: true,
    })

    const permission = screen.getByRole("checkbox", {
      name: "Allow screenshot capture and automated review",
    })
    expect(permission).toBeChecked()
    expect(permission).toBeEnabled()
    expect(
      screen.getByText("Your repository admin has not enabled automated evaluation."),
    ).toBeVisible()

    fireEvent.click(permission)
    expect(permission).toHaveAccessibleDescription(
      /not enabled automated evaluation.*stops further use and requests deletion/,
    )
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(permission).toBeChecked()

    fireEvent.click(permission)
    fireEvent.click(screen.getByRole("button", { name: "Withdraw and request deletion" }))
    expect(screen.getByRole("status")).toHaveTextContent(/Deletion has been requested/)
    expect(permission).not.toBeChecked()
    expect(permission).toBeDisabled()
  })

  it("explains deletion when a saved permission is turned off", () => {
    renderPrototype({
      repositoryName: "github/prototype",
      personName: "@mona",
      consentRecordedAt: "November 24, 2026",
      evaluatorName: "Prototype quality reviewer",
      consentEvaluatorName: "Prototype quality reviewer",
      evaluationAvailable: true,
      consent: true,
    })

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Allow screenshot capture and automated review" }),
    )
    expect(screen.getByText(/This stops further use and requests deletion/)).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Withdraw and request deletion" }))

    expect(screen.getByRole("status")).toHaveTextContent("Screenshot permission withdrawn")
    expect(screen.getByRole("status")).toHaveTextContent(
      "Further use is stopped. Deletion has been requested",
    )
    expect(screen.getByText("Withdrawn by @mona · Just now")).toBeVisible()
  })

  it("asks again when the review destination changes", () => {
    renderPrototype({
      repositoryName: "github/prototype",
      personName: "@mona",
      consentRecordedAt: "November 24, 2026",
      evaluatorName: "New quality reviewer",
      consentEvaluatorName: "Previous quality reviewer",
      evaluationAvailable: true,
      consent: true,
    })

    const permission = screen.getByRole("checkbox", {
      name: "Allow screenshot capture and automated review",
    })
    expect(permission).not.toBeChecked()
    expect(screen.getByText(/previous permission does not cover the system/)).toBeVisible()

    fireEvent.click(permission)
    fireEvent.click(screen.getByRole("button", { name: "Save permission" }))

    expect(permission).toBeChecked()
    expect(screen.getByText("Recorded by @mona · Just now")).toBeVisible()
  })
})
