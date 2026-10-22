import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { prototypeListing } from "@/storybook/fixtures/prototype-listing"
import type { PrototypeListingControls } from "@utils/prototype-listing/types"

import { PrototypeAuthorFilter } from "."

describe("PrototypeAuthorFilter()", () => {
  it("pins Me first and supports selecting and clearing an author with the keyboard", () => {
    const onChange = vi.fn()
    const onSearch = vi.fn(() => Promise.resolve({ authors: [], nextCursor: null }))
    const { rerender } = render(
      <PrototypeAuthorFilter listing={prototypeListing} onChange={onChange} onSearch={onSearch} />,
    )
    const trigger = screen.getByRole("button", { name: "Author: All authors" })
    fireEvent.click(trigger)
    const menu = screen.getByRole("menu", { name: "Author" })
    expect(within(menu).getAllByRole("menuitemradio")[0]).toHaveTextContent("Me")
    expect(within(menu).getByRole("searchbox")).toHaveFocus()
    expect(
      within(menu).getByRole("menuitemradio", { name: "All authors", checked: true }),
    ).toBeInTheDocument()
    fireEvent.keyDown(within(menu).getByRole("searchbox"), { key: "ArrowDown" })
    const me = within(menu).getByRole("menuitemradio", { name: "Me" })
    expect(me).toHaveFocus()
    fireEvent.keyDown(me, { key: " " })
    expect(onChange).toHaveBeenCalledExactlyOnceWith("me")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    rerender(
      <PrototypeAuthorFilter
        listing={{ ...prototypeListing, author: "me", authorLabel: "Me" }}
        onChange={onChange}
        onSearch={onSearch}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Author: Me" }))
    const all = screen.getByRole("menuitemradio", { name: "All authors", checked: false })
    all.focus()
    fireEvent.keyDown(all, { key: "Enter" })
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenLastCalledWith("")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("replaces author pages and ignores stale results after the search changes", async () => {
    let finishOldSearch!: (
      results: Awaited<ReturnType<PrototypeListingControls["loadAuthors"]>>,
    ) => void
    const oldSearch = new Promise<Awaited<ReturnType<PrototypeListingControls["loadAuthors"]>>>(
      (resolve) => {
        finishOldSearch = resolve
      },
    )
    const onSearch = vi
      .fn<PrototypeListingControls["loadAuthors"]>(() =>
        Promise.resolve({
          authors: [{ id: "2", login: "mona", name: null, avatarUrl: null }],
          nextCursor: "next",
        }),
      )
      .mockResolvedValueOnce({
        authors: [{ id: "1", login: "octocat", name: null, avatarUrl: null }],
        nextCursor: "next",
      })
    render(
      <PrototypeAuthorFilter listing={prototypeListing} onChange={vi.fn()} onSearch={onSearch} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Author: All authors" }))
    expect(await screen.findByRole("menuitemradio", { name: "@octocat" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "More" }))
    expect(await screen.findByRole("menuitemradio", { name: "@mona" })).toBeInTheDocument()
    expect(screen.queryByRole("menuitemradio", { name: "@octocat" })).not.toBeInTheDocument()
    onSearch.mockReturnValueOnce(oldSearch)
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "old" } })
    await waitFor(() =>
      expect(onSearch).toHaveBeenLastCalledWith("old", null, expect.any(AbortSignal)),
    )
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "mona" } })
    await waitFor(() =>
      expect(onSearch).toHaveBeenLastCalledWith("mona", null, expect.any(AbortSignal)),
    )
    expect(await screen.findByRole("menuitemradio", { name: "@mona" })).toBeInTheDocument()
    await act(async () => {
      finishOldSearch({
        authors: [{ id: "3", login: "outdated", name: null, avatarUrl: null }],
        nextCursor: null,
      })
      await oldSearch
    })
    expect(screen.queryByRole("menuitemradio", { name: "@outdated" })).not.toBeInTheDocument()
    expect(screen.getByRole("menuitemradio", { name: "@mona" })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" })
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })

  it("reports lookup failures and retries without losing the pinned Me option", async () => {
    const onSearch = vi
      .fn(() => Promise.resolve({ authors: [], nextCursor: null }))
      .mockRejectedValueOnce(new Error("Unavailable"))
    render(
      <PrototypeAuthorFilter listing={prototypeListing} onChange={vi.fn()} onSearch={onSearch} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Author: All authors" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(prototypeListing.copy.authorsFailed)
    expect(screen.getByRole("menuitemradio", { name: "Me" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByRole("status")).toHaveTextContent(prototypeListing.copy.loading)
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument())
    expect(screen.getByRole("menuitemradio", { name: "Me" })).toBeInTheDocument()
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } })
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No matching authors"))
  })
})
