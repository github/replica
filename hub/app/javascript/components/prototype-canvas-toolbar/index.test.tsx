import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ThemeProvider } from "@primer/react-brand"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { Toolbar } from "."

const config = { name: "Demo", prototypeUrl: "http://localhost:3000", token: "local-token" }
const props = {
  config,
  onPublish: () => undefined,
  onBuildDetails: () => undefined,
  publishButtonRef: createRef<HTMLButtonElement>(),
  titleButtonRef: createRef<HTMLButtonElement>(),
  publishing: false,
}

describe("Toolbar()", () => {
  it("shows the more menu only when the caller supplies a context action", () => {
    const onImproveContext = vi.fn()
    const view = render(
      <ThemeProvider>
        <Toolbar {...props} state={null} />
      </ThemeProvider>,
    )
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument()

    view.rerender(
      <ThemeProvider>
        <Toolbar {...props} state={null} onImproveContext={onImproveContext} />
      </ThemeProvider>,
    )
    const more = screen.getByRole("button", { name: "More actions" })
    const publish = screen.getByRole("button", { name: "Publish" })
    expect(publish.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole("menuitem", { name: "Improve context" })).not.toBeInTheDocument()
    fireEvent.click(more)
    fireEvent.click(screen.getByRole("menuitem", { name: "Improve context" }))
    expect(onImproveContext).toHaveBeenCalledOnce()
    expect(more).toHaveAttribute("aria-expanded", "false")
    expect(more).toHaveFocus()

    view.rerender(
      <ThemeProvider>
        <Toolbar {...props} state={null} />
      </ThemeProvider>,
    )
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument()
  })

  it.each(["Enter", " "])("runs the menu action once with %j", (key) => {
    const onImproveContext = vi.fn()
    render(
      <ThemeProvider>
        <Toolbar {...props} state={null} onImproveContext={onImproveContext} />
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "More actions" }))
    expect(
      fireEvent.keyDown(screen.getByRole("menuitem", { name: "Improve context" }), { key }),
    ).toBe(false)
    expect(onImproveContext).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "More actions" })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    expect(screen.getByRole("button", { name: "More actions" })).toHaveFocus()
  })

  it("explains feedback review on hover and keyboard focus without running it", async () => {
    const onImproveContext = vi.fn()
    render(
      <ThemeProvider>
        <Toolbar {...props} state={null} onImproveContext={onImproveContext} />
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "More actions" }))
    const item = screen.getByRole("menuitem", { name: "Improve context" })
    expect(item).toHaveAccessibleDescription(
      "Run a skill to improve repository context from user feedback.",
    )
    const tooltip = document.getElementById(item.getAttribute("aria-describedby")!)!
    fireEvent.mouseEnter(item)
    await waitFor(() => expect(tooltip.matches(":popover-open")).toBe(true))
    tooltip.hidePopover()
    fireEvent.focus(item)
    expect(tooltip.matches(":popover-open")).toBe(true)
    expect(onImproveContext).not.toHaveBeenCalled()
  })

  it("preserves the full long branch in its accessible name and hover title", () => {
    const branch = "prototype/refine-project-navigation-and-review-workflow"
    render(
      <ThemeProvider>
        <Toolbar {...props} state={{ name: "Projects", stats: { branch } }} />
      </ThemeProvider>,
    )
    const title = screen.getByRole("button", { name: branch })
    expect(title).toHaveAttribute("title", expect.stringContaining(branch))
    expect(title).toHaveTextContent(branch)
  })

  it("places the labeled share icon to the right of Publish without disabling it during publishing", () => {
    const onShare = vi.fn()
    const shareButtonRef = createRef<HTMLButtonElement>()
    render(
      <ThemeProvider>
        <Toolbar
          {...props}
          state={null}
          publishing
          onShare={onShare}
          shareButtonRef={shareButtonRef}
        />
      </ThemeProvider>,
    )
    const publish = screen.getByRole("button", { name: "Publish" })
    const share = screen.getByRole("button", { name: "Share prototype" })
    expect(publish).toBeDisabled()
    expect(share).toBeEnabled()
    expect(share).not.toHaveAttribute("aria-haspopup")
    expect(share).toHaveAccessibleDescription("Share prototype")
    expect(share.querySelector(".octicon-link")).not.toBeNull()
    expect(publish.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(shareButtonRef.current).toBe(share)
    fireEvent.click(share)
    expect(onShare).toHaveBeenCalledOnce()
  })
  it("names the Hub toggle Edit details and preserves its ref and action", () => {
    const onHub = vi.fn()
    const hubButtonRef = createRef<HTMLButtonElement>()
    render(
      <ThemeProvider>
        <Toolbar {...props} state={null} onHub={onHub} hubButtonRef={hubButtonRef} hubOpen />
      </ThemeProvider>,
    )
    const button = screen.getByRole("button", { name: "Edit details" })
    expect(hubButtonRef.current).toBe(button)
    expect(button).toHaveAttribute("aria-expanded", "true")
    expect(button).toHaveAttribute("title", "Edit details")
    fireEvent.click(button)
    expect(onHub).toHaveBeenCalledOnce()
    expect(screen.queryByRole("button", { name: "Hub" })).not.toBeInTheDocument()
  })
  it("shows the pending publish action as disabled and busy after dispatch has finished", () => {
    render(
      <ThemeProvider>
        <Toolbar
          {...props}
          state={null}
          publication={{
            kind: "requested",
            detail:
              "Copilot received the publish request in chat and has not pushed this branch yet. Follow its progress in chat.",
            label: "Publish",
            action: "none",
          }}
        />
      </ThemeProvider>,
    )
    const button = screen.getByRole("button", { name: "Publish" })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-busy", "true")
    expect(button.querySelector("svg")).not.toBeNull()
  })
  it("opens controls with a labeled sliders icon button", () => {
    const onControls = vi.fn()
    const controlsButtonRef = createRef<HTMLButtonElement>()
    const view = render(
      <ThemeProvider colorMode="auto">
        <Toolbar
          {...props}
          state={null}
          onControls={onControls}
          controlsOpen={false}
          controlsButtonRef={controlsButtonRef}
        />
      </ThemeProvider>,
    )
    const button = screen.getByRole("button", { name: "Controls" })
    expect(button).toHaveClass("hub-icon-button")
    expect(button).toHaveClass("canvas-controls-toggle")
    expect(button).not.toHaveClass("hub-icon-button--invisible")
    expect(button).not.toHaveClass("controls-ghost-button")
    expect(button.querySelector(".octicon-sliders")).not.toBeNull()
    expect(button).not.toHaveAttribute("aria-haspopup")
    expect(button).toHaveAttribute("aria-expanded", "false")
    expect(controlsButtonRef.current).toBe(button)
    fireEvent.click(button)
    expect(onControls).toHaveBeenCalledOnce()
    view.rerender(
      <ThemeProvider colorMode="auto">
        <Toolbar {...props} state={null} onControls={onControls} controlsOpen />
      </ThemeProvider>,
    )
    expect(screen.getByRole("button", { name: "Controls" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    expect(screen.getByRole("button", { name: "Controls" })).not.toHaveClass(
      "hub-icon-button--invisible",
    )
  })

  it.each([undefined, "", "   "])(
    "uses the current branch when the title is %j",
    (prototypeName) => {
      const state = {
        name: "127.0.0.1",
        stats: { branch: "prototype/untitled" },
      }
      const { rerender } = render(
        <ThemeProvider colorMode="auto">
          <Toolbar {...props} state={state} prototypeName={prototypeName} />
        </ThemeProvider>,
      )
      expect(screen.getByRole("button", { name: "prototype/untitled" })).toBeEnabled()
      expect(screen.queryByRole("button", { name: "127.0.0.1" })).not.toBeInTheDocument()
      rerender(
        <ThemeProvider colorMode="auto">
          <Toolbar
            {...props}
            state={{ ...state, stats: { branch: "prototype/next" } }}
            prototypeName={prototypeName}
          />
        </ThemeProvider>,
      )
      expect(screen.getByRole("button", { name: "prototype/next" })).toBeEnabled()
    },
  )

  it("keeps the publish button ref and action", () => {
    const onPublish = vi.fn()
    const publishButtonRef = createRef<HTMLButtonElement>()
    render(
      <ThemeProvider colorMode="auto">
        <Toolbar
          {...props}
          onPublish={onPublish}
          publishButtonRef={publishButtonRef}
          state={null}
        />
      </ThemeProvider>,
    )

    const button = screen.getByRole("button", { name: "Publish" })
    expect(publishButtonRef.current).toBe(button)
    expect(button.querySelector(".octicon-upload")).not.toBeNull()
    fireEvent.click(button)
    expect(onPublish).toHaveBeenCalledOnce()
  })

  it("shows the prototype title, compact metadata, and published status", () => {
    const onBuildDetails = vi.fn()
    const titleButtonRef = createRef<HTMLButtonElement>()
    render(
      <ThemeProvider colorMode="auto">
        <Toolbar
          {...props}
          onBuildDetails={onBuildDetails}
          titleButtonRef={titleButtonRef}
          prototypeName="Welcome prototype"
          state={{
            name: "Demo",
            stats: {
              branch: "prototype",
              repository: "github/replica",
              commitSha: "a".repeat(40),
              workingTree: "changed",
              urlHost: "localhost:3000",
            },
            publishStatus: { state: "published", detail: "Workflow completed." },
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("button", { name: "Welcome prototype" })).toHaveAttribute(
      "title",
      "Welcome prototype · github/replica · aaaaaaa · Uncommitted changes · localhost:3000",
    )
    expect(titleButtonRef.current).toBe(screen.getByRole("button", { name: "Welcome prototype" }))
    fireEvent.click(titleButtonRef.current!)
    expect(onBuildDetails).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Published" })).toHaveAccessibleDescription(
      "Latest changes already published",
    )
  })

  it.each([false, true])(
    "explains Published on hover and focus without dispatching (resolved: %s)",
    async (resolved) => {
      const onPublish = vi.fn()
      const publishButtonRef = createRef<HTMLButtonElement>()
      render(
        <ThemeProvider>
          <Toolbar
            {...props}
            onPublish={onPublish}
            publishButtonRef={publishButtonRef}
            state={{
              name: "Demo",
              stats: {},
              publishStatus: { state: "published", detail: "Workflow completed." },
            }}
            publication={
              resolved
                ? { kind: "ready", action: "none", label: "Published", detail: "Published." }
                : undefined
            }
          />
        </ThemeProvider>,
      )
      const button = screen.getByRole("button", { name: "Published" })
      expect(button).not.toBeDisabled()
      expect(publishButtonRef.current).toBe(button)
      expect(button).toHaveAccessibleDescription("Latest changes already published")
      const tooltip = document.getElementById(button.getAttribute("aria-describedby")!)!
      fireEvent.mouseEnter(button)
      await waitFor(() => expect(tooltip.matches(":popover-open")).toBe(true))
      tooltip.hidePopover()
      fireEvent.focus(button)
      expect(tooltip.matches(":popover-open")).toBe(true)
      fireEvent.click(button)
      expect(onPublish).not.toHaveBeenCalled()
    },
  )

  it("disables the button while the workflow is in progress", () => {
    render(
      <ThemeProvider colorMode="auto">
        <Toolbar
          {...props}
          state={{
            name: "Demo",
            stats: {},
            publishStatus: { state: "in_progress", detail: "Running" },
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("button", { name: "Publishing" })).toBeDisabled()
  })

  it("marks the action busy and disables it while publishing", () => {
    render(
      <ThemeProvider colorMode="auto">
        <Toolbar {...props} publishing state={null} />
      </ThemeProvider>,
    )
    expect(screen.getByRole("button", { name: "Publish" })).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Demo" })).toBeDisabled()
  })
})
