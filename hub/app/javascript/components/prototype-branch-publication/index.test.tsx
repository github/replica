import { ThemeProvider } from "@primer/react-brand/esm"
import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"

import { BranchPublication } from "."
import { resolvePublication } from "@utils/resolve-prototype-publication"
import { publicationExamples } from "@utils/resolve-prototype-publication/fixtures"
import type { PrototypeState } from "@utils/prototype-canvas/types"

it("renders no publication section when ready, even with local changes", () => {
  const example = publicationExamples.Published!
  const view = render(
    <ThemeProvider>
      <BranchPublication
        publication={resolvePublication(example.state, example.hub)}
        busy={false}
        dirty
        onPublish={() => {}}
        onRetry={() => {}}
      />
    </ThemeProvider>,
  )
  expect(screen.queryByRole("region", { name: "Branch publication" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Published" })).not.toBeInTheDocument()
  expect(screen.queryByText(/Uncommitted changes are not included/)).not.toBeInTheDocument()
  view.unmount()
})

it("shows concise unpublished copy and dispatches once with local changes", () => {
  const onPublish = vi.fn()
  const example = publicationExamples["Unpublished branch"]!
  const view = render(
    <ThemeProvider>
      <BranchPublication
        publication={resolvePublication(example.state, example.hub)}
        busy={false}
        dirty
        onPublish={onPublish}
        onRetry={() => {}}
      />
    </ThemeProvider>,
  )
  expect(screen.getByRole("status")).toHaveTextContent(
    "This branch won't appear in the hub until you publish.",
  )
  expect(view.container.querySelectorAll("p")).toHaveLength(1)
  expect(screen.queryByText(/Uncommitted changes are not included/)).not.toBeInTheDocument()
  expect(screen.queryByRole("heading", { name: "Branch publication" })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Publish" }))
  expect(onPublish).toHaveBeenCalledOnce()
  view.unmount()
})

it("removes the dirty-file notice without changing the existing push action", () => {
  const example = publicationExamples["Unpushed changes"]!
  const view = render(
    <ThemeProvider>
      <BranchPublication
        publication={resolvePublication(example.state, example.hub)}
        busy={false}
        dirty
        onPublish={() => {}}
        onRetry={() => {}}
      />
    </ThemeProvider>,
  )
  expect(screen.queryByText(/safe push of committed files only/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Uncommitted changes/)).not.toBeInTheDocument()
  expect(screen.getByRole("status")).toHaveTextContent("Publish pushes this branch without force.")
  expect(screen.getByRole("button", { name: "Publish changes" })).toBeEnabled()
  view.unmount()
})

it("uses the shared critical error banner instead of a status message", () => {
  const example = publicationExamples["Automatic publication failed"]!
  const publication = resolvePublication(example.state, example.hub)
  const view = render(
    <ThemeProvider>
      <BranchPublication
        publication={publication}
        busy={false}
        dirty
        onPublish={() => {}}
        onRetry={() => {}}
      />
    </ThemeProvider>,
  )
  expect(screen.getByRole("alert")).toHaveTextContent(publication.error!.title)
  expect(screen.getByRole("alert")).toHaveTextContent(publication.error!.description)
  expect(view.container.querySelector(".hub-alert__title")).toHaveTextContent(
    publication.error!.title,
  )
  expect(view.container.querySelector(".hub-alert__description")).toHaveTextContent(
    publication.error!.description,
  )
  expect(screen.getByRole("alert")).toHaveClass("hub-alert--critical", "hub-alert--compact")
  expect(screen.queryByRole("status")).not.toBeInTheDocument()
  expect(screen.queryByText(/safe push of committed files only/)).not.toBeInTheDocument()
  view.unmount()
})

it("shows push progress without asking for reconfirmation while a request is pending", () => {
  const example = publicationExamples["Unpublished branch"]!
  const state = {
    ...example.state!,
    publishRequest: {
      state: "requested",
      requestedAt: new Date().toISOString(),
      commitSha: example.state!.stats.commitSha,
    },
  } satisfies PrototypeState
  const view = render(
    <ThemeProvider>
      <BranchPublication
        publication={resolvePublication(state, example.hub)}
        busy={false}
        dirty
        onPublish={() => {}}
        onRetry={() => {}}
      />
    </ThemeProvider>,
  )
  expect(screen.getByRole("status")).toHaveTextContent(
    "Copilot received the publish request in chat and has not pushed this branch yet. Follow its progress in chat.",
  )
  expect(view.container.querySelectorAll("p")).toHaveLength(1)
  const button = screen.getByRole("button", { name: "Waiting for Copilot" })
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute("aria-busy", "true")
  expect(button.querySelector("svg")).not.toBeNull()
  expect(screen.queryByText(/Uncommitted changes are not included/)).not.toBeInTheDocument()
  expect(screen.queryByText(/confirm.*push/)).not.toBeInTheDocument()
  view.unmount()
})

it("renders the workflow run with Brand InlineLink and safe external link attributes", () => {
  const example = publicationExamples["Build queued"]!
  const view = render(
    <ThemeProvider>
      <BranchPublication
        publication={resolvePublication(example.state, example.hub)}
        busy={false}
        dirty={false}
        onPublish={() => {}}
        onRetry={() => {}}
      />
    </ThemeProvider>,
  )
  const link = screen.getByRole("link", { name: "View workflow run" })
  expect(link.tagName).toBe("A")
  expect(link.className).toContain("InlineLink")
  expect(link).toHaveClass("canvas-branch-publication__workflow-link")
  expect(link).toHaveAttribute("href", "https://github.com/github/example/actions/runs/1")
  expect(link).toHaveAttribute("target", "_blank")
  expect(link).toHaveAttribute("rel", "noopener noreferrer")
  expect(screen.queryByRole("button", { name: "View workflow run" })).not.toBeInTheDocument()
  view.unmount()
})

it("offers Retry status for unknown remote state instead of publishing", () => {
  const onRetry = vi.fn()
  const onPublish = vi.fn()
  const example = publicationExamples["Remote check failed"]!
  const view = render(
    <ThemeProvider>
      <BranchPublication
        publication={resolvePublication(example.state, example.hub)}
        busy={false}
        dirty={false}
        onPublish={onPublish}
        onRetry={onRetry}
      />
    </ThemeProvider>,
  )
  fireEvent.click(screen.getByRole("button", { name: "Retry status" }))
  expect(onRetry).toHaveBeenCalledOnce()
  expect(onPublish).not.toHaveBeenCalled()
  view.unmount()
})

it("shows automatic progress without manual publication controls", () => {
  const example = publicationExamples["Automatic publication"]!
  const publication = resolvePublication(example.state, example.hub)
  const view = render(
    <ThemeProvider>
      <BranchPublication
        publication={publication}
        busy={false}
        dirty={false}
        onPublish={() => {}}
        onRetry={() => {}}
      />
    </ThemeProvider>,
  )
  expect(screen.getByRole("status")).toHaveTextContent(publication.detail)
  expect(screen.queryByRole("button")).not.toBeInTheDocument()
  expect(
    screen.queryByText(/Registration required|Register the prototype below/),
  ).not.toBeInTheDocument()
  view.unmount()
})
