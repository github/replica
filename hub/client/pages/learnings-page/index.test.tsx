import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LearningsPage } from "."
import story, {
  ActiveDetail,
  CopilotRefused,
  EmptyStatus,
  FirstVisit,
  IdentityRevalidation,
  MemberDetail,
  RejectedDetail,
  Running,
  SuggestionDetail,
  SuggestionWithOpposingEvidence,
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
  it("links each status, search, and learning to an address people can share", () => {
    renderPage(story.args.data)
    const filters = screen.getByRole("navigation", { name: "Learning status" })
    const search = screen.getByRole("search")

    expect(within(filters).getByRole("link", { name: /Suggested/ })).toHaveAttribute(
      "aria-current",
      "true",
    )
    expect(within(filters).getByRole("link", { name: /Rejected/ })).toHaveAttribute(
      "href",
      "/repositories/2001/learnings?status=rejected",
    )
    expect(search).toHaveAttribute("action", "/repositories/2001/learnings")
    expect(search.querySelector('[name="status"]')).toHaveValue("suggested")
    expect(screen.getByRole("link", { name: /Show a visible label/ })).toHaveAttribute(
      "href",
      "/repositories/2001/learnings?status=suggested&learning=mem_7eb35ba21bbe6c45a9a296b4",
    )
  })

  it("explains an empty status and an empty repository", () => {
    renderPage(EmptyStatus.args!.data!)
    expect(screen.getByText("No rejected learnings")).toBeVisible()

    renderPage(FirstVisit.args!.data!)
    expect(screen.getByText("No active learnings")).toBeVisible()
    expect(screen.getByText(/Agents get nothing yet/)).toBeInTheDocument()
    expect(screen.getByText(/Hub has not looked for learnings/)).toBeInTheDocument()
  })

  it("accepts a suggestion as written with the digest the person saw", () => {
    renderPage(SuggestionDetail.args!.data!)
    const form = screen.getByRole("button", { name: "Accept learning" }).closest("form")

    expect(form).toHaveAttribute(
      "action",
      "/repositories/2001/learnings/mem_7eb35ba21bbe6c45a9a296b4/decision",
    )
    expect(form?.querySelector('[name="decision"]')).toHaveValue("accept")
    expect(form?.querySelector('[name="digest"]')).toHaveValue(`sha256:${"a".repeat(64)}`)
    expect(form?.querySelector('[name="authenticity_token"]')).toHaveValue("storybook-token")
    expect(screen.getByRole("link", { name: "Back to learnings" })).toHaveAttribute(
      "href",
      "/repositories/2001/learnings?status=suggested",
    )
    expect(screen.queryByRole("heading", { name: "Recent runs" })).not.toBeInTheDocument()
  })

  it("requires a reason before rejecting a suggestion", () => {
    renderPage(SuggestionDetail.args!.data!)
    fireEvent.click(screen.getByRole("button", { name: "Reject suggestion" }))
    const reason = screen.getByRole("textbox", { name: "Why reject it?" })

    expect(reason).toBeRequired()
    expect(reason.closest("form")?.querySelector('[name="decision"]')).toHaveValue("reject")
    expect(reason.closest("form")?.querySelector('[name="digest"]')).toHaveValue(
      `sha256:${"a".repeat(64)}`,
    )
  })

  it("edits an active learning from its stored wording with a reason", () => {
    renderPage(ActiveDetail.args!.data!)
    fireEvent.click(screen.getByRole("button", { name: "Edit learning" }))
    const content = screen.getByRole("textbox", { name: "Guidance" })
    const form = content.closest("form")

    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      "Use one primary button per form",
    )
    expect(content).toHaveValue(
      "Use one primary button per form, labeled with the action it takes.",
    )
    expect(screen.getByRole("textbox", { name: "Why change it?" })).toBeRequired()
    expect(form?.querySelector('[name="decision"]')).toHaveValue("edit")
    expect(form?.querySelector('[name="digest"]')).toHaveValue(`sha256:${"b".repeat(64)}`)
  })

  it("rejects an active learning without needing its digest", () => {
    renderPage(ActiveDetail.args!.data!)
    fireEvent.click(screen.getByRole("button", { name: "Reject learning" }))
    const retire = screen.getByRole("textbox", { name: "Why reject it?" }).closest("form")
    expect(retire?.querySelector('[name="decision"]')).toHaveValue("retire")
    expect(retire?.querySelector('[name="digest"]')).toBeNull()
  })

  it("shows why a learning was rejected and accepts it again with a reason", () => {
    renderPage(RejectedDetail.args!.data!)
    expect(
      screen.getByText(/would break the back button/, { selector: ".learning-library__reason p" }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Accept learning" }))
    const reinstate = screen.getByRole("textbox", { name: "Why accept it now?" }).closest("form")
    expect(reinstate?.querySelector('[name="decision"]')).toHaveValue("reinstate")
  })

  it("shows members the history and evidence without decision controls", () => {
    renderPage(MemberDetail.args!.data!)
    const history = screen.getByRole("region", { name: "Decision history" })

    expect(within(history).getByText("Edited")).toBeVisible()
    expect(history).toHaveTextContent("Name the action so the rule is easier to apply.")
    expect(screen.getByText("1 more comment that Hub cannot show here")).toBeVisible()
    expect(screen.queryByRole("button", { name: /learning/ })).not.toBeInTheDocument()
  })

  it("separates opposing comments and lists the guidance a suggestion replaces", () => {
    renderPage(SuggestionWithOpposingEvidence.args!.data!)
    const support = screen.getByRole("region", { name: "Review comments" })
    const dissent = screen.getByRole("region", { name: "What reviewers disagreed with" })

    expect(dissent).toHaveTextContent("The existing visible labels already explain these fields.")
    expect(dissent).toHaveTextContent("1 more opposing comment that Hub cannot show here")
    expect(support).not.toHaveTextContent("The existing visible labels")
    expect(support).toHaveTextContent("The user deleted this comment.")
    expect(screen.getByRole("region", { name: "Accepting this replaces" })).toHaveTextContent(
      "Use one primary button per form",
    )
  })

  it("explains identity revalidation without calling it corruption", () => {
    renderPage(IdentityRevalidation.args!.data!)

    expect(
      screen.getByText(/Earlier suggestions or accepted learnings need identity revalidation/),
    ).toBeVisible()
    expect(screen.getByRole("link", { name: /wording is withheld/ })).toBeVisible()
    expect(screen.queryByText(/failed the store's integrity checks/)).not.toBeInTheDocument()
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
    expect(screen.getByRole("link", { name: /Show a visible label/ })).toBeInTheDocument()
  })

  it("resets decision-model drafts and confirmations when the repository changes", () => {
    const first = story.args.data
    if (first.accessDenied || first.decisionModel.state !== "available") {
      throw new Error("The default story must expose decision-model controls.")
    }
    const { rerender } = render(
      <ThemeProvider>
        <LearningsPage data={first} />
      </ThemeProvider>,
    )
    const backend = screen.getByRole("textbox", { name: "Runtime backend" })
    fireEvent.change(backend, { target: { value: "stale-backend" } })
    fireEvent.click(screen.getByRole("button", { name: "Start training" }))

    const second: LearningsPageData = {
      ...first,
      selectedRepositoryId: "2002",
      repositorySelectorLabel: "Choose repository. github/empty selected",
      prototypesPath: "/repositories/2002",
      learningsPath: "/repositories/2002/learnings",
      analyticsPath: "/repositories/2002/analytics",
      decisionModel: {
        ...first.decisionModel,
        settingsPath: "/repositories/2002/learnings/decision-model/settings",
        trainingPath: "/repositories/2002/learnings/decision-model/training",
        rollbackPath: "/repositories/2002/learnings/decision-model/rollback",
        configuration: { ...first.decisionModel.configuration!, backend: "repository-two" },
      },
    }
    rerender(
      <ThemeProvider>
        <LearningsPage data={second} />
      </ThemeProvider>,
    )

    expect(screen.getByRole("textbox", { name: "Runtime backend" })).toHaveValue("repository-two")
    expect(screen.queryByRole("button", { name: "Confirm and start training" })).toBeNull()
  })
})
