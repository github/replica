import { act, createEvent, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { defaultReviewFilters } from "@/storybook/fixtures/review/comments"
import { reviewCommentsCopy } from "@utils/review-comment/en"

import { ReviewCommentFilterControls } from "."

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => vi.unstubAllGlobals())

describe("ReviewCommentFilterControls()", () => {
  it("shows the leading search icon in the default search field", () => {
    const onFiltersChange = vi.fn()
    const { container } = render(
      <ReviewCommentFilterControls
        filters={defaultReviewFilters}
        participants={[]}
        showPins
        copy={reviewCommentsCopy}
        onFiltersChange={onFiltersChange}
        onShowPinsChange={vi.fn()}
      />,
    )

    const input = screen.getByRole("searchbox", { name: reviewCommentsCopy.searchLabel })
    expect(input).toHaveClass("review-comment-filter-controls__input")
    expect(
      container.querySelector(".review-comment-filter-controls__search-field svg"),
    ).not.toBeNull()
    expect(
      container.querySelector(".review-comment-filter-controls__search-field"),
    ).toContainElement(input)
    fireEvent.change(input, { target: { value: "spacing" } })
    expect(onFiltersChange).toHaveBeenCalledWith({
      ...defaultReviewFilters,
      search: "spacing",
    })
    expect(screen.getByRole("button", { name: reviewCommentsCopy.filterLabel })).toBeEnabled()
  })

  it("shows the compact search and framed filter controls", () => {
    const { container } = render(
      <ReviewCommentFilterControls
        compact
        filters={defaultReviewFilters}
        participants={[]}
        showPins
        copy={reviewCommentsCopy}
        onFiltersChange={vi.fn()}
        onShowPinsChange={vi.fn()}
      />,
    )

    expect(container.querySelector(".review-comment-filter-controls")).toHaveClass(
      "review-comment-filter-controls--compact",
    )
    expect(container.querySelector(".review-comment-filter-controls__search-field svg")).toBeNull()
    expect(
      screen.getByRole("button", { name: reviewCommentsCopy.filterLabel }).className,
    ).toContain("Button--secondary")
  })

  it("filters by participant using a small, single-select ActionMenu", () => {
    const onFiltersChange = vi.fn()
    const props = {
      participants: [
        { login: "mona", name: "Mona Lisa", avatarUrl: null },
        { login: "octocat", name: null, avatarUrl: null },
      ],
      showPins: true,
      copy: reviewCommentsCopy,
      onFiltersChange,
      onShowPinsChange: vi.fn(),
    }
    const { rerender } = render(
      <ReviewCommentFilterControls filters={defaultReviewFilters} {...props} />,
    )

    fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.filterLabel }))
    const trigger = screen.getByRole("button", {
      name: `${reviewCommentsCopy.participantFilterLabel}: ${reviewCommentsCopy.allParticipantsLabel}`,
    })
    expect(trigger).toHaveClass("review-comment-filter-controls__participant-trigger")
    expect(trigger.className).toContain("ActionMenu__button--small")
    fireEvent.click(trigger)

    expect(
      screen.getByRole("menu", { name: reviewCommentsCopy.participantFilterLabel }),
    ).toBeVisible()
    expect(
      screen.getByRole("menuitemradio", { name: reviewCommentsCopy.allParticipantsLabel }),
    ).toHaveAttribute("aria-checked", "true")
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Mona Lisa (@mona)" }))
    expect(onFiltersChange).toHaveBeenCalledWith({
      ...defaultReviewFilters,
      participant: "mona",
    })

    rerender(
      <ReviewCommentFilterControls
        filters={{ ...defaultReviewFilters, participant: "mona" }}
        {...props}
      />,
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: `${reviewCommentsCopy.participantFilterLabel}: Mona Lisa (@mona)`,
      }),
    )
    expect(screen.getByRole("menuitemradio", { name: "Mona Lisa (@mona)" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    fireEvent.keyDown(
      screen.getByRole("menuitemradio", { name: reviewCommentsCopy.allParticipantsLabel }),
      { key: "Enter" },
    )
    expect(onFiltersChange).toHaveBeenCalledWith({
      ...defaultReviewFilters,
      participant: null,
    })
  })

  it("selects participant options once with Space or Enter without scrolling", () => {
    const onFiltersChange = vi.fn()
    const props = {
      participants: [
        { login: "mona", name: "Mona Lisa", avatarUrl: null },
        { login: "octocat", name: null, avatarUrl: null },
      ],
      showPins: true,
      copy: reviewCommentsCopy,
      onFiltersChange,
      onShowPinsChange: vi.fn(),
    }
    const { rerender } = render(
      <ReviewCommentFilterControls filters={defaultReviewFilters} {...props} />,
    )
    fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.filterLabel }))
    fireEvent.click(
      screen.getByRole("button", {
        name: `${reviewCommentsCopy.participantFilterLabel}: ${reviewCommentsCopy.allParticipantsLabel}`,
      }),
    )

    const mona = screen.getByRole("menuitemradio", { name: "Mona Lisa (@mona)" })
    act(() => mona.focus())
    const space = createEvent.keyDown(mona, { key: " ", code: "Space", cancelable: true })
    fireEvent(mona, space)
    expect(space.defaultPrevented).toBe(true)
    expect(onFiltersChange).toHaveBeenCalledTimes(1)
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...defaultReviewFilters,
      participant: "mona",
    })

    rerender(
      <ReviewCommentFilterControls
        filters={{ ...defaultReviewFilters, participant: "mona" }}
        {...props}
      />,
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: `${reviewCommentsCopy.participantFilterLabel}: Mona Lisa (@mona)`,
      }),
    )
    const octocat = screen.getByRole("menuitemradio", { name: "@octocat" })
    act(() => octocat.focus())
    fireEvent.keyDown(octocat, { key: "Enter" })
    expect(onFiltersChange).toHaveBeenCalledTimes(2)
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...defaultReviewFilters,
      participant: "octocat",
    })

    rerender(
      <ReviewCommentFilterControls
        filters={{ ...defaultReviewFilters, participant: "octocat" }}
        {...props}
      />,
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: `${reviewCommentsCopy.participantFilterLabel}: @octocat`,
      }),
    )
    const all = screen.getByRole("menuitemradio", {
      name: reviewCommentsCopy.allParticipantsLabel,
    })
    act(() => all.focus())
    fireEvent.keyDown(all, { key: " ", code: "Space" })
    expect(onFiltersChange).toHaveBeenCalledTimes(3)
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...defaultReviewFilters,
      participant: null,
    })
  })

  it("marks the framed filter control active", () => {
    render(
      <ReviewCommentFilterControls
        compact
        filters={{ ...defaultReviewFilters, currentBuildOnly: true }}
        participants={[]}
        showPins
        copy={reviewCommentsCopy}
        onFiltersChange={vi.fn()}
        onShowPinsChange={vi.fn()}
      />,
    )

    const filterButton = screen.getByRole("button", { name: reviewCommentsCopy.filterLabel })
    expect(filterButton).toHaveClass("review-comment-filter-controls__button--active")
    expect(filterButton.className).toContain("Button--secondary")
    expect(filterButton).not.toHaveClass("hub-icon-button--invisible")
    expect(filterButton).toHaveAttribute("aria-expanded", "false")
  })

  it("updates read and mine filters without changing search or pin visibility", () => {
    const onFiltersChange = vi.fn()
    const { rerender } = render(
      <ReviewCommentFilterControls
        filters={defaultReviewFilters}
        participants={[]}
        showPins
        copy={reviewCommentsCopy}
        onFiltersChange={onFiltersChange}
        onShowPinsChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Filters" }))
    const unreadOnly = screen.getByRole("switch", { name: "Unread only" })
    expect(unreadOnly).not.toBeChecked()
    fireEvent.click(unreadOnly)
    expect(onFiltersChange).toHaveBeenCalledWith({ ...defaultReviewFilters, showRead: false })

    rerender(
      <ReviewCommentFilterControls
        filters={{ ...defaultReviewFilters, showRead: false }}
        participants={[]}
        showPins
        copy={reviewCommentsCopy}
        onFiltersChange={onFiltersChange}
        onShowPinsChange={vi.fn()}
      />,
    )
    expect(screen.getByRole("switch", { name: "Unread only" })).toBeChecked()
    fireEvent.click(screen.getByRole("switch", { name: "Only your threads" }))
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...defaultReviewFilters,
      showRead: false,
      onlyMine: true,
    })
    expect(screen.getByRole("button", { name: "Filters" })).toHaveClass(
      "review-comment-filter-controls__button--active",
    )
  })
})
