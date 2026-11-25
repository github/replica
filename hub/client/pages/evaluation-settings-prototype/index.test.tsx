import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { EvaluationSettingsPrototype } from "."
import type { EvaluationSettingsPrototypeData } from "./types"

function renderPrototype(data: EvaluationSettingsPrototypeData) {
  render(<EvaluationSettingsPrototype data={data} />, { wrapper: HubThemeProvider })
}

describe("EvaluationSettingsPrototype()", () => {
  it("lets a Hub admin set the shared cap without going below spend already used", () => {
    const data: EvaluationSettingsPrototypeData = {
      repositoryName: "github/prototype",
      learningsPath: "/repositories/2001/learnings",
      canManageHubBudget: true,
      canManageRepositorySettings: true,
      budgetLimitCredits: 100,
      usedCredits: 42,
      repositoryEnabled: false,
    }
    renderPrototype(data)

    const budget = screen.getByRole("spinbutton", { name: "Shared Hub budget" })
    expect(budget).toHaveAttribute("min", "42")
    expect(budget).toHaveAccessibleDescription("42 of 100 credits used")
    fireEvent.change(budget, { target: { value: "30" } })

    expect(budget).toBeInvalid()
    fireEvent.blur(budget)
    expect(screen.getByRole("alert")).toHaveTextContent("at least 42 credits")
    expect(screen.queryByText("Hub evaluation budget saved.")).not.toBeInTheDocument()

    fireEvent.change(budget, { target: { value: "120" } })
    fireEvent.blur(budget)

    expect(screen.getByRole("region", { name: "Notifications" })).toHaveTextContent(
      "Hub evaluation budget saved.",
    )
  })

  it("lets a repository administrator opt in without granting Hub budget access", () => {
    const data: EvaluationSettingsPrototypeData = {
      repositoryName: "github/prototype",
      learningsPath: "/repositories/2001/learnings",
      canManageHubBudget: false,
      canManageRepositorySettings: true,
      budgetLimitCredits: 100,
      usedCredits: 42,
      repositoryEnabled: false,
    }
    renderPrototype(data)

    const optIn = screen.getByRole("switch", {
      name: "Evaluate github/prototype",
    })
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument()
    expect(optIn).toHaveAccessibleDescription(
      "Turning this off stops future evaluations and keeps existing results.",
    )

    fireEvent.click(optIn)

    expect(optIn).toBeChecked()
    expect(screen.getByRole("region", { name: "Notifications" })).toHaveTextContent(
      "Automated evaluations enabled for github/prototype.",
    )
  })

  it("keeps an opted-in repository paused when the Hub budget is used", () => {
    const data: EvaluationSettingsPrototypeData = {
      repositoryName: "github/prototype",
      learningsPath: "/repositories/2001/learnings",
      canManageHubBudget: false,
      canManageRepositorySettings: true,
      budgetLimitCredits: 100,
      usedCredits: 100,
      repositoryEnabled: true,
    }
    renderPrototype(data)

    const optIn = screen.getByRole("switch", {
      name: "Evaluate github/prototype",
    })
    expect(optIn).toBeChecked()
    expect(screen.getByRole("alert")).toHaveTextContent(/Evaluations are paused/)

    fireEvent.click(optIn)

    expect(optIn).not.toBeChecked()
    expect(optIn).toBeDisabled()
  })

  it("prevents repository opt-in until a Hub administrator sets a budget", () => {
    const data: EvaluationSettingsPrototypeData = {
      repositoryName: "github/prototype",
      learningsPath: "/repositories/2001/learnings",
      canManageHubBudget: false,
      canManageRepositorySettings: true,
      budgetLimitCredits: 0,
      usedCredits: 0,
      repositoryEnabled: false,
    }
    renderPrototype(data)

    expect(screen.getByRole("status")).toHaveTextContent(
      "A Hub admin must set a budget before evaluations can be enabled.",
    )
    expect(screen.getByRole("switch", { name: "Evaluate github/prototype" })).toBeDisabled()
  })

  it("links back to the repository's Learning Library", () => {
    const data: EvaluationSettingsPrototypeData = {
      repositoryName: "github/empty",
      learningsPath: "/repositories/2002/learnings",
      canManageHubBudget: false,
      canManageRepositorySettings: true,
      budgetLimitCredits: 100,
      usedCredits: 42,
      repositoryEnabled: false,
    }
    renderPrototype(data)

    expect(screen.getByRole("link", { name: "Back to learnings" })).toHaveAttribute(
      "href",
      "/repositories/2002/learnings",
    )
  })
})
