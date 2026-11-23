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
    stance: "supports" as const,
  }
  const opposingEvidence = {
    id: "evidence-opposing",
    body: "The field group already has a visible heading.",
    authorLogin: "mona",
    prototypeName: "Settings refresh",
    buildNumber: 5,
    createdAt: "2026-11-17T14:00:00.000Z",
    reviewPath: "https://github.com/github/prototype/pull/43#discussion_r101",
    stance: "opposes" as const,
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
        evidence: [opposingEvidence],
      },
      {
        id: "learning-active",
        title: "Make actions clear",
        guidance: "Use clear labels for primary actions.",
        status: "active",
        topic: "Content",
        updatedAt: "2026-11-18T16:30:00.000Z",
        acceptedBy: "mona",
        evidence: [supportingEvidence, opposingEvidence],
      },
      {
        id: "learning-rejected",
        title: "Use placeholder text as a label",
        guidance: "Rely on placeholder text to identify each field.",
        status: "rejected",
        topic: "Accessibility",
        updatedAt: "2026-11-16T09:00:00.000Z",
        rejectionReason: "Placeholder text is not a persistent label.",
        evidence: [opposingEvidence],
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

  it("accepts a suggestion and requires a reason before moving another to Rejected", () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    renderPrototype(createPrototypeData(true))

    selectSection("Suggested")
    const suggestion = getLearning("Keep form labels visible")
    fireEvent.click(within(suggestion).getByRole("button", { name: "Keep form labels visible" }))
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Keep form labels visible" }),
    )
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

    const reason = screen.getByRole("textbox", { name: "Why reject this suggestion?" })
    expect(reason).toBeRequired()
    const rejectionForm = reason.closest("form")
    if (!rejectionForm) throw new Error("Expected the rejection reason form")
    const submit = within(rejectionForm).getByRole("button", { name: /reject|confirm/i })
    fireEvent.click(submit)
    expect(screen.getByRole("heading", { name: rejectionTitle })).toBeVisible()
    expect(reason).toBeInTheDocument()

    fireEvent.click(within(rejectionForm).getByRole("button", { name: "Cancel" }))
    expect(
      screen.queryByRole("textbox", { name: "Why reject this suggestion?" }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: rejectionTitle })).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: /reject suggestion/i }))
    const completedReason = screen.getByRole("textbox", { name: "Why reject this suggestion?" })
    fireEvent.change(completedReason, {
      target: { value: "The placeholder disappears while typing." },
    })
    const completedForm = completedReason.closest("form")
    if (!completedForm) throw new Error("Expected the rejection reason form")
    fireEvent.click(within(completedForm).getByRole("button", { name: /reject|confirm/i }))

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
    expect(fetch).not.toHaveBeenCalled()
  })

  it("lets an admin edit a learning title and its guidance", () => {
    renderPrototype(createPrototypeData(true))
    selectSection("Active")
    const learning = getLearning("Make actions clear")
    fireEvent.click(within(learning).getByRole("button", { name: "Make actions clear" }))
    fireEvent.click(screen.getByRole("button", { name: /edit learning/i }))

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Make primary actions clear" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "Guidance" }), {
      target: { value: "Use short, specific labels for primary actions." },
    })
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }))

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

  it("shows both kinds of review evidence, links to the source review, and omits screenshots", () => {
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
    expect(screen.getByText("The field group already has a visible heading.")).toBeVisible()
    expect(screen.getByText("Topic", { selector: "dt" }).parentElement).toHaveTextContent("Content")
    expect(screen.getByText("2 review comments")).toBeVisible()
    expect(
      screen
        .getAllByRole("link", { name: /open original review/i })
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "https://github.com/github/prototype/pull/42#discussion_r100",
      "https://github.com/github/prototype/pull/43#discussion_r101",
    ])
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })
})
