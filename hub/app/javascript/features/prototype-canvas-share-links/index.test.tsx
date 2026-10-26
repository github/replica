import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ThemeProvider } from "@primer/react-brand"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { importedPrototype } from "@utils/resolve-prototype-publication/fixtures"
import { ShareLinksPage } from "."
import { shareCopy } from "@hooks/use-canvas-share-links/en"
import type { SharingState } from "@hooks/use-canvas-share-links/types"

const state: SharingState = {
  open: true,
  context: {
    target: "test",
    hubOrigin: "https://hub.example.com",
    repository: "github/prototype",
    branch: "prototype/welcome",
    prototype: { ...importedPrototype, canManageShareLinks: true },
  },
  links: [
    {
      id: 1,
      label: "Review",
      buildNumber: 2,
      expiresAt: null,
      url: "https://hub.example.com/share/12345678-1234-1234-1234-123456789abc",
      createdAt: "2026-10-05T07:00:00Z",
      createdBy: { login: "octocat", name: null },
    },
  ],
  loading: false,
  busy: false,
  stale: false,
  error: "",
  notice: "",
  created: null,
}

function fixture(display = state) {
  const props = {
    state: display,
    shareButtonRef: createRef<HTMLButtonElement>(),
    onClose: vi.fn(),
    onRefresh: vi.fn(),
    onCreate: vi.fn(() => Promise.resolve(true)),
    onDelete: vi.fn(() => Promise.resolve(true)),
    onOpen: vi.fn(),
    onAuthorize: vi.fn(),
  }
  const view = render(
    <ThemeProvider>
      <ShareLinksPage {...props} />
    </ThemeProvider>,
  )
  return { ...view, props }
}

describe("ShareLinksPage()", () => {
  it("warns about anyone-with-the-link access and sensitive or customer information before creation", () => {
    fixture()
    expect(screen.getByText(shareCopy.warning)).toHaveTextContent(
      "Anyone with a link can view its Build without signing in",
    )
    expect(screen.getByText(shareCopy.warning)).toHaveTextContent(
      "sensitive or customer information",
    )
    expect(screen.getByRole("button", { name: shareCopy.create })).toBeInTheDocument()
  })

  it.each<[string[], string]>([
    [["one_day", "seven_days"], "seven_days"],
    [["one_day"], "one_day"],
  ])("uses the deployment expiry choices %j and a permitted default", async (options, selected) => {
    const f = fixture({
      ...state,
      context: {
        ...state.context!,
        prototype: {
          ...state.context!.prototype,
          shareLinkExpirationOptions: options,
        },
      },
    })
    expect(screen.getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual(
      options,
    )
    expect(screen.getByRole("combobox", { name: shareCopy.expiry })).toHaveValue(selected)
    fireEvent.change(screen.getByRole("textbox", { name: "Label" }), {
      target: { value: "Bounded review" },
    })
    fireEvent.click(screen.getByRole("button", { name: shareCopy.create }))
    await waitFor(() =>
      expect(f.props.onCreate).toHaveBeenCalledExactlyOnceWith("Bounded review", selected),
    )
  })

  it("replaces a selected never expiry when a refreshed context disallows it", () => {
    const f = fixture()
    fireEvent.change(screen.getByRole("combobox", { name: shareCopy.expiry }), {
      target: { value: "never" },
    })
    expect(screen.getByRole("combobox", { name: shareCopy.expiry })).toHaveValue("never")
    f.rerender(
      <ThemeProvider>
        <ShareLinksPage
          {...f.props}
          state={{
            ...state,
            context: {
              ...state.context!,
              prototype: {
                ...state.context!.prototype,
                shareLinkExpirationOptions: ["one_day", "seven_days"],
              },
            },
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("combobox", { name: shareCopy.expiry })).toHaveValue("seven_days")
    expect(screen.queryByRole("option", { name: "Never" })).not.toBeInTheDocument()
  })

  it.each(["context", "denial"])(
    "keeps the internal link but hides public links when deployment sharing is disabled by %s",
    (source) => {
      fixture({
        ...state,
        stale: true,
        created: { ...state.links[0]!, id: 99, label: "Remembered public link" },
        sharingDisabled: source === "denial",
        context: {
          ...state.context!,
          prototype: {
            ...state.context!.prototype,
            publicSharingEnabled: source === "context" ? false : true,
          },
        },
      })
      expect(screen.getByRole("textbox", { name: shareCopy.internal })).toHaveValue(
        state.context!.prototype.build!.url,
      )
      expect(screen.getByRole("link", { name: shareCopy.internalOpen })).toBeInTheDocument()
      expect(screen.getByText(shareCopy.disabled)).toBeInTheDocument()
      expect(screen.queryByRole("textbox", { name: "Label" })).not.toBeInTheDocument()
      expect(
        screen.queryByRole("textbox", { name: "Review, Build #2 URL" }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("textbox", { name: "Remembered public link" }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "Open Review, Build #2" }),
      ).not.toBeInTheDocument()
    },
  )

  it("mutes older-Build link titles without muting current or newer Build links", () => {
    const f = fixture({
      ...state,
      context: {
        ...state.context!,
        prototype: {
          ...state.context!.prototype,
          build: { ...state.context!.prototype.build!, number: 2 },
        },
      },
      links: [
        { ...state.links[0]!, buildNumber: 1, label: "Older review" },
        { ...state.links[0]!, id: 2, buildNumber: 2, label: "Current review" },
        { ...state.links[0]!, id: 3, buildNumber: 3, label: "Newer review" },
      ],
    })
    expect(screen.getByRole("heading", { name: "Older review" }).closest("li")).toHaveClass(
      "canvas-share-link--older-build",
    )
    for (const name of ["Current review", "Newer review"]) {
      expect(screen.getByRole("heading", { name }).closest("li")).not.toHaveClass(
        "canvas-share-link--older-build",
      )
    }
    expect(screen.getByRole("button", { name: "Open Older review, Build #1" })).toBeEnabled()
    expect(f.props.onOpen).not.toHaveBeenCalled()
  })

  it("makes created-link Build labels bold without inventing details for real links", () => {
    fixture()
    expect(screen.getByText("Build 2", { selector: "strong" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Build 2" })).not.toBeInTheDocument()
    expect(screen.queryByText(/^Commit:/)).not.toBeInTheDocument()
  })

  it("offers hover and keyboard-focus details only when presentation metadata is provided", async () => {
    const f = fixture()
    f.rerender(
      <ThemeProvider>
        <ShareLinksPage
          {...f.props}
          buildDetails={{
            2: {
              commitSha: "b".repeat(40),
              author: "octocat",
              publishedAt: "2026-10-04T08:00:00Z",
            },
          }}
        />
      </ThemeProvider>,
    )
    const build = screen.getByRole("button", { name: "Build 2" })
    const tooltip = document.getElementById(build.getAttribute("aria-describedby")!)!
    expect(build.querySelector("strong")).toHaveTextContent("Build 2")
    expect(build).toHaveAccessibleDescription(/Commit: bbbbbbb\s+Author: @octocat\s+Published:/)
    fireEvent.mouseEnter(build)
    await waitFor(() => expect(tooltip.matches(":popover-open")).toBe(true))
    fireEvent.mouseLeave(build)
    await waitFor(() => expect(tooltip.matches(":popover-open")).toBe(false))
    fireEvent.focus(build)
    expect(tooltip.matches(":popover-open")).toBe(true)
    expect(tooltip).toHaveTextContent("Published:")
    expect(f.props.onOpen).not.toHaveBeenCalled()
    expect(f.props.onCreate).not.toHaveBeenCalled()
  })

  it("uses matching icon-only Open controls after the internal and public URLs", () => {
    const f = fixture()
    const internal = screen.getByRole("link", { name: shareCopy.internalOpen })
    const publicOpen = screen.getByRole("button", { name: "Open Review, Build #2" })
    for (const control of [internal, publicOpen]) {
      expect(control).toHaveClass("hub-icon-button")
      expect(control.querySelector(".octicon-link-external")).not.toBeNull()
      expect(control).toHaveAccessibleDescription(control.getAttribute("aria-label")!)
      expect(control.textContent).toBe("")
      expect(control.previousElementSibling).toHaveClass("copyable-text-input")
    }
    expect(internal).toHaveAttribute("href", state.context!.prototype.build!.url)
    expect(internal).toHaveAttribute("target", "_blank")
    expect(internal).toHaveAttribute("rel", "noopener")
    fireEvent.click(publicOpen)
    expect(f.props.onOpen).toHaveBeenCalledExactlyOnceWith(1)
  })

  it.each([false, undefined])(
    "offers internal review without public-sharing permission %s",
    async (permission) => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal("navigator", { clipboard: { writeText } })
      const f = fixture({
        ...state,
        context: {
          ...state.context!,
          prototype: {
            ...state.context!.prototype,
            canEdit: false,
            canManageShareLinks: permission,
          },
        },
      })
      const url = state.context!.prototype.build!.url
      expect(screen.getByRole("heading", { name: shareCopy.title })).toBeInTheDocument()
      expect(screen.getByRole("textbox", { name: shareCopy.internal })).toHaveValue(url)
      expect(screen.getByText(shareCopy.internalDescription)).toBeInTheDocument()
      expect(screen.getByRole("link", { name: shareCopy.internalOpen })).toHaveAttribute(
        "href",
        url,
      )
      fireEvent.click(screen.getByRole("button", { name: shareCopy.internalCopy }))
      await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(url))
      expect(screen.queryByRole("textbox", { name: "Label" })).not.toBeInTheDocument()
      expect(
        screen.queryByRole("textbox", { name: "Review, Build #2 URL" }),
      ).not.toBeInTheDocument()
      expect(f.props.onCreate).not.toHaveBeenCalled()
    },
  )

  it.each(["", "javascript:alert(1)", "https://another-hub.example.com/builds/1"])(
    "does not invent or expose an internal link for invalid URL %s",
    (url) => {
      fixture({
        ...state,
        context: {
          ...state.context!,
          prototype: {
            ...state.context!.prototype,
            build: { ...state.context!.prototype.build!, url },
          },
        },
      })
      expect(screen.getByText(shareCopy.internalUnavailable)).toBeInTheDocument()
      expect(screen.queryByRole("textbox", { name: shareCopy.internal })).not.toBeInTheDocument()
      expect(screen.queryByRole("link", { name: shareCopy.internalOpen })).not.toBeInTheDocument()
    },
  )

  it("decorates internal, public and recovery URLs consistently without changing stored links", async () => {
    const f = fixture()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const query = "rc.page.title=%22Configured%22"
    f.rerender(
      <ThemeProvider>
        <ShareLinksPage
          {...f.props}
          controlSettings={{ included: true, query, onChange: vi.fn() }}
        />
      </ThemeProvider>,
    )
    const link = state.links[0]!
    expect(screen.getByRole("textbox", { name: "Review, Build #2 URL" })).toHaveValue(
      `${link.url}?${query}`,
    )
    fireEvent.click(screen.getByRole("button", { name: "Open Review, Build #2" }))
    expect(f.props.onOpen).toHaveBeenCalledExactlyOnceWith(1, query)
    expect(state.links[0]!.url).toBe(link.url)
    const internalUrl = new URL(state.context!.prototype.build!.url)
    internalUrl.searchParams.set("rc.page.title", '"Configured"')
    expect(screen.getByRole("textbox", { name: shareCopy.internal })).toHaveValue(
      internalUrl.toString(),
    )
    expect(screen.getByRole("link", { name: shareCopy.internalOpen })).toHaveAttribute(
      "href",
      internalUrl.toString(),
    )
    fireEvent.click(screen.getByRole("button", { name: shareCopy.internalCopy }))
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(internalUrl.toString()))
    f.rerender(
      <ThemeProvider>
        <ShareLinksPage
          {...f.props}
          state={{ ...state, links: [], created: link, stale: true }}
          controlSettings={{ included: true, query, onChange: vi.fn() }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("textbox", { name: "Review" })).toHaveValue(`${link.url}?${query}`)
  })

  it("does not expose a plain link as a successful configured share when encoding fails", () => {
    const f = fixture()
    f.rerender(
      <ThemeProvider>
        <ShareLinksPage
          {...f.props}
          controlSettings={{
            included: true,
            query: "",
            blocked: true,
            error: "Settings exceed 8 KB.",
            onChange: vi.fn(),
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("alert")).toHaveTextContent("Settings exceed 8 KB.")
    expect(screen.queryByRole("button", { name: "Open Review, Build #2" })).not.toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: shareCopy.internal })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: shareCopy.internalCopy })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: shareCopy.internalOpen })).not.toBeInTheDocument()
  })

  it("disables the checkbox while its preference is being saved", () => {
    const f = fixture()
    const onChange = vi.fn()
    f.rerender(
      <ThemeProvider>
        <ShareLinksPage
          {...f.props}
          controlSettings={{ included: true, pending: true, onChange }}
        />
      </ThemeProvider>,
    )
    const checkbox = screen.getByRole("checkbox", { name: shareCopy.includeControlSettings })
    expect(checkbox).toBeDisabled()
    checkbox.click()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("keeps the settings opt-in below the page heading and above both sharing sections", () => {
    const f = fixture()
    expect(
      screen.queryByRole("checkbox", { name: shareCopy.includeControlSettings }),
    ).not.toBeInTheDocument()
    const onChange = vi.fn()
    f.rerender(
      <ThemeProvider>
        <ShareLinksPage
          {...f.props}
          currentCommit={"b".repeat(40)}
          controlSettings={{ included: true, onChange }}
        />
      </ThemeProvider>,
    )
    const checkbox = screen.getByRole("checkbox", { name: shareCopy.includeControlSettings })
    expect(screen.getByRole("alert")).toHaveTextContent(shareCopy.controlSettingsWarning)
    const form = screen.getByRole("textbox", { name: "Label" }).closest("form")!
    expect(form).not.toContainElement(checkbox)
    const heading = screen.getByRole("heading", { name: shareCopy.title })
    expect(heading.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    const internalHeading = screen.getByRole("heading", { name: shareCopy.internal })
    expect(
      checkbox.compareDocumentPosition(internalHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(f.container.querySelector(".hub-content-page-header__description")).toBeNull()
    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(f.props.onCreate).not.toHaveBeenCalled()
    expect(f.props.onOpen).not.toHaveBeenCalled()

    f.rerender(
      <ThemeProvider>
        <ShareLinksPage
          {...f.props}
          currentCommit={state.context!.prototype.build!.commitSha}
          controlSettings={{ included: true, onChange }}
        />
      </ThemeProvider>,
    )
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it.each(["reader", "sharing disabled"])(
    "keeps internal settings available for %s and removes them when unchecked",
    (mode) => {
      const f = fixture({
        ...state,
        context: {
          ...state.context!,
          prototype: {
            ...state.context!.prototype,
            canManageShareLinks: mode !== "reader",
            publicSharingEnabled: mode !== "sharing disabled",
          },
        },
      })
      const onChange = vi.fn()
      const query = "rc.page.enabled=false"
      for (const included of [true, false]) {
        f.rerender(
          <ThemeProvider>
            <ShareLinksPage {...f.props} controlSettings={{ included, query, onChange }} />
          </ThemeProvider>,
        )
        const url = new URL(state.context!.prototype.build!.url)
        if (included) url.searchParams.set("rc.page.enabled", "false")
        expect(screen.getByRole("textbox", { name: shareCopy.internal })).toHaveValue(
          url.toString(),
        )
        expect(screen.getByRole("link", { name: shareCopy.internalOpen })).toHaveAttribute(
          "href",
          url.toString(),
        )
        const checkbox = screen.getByRole("checkbox", { name: shareCopy.includeControlSettings })
        expect(checkbox).toBeEnabled()
        fireEvent.click(checkbox)
        expect(onChange).toHaveBeenLastCalledWith(!included)
        expect(screen.queryByRole("textbox", { name: "Label" })).not.toBeInTheDocument()
      }
    },
  )

  it("warns for uncommitted changes but not an unknown commit with no confirmed local changes", () => {
    const f = fixture()
    const settings = { included: true, onChange: vi.fn() }
    f.rerender(
      <ThemeProvider>
        <ShareLinksPage
          {...f.props}
          currentCommit={state.context!.prototype.build!.commitSha}
          hasLocalChanges
          controlSettings={settings}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("alert")).toHaveTextContent(shareCopy.controlSettingsWarning)
    f.rerender(
      <ThemeProvider>
        <ShareLinksPage {...f.props} controlSettings={settings} />
      </ThemeProvider>,
    )
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.queryByText(shareCopy.oldBuild)).not.toBeInTheDocument()
  })

  it("offers explicit GitHub verification without creating a link or opening a browser on mount", () => {
    const f = fixture({
      ...state,
      stale: true,
      error: "Fresh GitHub authorization is required. No changes were made.",
      authorization: {
        url: "https://hub.example.com/authorization/example",
        expiresAt: "2026-10-05T23:00:00Z",
      },
    })
    expect(f.props.onCreate).not.toHaveBeenCalled()
    expect(f.props.onAuthorize).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Create share link" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Verify with GitHub" }))
    expect(f.props.onAuthorize).toHaveBeenCalledOnce()
    expect(f.props.onCreate).not.toHaveBeenCalled()
  })

  it("shows a created URL recovery field only after loading fails and the URL is absent from the list", () => {
    const created = state.links[0]
    if (!created) throw new Error("The fixture requires a share link.")
    const f = fixture({ ...state, created, stale: true, loading: true })
    expect(screen.queryByRole("textbox", { name: created.label })).not.toBeInTheDocument()
    for (const display of [
      { ...state, created, stale: true, error: "Hub unavailable." },
      { ...state, created, links: [], stale: true, loading: true },
      { ...state, created, links: [] },
    ]) {
      f.rerender(
        <ThemeProvider>
          <ShareLinksPage {...f.props} state={display} />
        </ThemeProvider>,
      )
      expect(screen.queryByRole("textbox", { name: created.label })).not.toBeInTheDocument()
    }
    f.rerender(
      <ThemeProvider>
        <ShareLinksPage
          {...f.props}
          state={{ ...state, created, links: [], stale: true, error: "Hub unavailable." }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("textbox", { name: created.label })).toHaveValue(created.url)
  })

  it("explains public access, displays the creation Build separately from older link Builds, and makes no mutation on mount", () => {
    const f = fixture()
    expect(screen.getByRole("main", { name: shareCopy.title })).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByText(shareCopy.warning)).toBeInTheDocument()
    expect(screen.getByText("Build 1")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Build 1" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: shareCopy.internal })).toBeInTheDocument()
    const publicHeading = screen.getByRole("heading", { name: shareCopy.public })
    expect(publicHeading.closest(".canvas-share-public-header")).toContainElement(
      screen.getByText(shareCopy.warning),
    )
    expect(screen.getByText("Build 2").closest(".share-link-item__metadata")).toHaveTextContent(
      /Created by @octocat/,
    )
    expect(screen.getByRole("combobox", { name: "Expires after" })).toHaveValue("seven_days")
    expect(screen.getByRole("textbox", { name: "Label" })).toBeRequired()
    expect(screen.getByText(/^Label/)).toHaveTextContent("Label *")
    expect(screen.queryByText("Required. Up to 100 UTF-8 bytes.")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Load more links" })).not.toBeInTheDocument()
    expect(screen.getByText(/Never expires/)).toBeInTheDocument()
    expect(f.props.onCreate).not.toHaveBeenCalled()
    expect(f.props.onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole("heading", { name: shareCopy.title, level: 2 })).toHaveFocus()
    expect(
      screen
        .getByRole("heading", { name: shareCopy.title, level: 2 })
        .closest(".prototype-workspace__body"),
    ).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "Back to preview" }).closest(".hub-content-page-header"),
    ).not.toBeNull()
    expect(
      screen.getByRole("textbox", { name: "Label" }).closest(".share-links__form"),
    ).not.toBeNull()
  })

  it("omits prototype header chrome and uses an accessible icon-only close button", () => {
    const f = fixture()
    expect(f.container.querySelector(".review-shell__header")).toBeNull()
    expect(screen.queryByText("Welcome")).not.toBeInTheDocument()
    expect(screen.queryByText("v1")).not.toBeInTheDocument()
    const close = screen.getByRole("button", { name: "Back to preview" })
    expect(close).toHaveClass("hub-icon-button--invisible")
    expect(close).not.toHaveTextContent("Back to preview")
    expect(close.querySelector(".octicon-x")).not.toBeNull()
    act(() => close.focus())
    expect(close).toHaveFocus()
    fireEvent.click(close)
    expect(f.props.onClose).toHaveBeenCalledOnce()
  })

  it("requires a byte-valid label and an explicit submit, and offers all expiry choices", async () => {
    const f = fixture()
    const label = screen.getByRole("textbox", { name: "Label" })
    fireEvent.change(label, { target: { value: "é".repeat(51) } })
    fireEvent.submit(label.closest("form")!)
    expect(await screen.findByRole("alert")).toHaveTextContent(/100 UTF-8 bytes/)
    expect(f.props.onCreate).not.toHaveBeenCalled()
    fireEvent.change(label, { target: { value: "Review" } })
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "never" } })
    fireEvent.click(screen.getByRole("button", { name: "Create share link" }))
    expect(f.props.onCreate).toHaveBeenCalledExactlyOnceWith("Review", "never")
    expect(screen.getAllByRole("option")).toHaveLength(4)
  })

  it("does not delete on cancellation and deletes only after confirmation", async () => {
    const f = fixture()
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole("button", { name: "Delete Review, Build #2" }))
    expect(f.props.onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Delete Review, Build #2" }))
    await waitFor(() => expect(f.props.onDelete).toHaveBeenCalledExactlyOnceWith(1))
    expect(confirm).toHaveBeenCalledWith(shareCopy.deletePrompt("Review"))
  })

  it("announces copying and retains a selectable URL on clipboard failure", async () => {
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Denied"))
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    fixture()
    fireEvent.click(screen.getByRole("button", { name: "Copy Review, Build #2" }))
    await screen.findByRole("button", { name: "Link copied" })
    expect(screen.getByText("Link copied")).toHaveAttribute("aria-live", "polite")
    fireEvent.click(screen.getByRole("button", { name: "Link copied" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not copy/)
    expect(screen.getByRole("textbox", { name: "Review, Build #2 URL" })).toHaveAttribute(
      "readonly",
    )
  })

  it("uses explicit Open and Back without modal dismissal", () => {
    const f = fixture()
    fireEvent.click(screen.getByRole("button", { name: "Open Review, Build #2" }))
    expect(f.props.onOpen).toHaveBeenCalledExactlyOnceWith(1)
    fireEvent.keyDown(screen.getByRole("main"), { key: "Escape" })
    expect(f.props.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Back to preview" }))
    expect(f.props.onClose).toHaveBeenCalledOnce()
  })

  it("distinguishes no Build and insufficient permission from an empty list", () => {
    const f = fixture({
      ...state,
      links: [],
      context: {
        ...state.context!,
        prototype: {
          ...importedPrototype,
          published: false,
          build: null,
          canManageShareLinks: true,
        },
      },
    })
    expect(screen.getByText(shareCopy.noBuild)).toBeInTheDocument()
    expect(screen.getByText(shareCopy.empty)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Create share link" })).not.toBeInTheDocument()
    f.rerender(
      <ThemeProvider>
        <ShareLinksPage
          {...f.props}
          state={{
            ...state,
            context: {
              ...state.context!,
              prototype: { ...importedPrototype, canManageShareLinks: false },
            },
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByText(shareCopy.denied)).toBeInTheDocument()
    expect(screen.queryByText("Review")).not.toBeInTheDocument()
  })

  it("disables creation/open/deletion during stale or busy states and does not claim an empty success", () => {
    const f = fixture({ ...state, links: [], stale: true, error: "Hub unavailable." })
    expect(screen.getByRole("button", { name: "Create share link" })).toBeDisabled()
    expect(screen.getByRole("alert")).toHaveTextContent("Hub unavailable.")
    expect(screen.queryByText(shareCopy.empty)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Refresh links" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Refresh links" }))
    expect(f.props.onRefresh).toHaveBeenCalledOnce()
    expect(f.props.onCreate).not.toHaveBeenCalled()
  })
})
