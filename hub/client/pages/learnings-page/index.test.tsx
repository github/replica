import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LearningsPage } from "."
import story, {
  CopilotRefused,
  FirstVisit,
  IdentityRevalidation,
  MissingMetadata,
  OpposingEvidence,
  ReplacingGuidance,
  Running,
} from "./stories"
import type { LearningsPageData } from "./types"

function renderPage(data: LearningsPageData) {
  render(
    <ThemeProvider>
      <LearningsPage data={data} />
    </ThemeProvider>,
  )
}

describe("LearningsPage()", () => {
  it("accepts a suggestion as written with the digest the person saw", () => {
    renderPage(story.args.data)
    const suggestion = screen.getByRole("article", { name: /Show a visible label/ })
    const form = within(suggestion).getByRole("button", { name: "Accept" }).closest("form")

    expect(form).toHaveAttribute(
      "action",
      "/repositories/2001/learnings/mem_7eb35ba21bbe6c45a9a296b4/decision",
    )
    expect(form?.querySelector('[name="decision"]')).toHaveValue("accept")
    expect(form?.querySelector('[name="digest"]')).toHaveValue(`sha256:${"a".repeat(64)}`)
    expect(form?.querySelector('[name="authenticity_token"]')).toHaveValue("storybook-token")
    expect(within(suggestion).getByText("Raised by 2 reviewers on 2 prototypes")).toBeVisible()
  })

  it("asks for the wording before accepting with edits, and returns focus on cancel", async () => {
    renderPage(story.args.data)
    const suggestion = screen.getByRole("article", { name: /Show a visible label/ })
    const edit = within(suggestion).getByRole("button", { name: "Edit and accept" })

    fireEvent.click(edit)
    const wording = within(suggestion).getByRole("textbox", { name: "Wording agents get" })
    expect(wording).toBeRequired()
    expect(wording).toHaveValue(
      "Show a visible label above every form field; never use placeholder text as the only label.",
    )
    expect(wording.closest("form")?.querySelector('[name="decision"]')).toHaveValue("accept")

    fireEvent.click(within(suggestion).getByRole("button", { name: "Cancel" }))
    expect(within(suggestion).queryByRole("textbox")).not.toBeInTheDocument()
    await waitFor(() =>
      expect(within(suggestion).getByRole("button", { name: "Edit and accept" })).toHaveFocus(),
    )
  })

  it("requires a reason to reject a suggestion or retire a learning", () => {
    renderPage(story.args.data)
    const suggestion = screen.getByRole("article", { name: /Show a visible label/ })
    fireEvent.click(within(suggestion).getByRole("button", { name: "Reject" }))
    const reason = within(suggestion).getByRole("textbox", { name: "Why reject this suggestion?" })
    expect(reason).toBeRequired()
    expect(reason.closest("form")?.querySelector('[name="decision"]')).toHaveValue("reject")

    const learning = screen.getByRole("article", { name: /one primary button/ })
    fireEvent.click(within(learning).getByRole("button", { name: "Retire" }))
    const retireReason = within(learning).getByRole("textbox", {
      name: "Why retire this learning?",
    })
    expect(retireReason).toBeRequired()
    expect(retireReason.closest("form")?.querySelector('[name="decision"]')).toHaveValue("retire")
    expect(retireReason.closest("form")?.querySelector('[name="digest"]')).toBeNull()
  })

  it("shows the comments behind a suggestion and what an agent gets", () => {
    renderPage(story.args.data)
    expect(screen.getByText(/only placeholder text that disappears/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Checkout" })).toHaveAttribute(
      "href",
      "/repositories/2001/prototypes/17",
    )
    const preview = screen.getByText(/Approved team learnings/)
    expect(preview).toHaveAttribute("role", "region")
    expect(preview).toHaveAttribute("tabindex", "0")
    expect(preview).toHaveAccessibleName("What an agent gets")
    expect(screen.getByRole("cell", { name: "0.0735 AI credits in 1 request" })).toBeInTheDocument()
  })

  it("explains an empty repository instead of showing empty lists", () => {
    renderPage(FirstVisit.args!.data!)
    expect(screen.getByText(/No suggestions yet/)).toBeInTheDocument()
    expect(screen.getByText("No accepted learnings yet.")).toBeInTheDocument()
    expect(screen.getByText(/Agents get nothing yet/)).toBeInTheDocument()
    expect(screen.getByText(/Hub has not looked for learnings/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Find learnings now" })).toBeInTheDocument()
  })

  it("separates opposing comments and reports opposing evidence Hub cannot show", () => {
    renderPage(OpposingEvidence.args!.data!)
    const support = screen.getByText("What reviewers said").closest("details")
    const dissent = screen.getByText("What reviewers disagreed with").closest("details")

    expect(support).not.toBe(dissent)
    expect(dissent).toHaveTextContent("The existing visible labels already explain these fields.")
    expect(dissent).toHaveTextContent("1 more opposing comment that Hub cannot show here")
    expect(support).not.toHaveTextContent("The existing visible labels")
    expect(screen.getByText(/preview's count or text limit leaves it out/)).toBeInTheDocument()
  })

  it("keeps decisions without optional counts and omits damaged learning attribution", () => {
    renderPage(MissingMetadata.args!.data!)

    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument()
    expect(screen.getByText(/only placeholder text that disappears/)).toBeInTheDocument()
    expect(screen.queryByText(/Raised by/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Accepted by/)).not.toBeInTheDocument()
    expect(screen.getByText(/wording is unavailable because its stored record/)).toBeInTheDocument()
    expect(
      screen.getByText(/This learning failed the store's integrity checks/),
    ).toBeInTheDocument()
  })

  it("explains identity revalidation without calling it corruption or losing the prior approval", () => {
    renderPage(IdentityRevalidation.args!.data!)

    expect(
      screen.getByText(/Earlier suggestions or accepted learnings need identity revalidation/),
    ).toBeVisible()
    expect(screen.getByText(/wording is withheld until its reviewer identities/)).toBeVisible()
    expect(screen.getByText(/Accepted by @mona/)).toBeVisible()
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument()
    expect(screen.queryByText(/failed the store's integrity checks/)).not.toBeInTheDocument()
  })

  it("shows every replacement target and its permitted wording beside the acceptance controls", () => {
    renderPage(ReplacingGuidance.args!.data!)
    const suggestion = screen.getByRole("article", { name: /Make every form readable/ })
    const targets = within(suggestion).getByRole("list", {
      name: "Accepting this replaces the guidance listed below.",
    })

    expect(within(targets).getAllByRole("listitem")).toHaveLength(2)
    expect(targets).toHaveTextContent("mem_1d9f0c2b7a4e5f6a8b9c0d1e")
    expect(targets).toHaveTextContent("Use one primary button per form")
    expect(targets).toHaveTextContent("mem_2d9f0c2b7a4e5f6a8b9c0d1e")
    expect(targets).toHaveTextContent("This learning's wording is not available for review.")
    expect(within(suggestion).getByRole("button", { name: "Accept" })).toBeVisible()
  })

  it("offers no new run while one runs or Copilot refused the token", () => {
    renderPage(Running.args!.data!)
    expect(screen.queryByRole("button", { name: "Find learnings now" })).not.toBeInTheDocument()
    expect(screen.getByText("Hub is looking for learnings now.")).toHaveAttribute("role", "status")
  })

  it("warns that Copilot refused the token while keeping decisions available", () => {
    renderPage(CopilotRefused.args!.data!)
    expect(
      screen.getByText(/Copilot refused Hub's Copilot token on October 9, 2026/),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Find learnings now" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument()
  })
})
