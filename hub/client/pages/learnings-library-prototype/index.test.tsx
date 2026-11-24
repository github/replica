import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { LearningsLibraryPrototype } from "."
import type { LearningsLibraryPrototypeData } from "./types"

function createPrototypeData(canDecide: boolean): LearningsLibraryPrototypeData {
  const supportingEvidence = {
    id: "evidence-supporting",
    body: "The visible label made the form easier to scan.",
    authorLogin: "octocat",
    prototypeName: "Checkout refresh",
    buildNumber: 8,
    createdAt: "2026-11-18T16:30:00.000Z",
    reviewPath: "https://github.com/github/prototype/pull/42#discussion_r100",
  }
  const secondSupportingEvidence = {
    id: "evidence-second-supporting",
    body: "The Save button does not stand out beside Cancel.",
    authorLogin: "mona",
    prototypeName: "Settings refresh",
    buildNumber: 5,
    createdAt: "2026-11-17T14:00:00.000Z",
    reviewPath: "https://github.com/github/prototype/pull/43#discussion_r101",
  }
  const placeholderEvidence = {
    id: "evidence-placeholder",
    body: "The placeholder disappears while I type, so I lose the field name.",
    authorLogin: "octocat",
    prototypeName: "Signup refresh",
    buildNumber: 4,
    createdAt: "2026-11-16T10:42:00.000Z",
    reviewPath: "https://github.com/github/prototype/pull/44#discussion_r102",
  }

  return {
    canDecide,
    learnings: [
      {
        id: "learning-suggested",
        title: "Keep form labels visible",
        guidance: "Give every field a visible label.",
        status: "suggested",
        topic: "Accessibility",
        updatedAt: "2026-11-18T16:30:00.000Z",
        evidence: [supportingEvidence],
      },
      {
        id: "learning-suggested-rejection",
        title: "Rely on placeholder text",
        guidance: "Use placeholder text to identify each field.",
        status: "suggested",
        topic: "Accessibility",
        updatedAt: "2026-11-17T14:00:00.000Z",
        evidence: [placeholderEvidence],
      },
      {
        id: "learning-active",
        title: "Make actions clear",
        guidance: "Use clear labels for primary actions.",
        status: "active",
        topic: "Content",
        updatedAt: "2026-11-18T16:30:00.000Z",
        acceptedBy: "mona",
        evidence: [supportingEvidence, secondSupportingEvidence],
      },
      {
        id: "learning-rejected",
        title: "Use placeholder text as a label",
        guidance: "Rely on placeholder text to identify each field.",
        status: "rejected",
        topic: "Accessibility",
        updatedAt: "2026-11-16T09:00:00.000Z",
        rejectionReason: "Placeholder text is not a persistent label.",
        evidence: [placeholderEvidence],
      },
    ],
    activity: [
      {
        date: "2026-11-19",
        runState: "succeeded",
        startedAt: "2026-11-19T15:00:00.000Z",
        startedBy: "octocat",
        commentsAnalyzed: 12,
        commentsTagged: 4,
        suggestions: 2,
      },
      {
        date: "2026-11-18",
        runState: "succeeded",
        startedAt: "2026-11-18T15:00:00.000Z",
        startedBy: "octocat",
        commentsAnalyzed: 6,
        commentsTagged: 8,
        suggestions: 1,
      },
    ],
    today: "2026-11-20",
    agentConnectionPath: "/settings/agents?repositoryId=2001",
  }
}

function renderPrototype(data: LearningsLibraryPrototypeData) {
  return render(<LearningsLibraryPrototype data={data} />, { wrapper: HubThemeProvider })
}

function getSectionControl(name: string) {
  const matcher = new RegExp(`^${name}\\b`, "i")
  return (
    screen.queryByRole("tab", { name: matcher }) ??
    screen.queryByRole("button", { name: matcher }) ??
    screen.getByRole("link", { name: matcher })
  )
}

function selectSection(name: string) {
  fireEvent.click(getSectionControl(name))
}

function getLearning(title: string) {
  const row = screen.getByRole("button", { name: title }).closest("tr")
  if (!row) throw new Error(`Expected "${title}" to be in a learning row`)
  return row
}

describe("LearningsLibraryPrototype()", () => {
  it("lets a member browse each status without exposing decision controls", () => {
    renderPrototype(createPrototypeData(false))

    expect(screen.getByRole("heading", { name: "Learnings" })).toBeVisible()
    expect(screen.queryByRole("button", { name: "Back to learnings" })).not.toBeInTheDocument()
    const connectLink = screen.getByRole("link", { name: "Connect an agent" })
    expect(connectLink).toHaveAttribute("href", "/settings/agents?repositoryId=2001")
    expect(connectLink.closest("p")).toHaveTextContent(
      "Shared guidance from your team’s prototype reviews.",
    )

    for (const [section, title] of [
      ["Suggested", "Keep form labels visible"],
      ["Active", "Make actions clear"],
      ["Rejected", "Use placeholder text as a label"],
    ] as const) {
      selectSection(section)
      const learning = getLearning(title)
      expect(learning).toBeVisible()
      expect(
        screen.queryByRole("button", {
          name: /^(accept|reject|approve|dismiss|restore|retire)(\b|:)/i,
        }),
      ).not.toBeInTheDocument()
    }

    selectSection("Suggested")
    fireEvent.click(screen.getByRole("button", { name: "Keep form labels visible" }))
    expect(
      screen.queryByRole("button", { name: /accept learning|reject suggestion/i }),
    ).not.toBeInTheDocument()
  })

  it("keeps the learnings introduction when agent setup is unavailable", () => {
    const data = createPrototypeData(false)
    data.agentConnectionPath = undefined
    renderPrototype(data)

    expect(screen.getByText("Shared guidance from your team’s prototype reviews.")).toBeVisible()
    expect(screen.queryByRole("link", { name: "Connect an agent" })).not.toBeInTheDocument()
  })

  it("shows a focus indicator after keyboard activation but not pointer activation", () => {
    renderPrototype(createPrototypeData(false))
    selectSection("Active")

    const learningButton = screen.getByRole("button", { name: "Make actions clear" })
    fireEvent.click(learningButton, { detail: 1 })
    const title = screen.getByRole("heading", { name: "Make actions clear" })
    expect(document.activeElement).toBe(title)
    expect(title).not.toHaveClass("learning-library__page-title--focus-visible")

    fireEvent.click(screen.getByRole("button", { name: "Back to learnings" }), { detail: 1 })
    fireEvent.click(screen.getByRole("button", { name: "Make actions clear" }), { detail: 0 })
    const reopenedTitle = screen.getByRole("heading", { name: "Make actions clear" })
    expect(document.activeElement).toBe(reopenedTitle)
    expect(reopenedTitle).toHaveClass("learning-library__page-title--focus-visible")
  })

  it("accepts suggestions, requires a rejection reason, and lets an admin accept a rejected learning", () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    renderPrototype(createPrototypeData(true))

    selectSection("Suggested")
    const suggestion = getLearning("Keep form labels visible")
    fireEvent.click(within(suggestion).getByRole("button", { name: "Keep form labels visible" }))
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Keep form labels visible" }),
    )
    expect(screen.queryByRole("button", { name: "Edit learning" })).not.toBeInTheDocument()
    const pageHeader = screen
      .getByRole("heading", { name: "Keep form labels visible" })
      .closest("header")
    if (!pageHeader) throw new Error("Expected the learning title in the page header")
    expect(within(pageHeader).getByRole("button", { name: "Accept learning" })).toBeVisible()
    expect(within(pageHeader).getByRole("button", { name: "Reject suggestion" })).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: /accept learning/i }))

    expect(document.activeElement).toBe(getSectionControl("Active"))
    selectSection("Active")
    const acceptedLearning = getLearning("Keep form labels visible")
    expect(acceptedLearning).toBeVisible()
    expect(within(acceptedLearning).getByText("November 20, 2026")).toHaveAttribute(
      "datetime",
      "2026-11-20T12:00:00.000Z",
    )
    selectSection("Suggested")
    expect(
      screen.queryByRole("button", { name: "Keep form labels visible" }),
    ).not.toBeInTheDocument()

    const rejectionTitle = "Rely on placeholder text"
    selectSection("Suggested")
    const suggestionToReject = getLearning(rejectionTitle)
    fireEvent.click(within(suggestionToReject).getByRole("button", { name: rejectionTitle }))
    fireEvent.click(screen.getByRole("button", { name: /reject suggestion/i }))

    const dialog = screen.getByRole("dialog", { name: "Reject learning" })
    const reason = within(dialog).getByRole("textbox", { name: "Why reject this learning?" })
    expect(reason).toBeRequired()
    const rejectionForm = reason.closest("form")
    if (!rejectionForm) throw new Error("Expected the rejection reason form")
    fireEvent.submit(rejectionForm)
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Enter a reason to reject this learning.",
    )

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("dialog", { name: "Reject learning" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: rejectionTitle })).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: /reject suggestion/i }))
    const reopenedDialog = screen.getByRole("dialog", { name: "Reject learning" })
    const completedReason = within(reopenedDialog).getByRole("textbox", {
      name: "Why reject this learning?",
    })
    fireEvent.change(completedReason, {
      target: { value: "The placeholder disappears while typing." },
    })
    const completedForm = completedReason.closest("form")
    if (!completedForm) throw new Error("Expected the rejection reason form")
    fireEvent.submit(completedForm)

    const backToLearnings = screen.queryByRole("button", { name: /learnings/i })
    if (backToLearnings) fireEvent.click(backToLearnings)
    expect(document.activeElement).toBe(getSectionControl("Rejected"))
    const rejectedLearning = getLearning(rejectionTitle)
    expect(rejectedLearning).toBeVisible()
    expect(within(rejectedLearning).getByText("1 review comment")).toBeVisible()
    expect(within(rejectedLearning).getByText("November 20, 2026")).toHaveAttribute(
      "datetime",
      "2026-11-20T12:00:00.000Z",
    )
    fireEvent.click(within(rejectedLearning).getByRole("button", { name: rejectionTitle }))
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: rejectionTitle }))
    expect(screen.getByText("The placeholder disappears while typing.")).toBeVisible()
    expect(screen.getByText("1 review comment")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: /learnings/i }))
    expect(document.activeElement).toBe(
      within(getLearning(rejectionTitle)).getByRole("button", { name: rejectionTitle }),
    )
    fireEvent.click(
      within(getLearning(rejectionTitle)).getByRole("button", { name: rejectionTitle }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Accept learning" }))
    selectSection("Active")
    fireEvent.click(
      within(getLearning(rejectionTitle)).getByRole("button", { name: rejectionTitle }),
    )
    expect(screen.getByRole("region", { name: "Decision history" })).toHaveTextContent(
      "The placeholder disappears while typing.",
    )
    expect(screen.getByText("Not evaluated yet.")).toBeVisible()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("applies a suggested update without carrying its outcomes onto the new guidance", () => {
    const data = createPrototypeData(true)
    const activeLearning = data.learnings.find((learning) => learning.status === "active")
    if (!activeLearning) throw new Error("Expected an active learning")
    activeLearning.outcomeAssessment = {
      version: 1,
      status: "observed",
      outcomes: [
        {
          id: "outcome-automated",
          prototypeName: "Settings",
          buildNumber: 7,
          buildPath: "/repositories/2001/prototypes/22?build=7",
          result: "supports",
          source: "automated",
          summary: "The primary action stands out beside secondary controls.",
          evaluatedAt: "2026-11-17T16:30:00.000Z",
        },
        {
          id: "outcome-desktop",
          prototypeName: "Settings",
          buildNumber: 8,
          buildPath: "/repositories/2001/prototypes/22?build=8",
          result: "supports",
          source: "reviewer-confirmed",
          summary: "The primary action is easy to identify.",
          evaluatedAt: "2026-11-18T16:30:00.000Z",
        },
      ],
    }
    activeLearning.updateSuggestion = {
      title: "Keep one primary action visible",
      guidance: "Keep the primary action clear on narrow screens too.",
      reason: "A mobile review found the sticky action covered a field.",
    }
    renderPrototype(data)
    selectSection("Active")

    expect(getLearning("Make actions clear")).toHaveTextContent("Update suggested")
    fireEvent.click(screen.getByRole("button", { name: "Make actions clear" }))
    const suggestedUpdate = screen.getByRole("region", { name: "Suggested update" })
    expect(suggestedUpdate).toHaveTextContent(
      "A mobile review found the sticky action covered a field.",
    )
    expect(within(suggestedUpdate).getAllByRole("deletion")[0]).toHaveTextContent(
      "Removed: Make actions clear",
    )
    expect(within(suggestedUpdate).getAllByRole("insertion")[0]).toHaveTextContent(
      "Added: Keep one primary action visible",
    )
    const observedOutcomes = screen.getByRole("region", { name: "Observed outcomes" })
    expect(within(observedOutcomes).getAllByRole("listitem")).toHaveLength(2)
    expect(observedOutcomes).toHaveTextContent("Automated assessment")
    expect(observedOutcomes).toHaveTextContent("Reviewer-confirmed")
    expect(screen.getByRole("link", { name: "Settings, Build 8" })).toHaveAttribute(
      "href",
      "/repositories/2001/prototypes/22?build=8",
    )
    fireEvent.click(screen.getByRole("button", { name: "Apply update" }))

    expect(screen.getByRole("heading", { name: "Keep one primary action visible" })).toBeVisible()
    expect(screen.getByText("Keep the primary action clear on narrow screens too.")).toBeVisible()
    expect(screen.getByText("Not evaluated yet.")).toBeVisible()
    fireEvent.click(screen.getByText("Earlier guidance"))
    expect(screen.getByRole("link", { name: "Settings, Build 8" })).toHaveAttribute(
      "href",
      "/repositories/2001/prototypes/22?build=8",
    )
    expect(screen.queryByRole("region", { name: "Suggested update" })).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Observed outcomes" })).toBeVisible()
  })

  it("lets an admin edit and apply a proposed update", () => {
    const data = createPrototypeData(true)
    const activeLearning = data.learnings.find((learning) => learning.status === "active")
    if (!activeLearning) throw new Error("Expected an active learning")
    activeLearning.updateSuggestion = {
      title: "Use direct action labels",
      guidance: "Describe the result on each primary action.",
      reason: "Recent evaluations suggest clearer action labels.",
    }
    renderPrototype(data)
    selectSection("Active")
    fireEvent.click(screen.getByRole("button", { name: "Make actions clear" }))
    fireEvent.click(screen.getByRole("button", { name: "Edit proposed update" }))
    const dialog = screen.getByRole("dialog", { name: "Edit proposed update" })
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Proposed title" }), {
      target: { value: "Make primary actions clear" },
    })
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Proposed guidance" }), {
      target: { value: "Use short labels that describe the result of each action." },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply edited update" }))

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Make primary actions clear" })).toBeVisible()
    expect(
      screen.getByText("Use short labels that describe the result of each action."),
    ).toBeVisible()
    expect(screen.queryByRole("region", { name: "Suggested update" })).not.toBeInTheDocument()
  })

  it("dismisses a proposed update without changing the active learning", () => {
    const data = createPrototypeData(true)
    const activeLearning = data.learnings.find((learning) => learning.status === "active")
    if (!activeLearning) throw new Error("Expected an active learning")
    activeLearning.updateSuggestion = {
      title: "Use direct action labels",
      guidance: "Describe the result on each primary action.",
      reason: "Recent evaluations suggest clearer action labels.",
    }
    renderPrototype(data)
    selectSection("Active")
    fireEvent.click(screen.getByRole("button", { name: "Make actions clear" }))
    fireEvent.click(screen.getByRole("button", { name: "Dismiss update" }))

    expect(screen.getByRole("heading", { name: "Make actions clear" })).toBeVisible()
    expect(screen.getByText("Use clear labels for primary actions.")).toBeVisible()
    expect(screen.queryByRole("region", { name: "Suggested update" })).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(
      "Suggested learning update dismissed. The active learning is unchanged.",
    )
    expect(screen.getByRole("button", { name: "Reject learning" })).toBeVisible()
  })

  it("edits a learning in a modal and discards changes when cancelled", () => {
    renderPrototype(createPrototypeData(true))
    selectSection("Active")
    const learning = getLearning("Make actions clear")
    fireEvent.click(within(learning).getByRole("button", { name: "Make actions clear" }))
    fireEvent.click(screen.getByRole("button", { name: /edit learning/i }))

    const cancelledDialog = screen.getByRole("dialog", { name: "Edit learning" })
    fireEvent.change(within(cancelledDialog).getByRole("textbox", { name: "Title" }), {
      target: { value: "Discarded title" },
    })
    fireEvent.click(within(cancelledDialog).getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("dialog", { name: "Edit learning" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Make actions clear" })).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: /edit learning/i }))
    const dialog = screen.getByRole("dialog", { name: "Edit learning" })
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Title" }), {
      target: { value: "Make primary actions clear" },
    })
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Guidance" }), {
      target: { value: "Use short, specific labels for primary actions." },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }))

    expect(screen.queryByRole("dialog", { name: "Edit learning" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Make primary actions clear" })).toBeVisible()
    expect(screen.getByText("Use short, specific labels for primary actions.")).toBeVisible()
    expect(screen.getByText("November 20, 2026", { selector: "time" })).toHaveAttribute(
      "datetime",
      "2026-11-20T12:00:00.000Z",
    )
  })

  it("updates the activity measure and exposes the selected run's separate counts and status", () => {
    renderPrototype(createPrototypeData(false))
    const activityGrid = screen.getByRole("group", {
      name: "Daily learning activity for 2026",
    })
    // Every day from Jan 1 to today (November 20) can be inspected.
    expect(within(activityGrid).getAllByRole("button")).toHaveLength(324)
    const day = within(activityGrid).getByRole("button", { name: /November 19, 2026/i })
    fireEvent.click(day)
    const analyzedLabel = day.getAttribute("aria-label")

    const metricControls = screen.getByRole("group", { name: "Activity measure" })
    const analyzedMetric = within(metricControls).getByRole("button", {
      name: /comments analyzed/i,
    })
    fireEvent.click(analyzedMetric)
    expect(analyzedMetric).toHaveAttribute("aria-pressed", "true")
    expect(
      screen.getByText("Comments analyzed", { selector: "dt" }).parentElement,
    ).toHaveTextContent("12")
    expect(
      screen.getByText("Comments categorized", { selector: "dt" }).parentElement,
    ).toHaveTextContent("4")
    expect(screen.getByText("Suggestions", { selector: "dt" }).parentElement).toHaveTextContent("2")
    expect(screen.getByText(/Run completed/)).toBeVisible()
    const analyzedIntensity = day.style.getPropertyValue("--activity-level")

    const categorizedMetric = within(metricControls).getByRole("button", {
      name: /comments categorized/i,
    })
    fireEvent.click(categorizedMetric)
    expect(categorizedMetric).toHaveAttribute("aria-pressed", "true")
    const categorizedDay = within(activityGrid).getByRole("button", {
      name: /November 19, 2026/i,
    })
    expect(categorizedDay.style.getPropertyValue("--activity-level")).not.toBe(analyzedIntensity)
    expect(categorizedDay.getAttribute("aria-label")).not.toBe(analyzedLabel)
    expect(categorizedDay).toHaveAccessibleName(/4 comments categorized/i)
  })

  it("lays out the calendar and supports keyboard date selection", () => {
    renderPrototype(createPrototypeData(false))
    const calendar = screen.getByRole("group", { name: "Daily learning activity for 2026" })
    expect(within(calendar).getAllByRole("button", { name: /^September / })).toHaveLength(30)
    expect(within(calendar).getAllByRole("button", { name: /^October / })).toHaveLength(31)
    expect(within(calendar).getAllByRole("button", { name: /^November / })).toHaveLength(20)
    expect(within(calendar).queryByRole("button", { name: /2025,/ })).not.toBeInTheDocument()
    expect(within(calendar).getByText("Jan")).toBeInTheDocument()
    expect(within(calendar).getByText("Dec")).toBeInTheDocument()

    const thursday = within(calendar).getByRole("button", { name: /^January 1, 2026,/ })
    const saturday = within(calendar).getByRole("button", { name: /^October 31, 2026,/ })
    const sunday = within(calendar).getByRole("button", { name: /^November 1, 2026,/ })
    const wednesday = within(calendar).getByRole("button", { name: /^November 18, 2026,/ })
    const firstWeek = thursday.parentElement
    const octoberWeek = saturday.parentElement
    const novemberWeek = sunday.parentElement
    const lastWeek = wednesday.parentElement
    if (!firstWeek || !octoberWeek || !novemberWeek || !lastWeek) {
      throw new Error("Expected calendar weeks")
    }

    // Each column has a month label followed by Sunday through Saturday.
    expect(firstWeek.children[5]).toBe(thursday)
    expect(octoberWeek.children[7]).toBe(saturday)
    expect(octoberWeek.nextElementSibling).toBe(novemberWeek)
    expect(novemberWeek.children[1]).toBe(sunday)
    expect(lastWeek.children[4]).toBe(wednesday)
    expect(within(calendar).getByRole("button", { name: /^November 19, 2026,/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(
      within(calendar).getByRole("button", { name: /^November 17, 2026,.*no run$/ }),
    ).toBeVisible()

    const dateButtons = within(calendar).getAllByRole("button")
    expect(dateButtons.filter((button) => button.tabIndex === 0)).toHaveLength(1)
    expect(dateButtons.filter((button) => button.tabIndex === -1)).toHaveLength(323)

    fireEvent.click(wednesday)
    expect(wednesday).toHaveAttribute("aria-pressed", "true")
    fireEvent.keyDown(wednesday, { key: "ArrowDown" })
    const novemberNineteen = within(calendar).getByRole("button", {
      name: /^November 19, 2026,/,
    })
    expect(novemberNineteen).toHaveAttribute("aria-pressed", "true")
    expect(document.activeElement).toBe(novemberNineteen)
    fireEvent.keyDown(novemberNineteen, { key: "ArrowRight" })
    expect(document.activeElement).toBe(novemberNineteen)
  })

  it("pages long lists and starts each status on its first page", () => {
    const data = createPrototypeData(false)
    const [template, , ...otherStatuses] = data.learnings
    if (!template) throw new Error("Expected a suggestion to copy")
    const suggestions = Array.from({ length: 30 }, (_, index) => ({
      ...template,
      id: `learning-page-${index + 1}`,
      title: `Paged suggestion ${index + 1}`,
    }))
    renderPrototype({ ...data, learnings: [...suggestions, ...otherStatuses] })

    const pages = screen.getByRole("navigation", { name: "Learnings pages" })
    expect(screen.getAllByRole("button", { name: /^Paged suggestion/ })).toHaveLength(25)
    expect(screen.queryByRole("button", { name: "Paged suggestion 26" })).not.toBeInTheDocument()

    // Brand marks the last page "Page 2...", so match the start of its name.
    fireEvent.click(within(pages).getByRole("button", { name: /^Page 2\b/ }))
    expect(screen.getAllByRole("button", { name: /^Paged suggestion/ })).toHaveLength(5)
    expect(screen.getByRole("button", { name: "Paged suggestion 26" })).toBeVisible()
    expect(within(pages).getByRole("button", { name: /^Page 2\b/ })).toHaveAttribute(
      "aria-current",
      "page",
    )

    selectSection("Active")
    expect(screen.queryByRole("navigation", { name: "Learnings pages" })).not.toBeInTheDocument()
    selectSection("Suggested")
    expect(screen.getByRole("button", { name: "Paged suggestion 1" })).toBeVisible()
  })

  it("shows review comments in one quiet section and links to their source reviews", () => {
    const data = createPrototypeData(false)
    const activeLearning = data.learnings.find((learning) => learning.status === "active")
    if (!activeLearning) throw new Error("Expected an active learning")
    activeLearning.evidence = activeLearning.evidence.map((comment) => ({
      ...comment,
      authorLogin: "octocat",
      prototypeName: "Checkout refresh",
    }))
    renderPrototype(data)
    selectSection("Active")
    const learning = getLearning("Make actions clear")
    expect(within(learning).getByText("2 review comments")).toBeVisible()
    fireEvent.click(within(learning).getByRole("button", { name: "Make actions clear" }))

    expect(screen.getByText("The visible label made the form easier to scan.")).toBeVisible()
    expect(screen.getByText("The Save button does not stand out beside Cancel.")).toBeVisible()
    expect(screen.getByRole("region", { name: "Review comments" })).toBeVisible()
    expect(screen.getByRole("heading", { name: "Review comments" })).toBeVisible()
    expect(
      screen.queryByRole("heading", {
        name: /Review evidence|Supporting comments|Different views/,
      }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/Category: Content/)).toBeVisible()
    expect(screen.getByText("2 review comments")).toBeVisible()
    expect(
      screen.getAllByRole("link", { name: /Build [58]/i }).map((link) => link.getAttribute("href")),
    ).toEqual([
      "https://github.com/github/prototype/pull/42#discussion_r100",
      "https://github.com/github/prototype/pull/43#discussion_r101",
    ])
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })
})
