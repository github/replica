import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { addHubAdministratorsData } from "@/storybook/fixtures/hub-administration"

import { AddHubAdministrators } from "."
import type { HubAdministratorSearchResults } from "./types"

describe("AddHubAdministrators()", () => {
  it("tracks independent dialog and result fades as searches, selections and viewport size change", async () => {
    const observers: { callback: ResizeObserverCallback; targets: Element[] }[] = []
    const disconnect = vi.fn()
    vi.stubGlobal(
      "ResizeObserver",
      class {
        record: (typeof observers)[number]
        constructor(callback: ResizeObserverCallback) {
          this.record = { callback, targets: [] }
          observers.push(this.record)
        }
        observe(target: Element) {
          this.record.targets.push(target)
        }
        disconnect = disconnect
      },
    )
    let bodyHeight = 100
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("add-hub-administrators__body") ? bodyHeight : 60
    })
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("add-hub-administrators__body")
        ? 220
        : this.querySelectorAll("li").length * 40
    })
    const users = [
      { id: 1, login: "octocat", name: "The Octocat" },
      { id: 2, login: "mona", name: "Mona Lisa" },
    ]
    const { container, unmount } = render(
      <ThemeProvider>
        <AddHubAdministrators
          data={addHubAdministratorsData}
          authenticityToken="token"
          onSearch={(query) => Promise.resolve({ users: query ? [users[1]!] : users, more: false })}
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    )
    const body = container.querySelector<HTMLElement>(".add-hub-administrators__body")!
    const results = container.querySelector<HTMLElement>(".add-hub-administrators__results")!
    function resize() {
      for (const observer of observers) observer.callback([], {} as ResizeObserver)
    }
    expect(body).toHaveAttribute("data-scroll-end")
    expect(results).not.toHaveAttribute("data-scroll-end")
    expect(observers.map((observer) => observer.targets)).toEqual([
      [body, body.firstElementChild],
      [results, results.firstElementChild],
    ])
    fireEvent.click(await screen.findByRole("checkbox", { name: "The Octocat @octocat" }))
    resize()
    expect(results).toHaveAttribute("data-scroll-end")
    fireEvent.scroll(results, { target: { scrollTop: 20 } })
    expect(results).toHaveAttribute("data-scroll-start")
    expect(results).not.toHaveAttribute("data-scroll-end")
    expect(body).not.toHaveAttribute("data-scroll-start")
    expect(body).toHaveAttribute("data-scroll-end")

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "mona" } })
    resize()
    expect(results).not.toHaveAttribute("data-scroll-start")
    expect(results).not.toHaveAttribute("data-scroll-end")
    await screen.findByRole("checkbox", { name: "Mona Lisa @mona" })
    resize()
    expect(results).toHaveAttribute("data-scroll-start")
    fireEvent.click(screen.getByRole("checkbox", { name: "The Octocat @octocat" }))
    resize()
    expect(results).not.toHaveAttribute("data-scroll-start")
    expect(results).not.toHaveAttribute("data-scroll-end")

    fireEvent.scroll(body, { target: { scrollTop: 120 } })
    expect(body).toHaveAttribute("data-scroll-start")
    expect(body).not.toHaveAttribute("data-scroll-end")
    bodyHeight = 300
    resize()
    expect(body).not.toHaveAttribute("data-scroll-start")
    expect(body).not.toHaveAttribute("data-scroll-end")
    unmount()
    expect(disconnect).toHaveBeenCalledTimes(2)
  })

  it("searches on opening and requires selection and deliberate confirmation", async () => {
    const onSearch = vi.fn(() =>
      Promise.resolve({
        users: [
          { id: 1, login: "octocat", name: "The Octocat" },
          { id: 2, login: "mona", name: "Mona Lisa" },
        ],
        more: false,
      }),
    )
    const { container } = render(
      <ThemeProvider>
        <AddHubAdministrators
          data={addHubAdministratorsData}
          authenticityToken="csrf-token"
          onSearch={onSearch}
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("searchbox", { name: "Search Hub users" })).toHaveFocus()
    expect(screen.queryByText(/^A role change requires GitHub/)).not.toBeInTheDocument()
    expect(screen.getByRole("searchbox")).toHaveAttribute(
      "placeholder",
      addHubAdministratorsData.searchPlaceholder,
    )
    expect(screen.queryByText("Select up to 50 users at a time.")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("checkbox", { name: addHubAdministratorsData.confirmLabel }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add selected administrators" })).toBeDisabled()
    fireEvent.click(await screen.findByRole("checkbox", { name: "Mona Lisa @mona" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "The Octocat @octocat" }))
    const submit = screen.getByRole("button", { name: "Add selected administrators" })
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByRole("checkbox", { name: addHubAdministratorsData.confirmLabel }))
    expect(submit).toBeEnabled()
    expect(container.querySelector('input[name="authenticity_token"]')).toHaveValue("csrf-token")
    expect(
      Array.from(container.querySelectorAll<HTMLInputElement>('input[name="user_ids[]"]')).map(
        (input) => input.value,
      ),
    ).toEqual(["2", "1"])
    expect(container.querySelector("form")).toHaveAttribute("action", "/hub_admins")
    expect(container.querySelector("form")).toHaveAttribute("method", "post")
    expect(onSearch).toHaveBeenCalledWith("")
    expect(screen.getAllByRole("list")).toHaveLength(1)
    expect(screen.getAllByRole("checkbox", { name: "Mona Lisa @mona" })).toHaveLength(1)
    expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "The Octocat@octocat",
      "Mona Lisa@mona",
    ])
    expect(screen.queryByRole("region", { name: "Selected users" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox", { name: "Mona Lisa @mona" }))
    expect(submit).toBeDisabled()
    expect(
      screen.getByRole("checkbox", { name: addHubAdministratorsData.confirmLabel }),
    ).not.toBeChecked()
    fireEvent.click(screen.getByRole("checkbox", { name: "The Octocat @octocat" }))
    expect(
      screen.queryByRole("checkbox", { name: addHubAdministratorsData.confirmLabel }),
    ).not.toBeInTheDocument()
    expect(submit).toBeDisabled()
  })

  it("retains selected accounts across searches and shows bounded result guidance", async () => {
    const onSearch = vi.fn((query: string) =>
      Promise.resolve({
        users: query
          ? [{ id: 2, login: "mona", name: "Mona Lisa" }]
          : [{ id: 1, login: "octocat", name: "The Octocat" }],
        more: !query,
      }),
    )
    const { container } = render(
      <ThemeProvider>
        <AddHubAdministrators
          data={addHubAdministratorsData}
          authenticityToken="token"
          onSearch={onSearch}
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    )
    fireEvent.click(await screen.findByRole("checkbox", { name: "The Octocat @octocat" }))
    expect(screen.getByText(addHubAdministratorsData.moreLabel)).toBeInTheDocument()
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "mona" } })
    expect(screen.getByText(addHubAdministratorsData.loadingLabel)).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "The Octocat @octocat" })).toBeChecked()
    fireEvent.click(await screen.findByRole("checkbox", { name: "Mona Lisa @mona" }))
    expect(container.querySelectorAll('input[name="user_ids[]"]')).toHaveLength(2)
    expect(onSearch).toHaveBeenLastCalledWith("mona")
    expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "The Octocat@octocat",
      "Mona Lisa@mona",
    ])
    fireEvent.click(screen.getByRole("checkbox", { name: addHubAdministratorsData.confirmLabel }))
    fireEvent.click(screen.getByRole("checkbox", { name: "The Octocat @octocat" }))
    expect(
      screen.getByRole("checkbox", { name: addHubAdministratorsData.confirmLabel }),
    ).not.toBeChecked()
    expect(screen.queryByRole("checkbox", { name: "The Octocat @octocat" })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } })
    await screen.findByRole("checkbox", { name: "The Octocat @octocat" })
    expect(screen.getAllByRole("checkbox", { name: "Mona Lisa @mona" })).toHaveLength(1)
    expect(screen.getByRole("checkbox", { name: "Mona Lisa @mona" })).toBeChecked()
  })

  it("reports search failures explicitly and retries without losing selections", async () => {
    const onSearch = vi
      .fn()
      .mockResolvedValueOnce({ users: [{ id: 2, login: "mona", name: "Mona Lisa" }], more: false })
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValueOnce({ users: [], more: false })
    render(
      <ThemeProvider>
        <AddHubAdministrators
          data={addHubAdministratorsData}
          authenticityToken="token"
          onSearch={onSearch}
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    )
    fireEvent.click(await screen.findByRole("checkbox", { name: "Mona Lisa @mona" }))
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "other" } })
    expect(await screen.findByRole("alert")).toHaveTextContent(
      addHubAdministratorsData.searchFailedLabel,
    )
    expect(screen.getByRole("checkbox", { name: "Mona Lisa @mona" })).toBeChecked()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByText(addHubAdministratorsData.emptyLabel)).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "Mona Lisa @mona" })).toBeChecked()
  })

  it("caps selections at 50 across searches while allowing deselection", async () => {
    const users = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      login: `pixel-${index}`,
      name: `Pixel Sprite ${index}`,
    }))
    render(
      <ThemeProvider>
        <AddHubAdministrators
          data={addHubAdministratorsData}
          authenticityToken="token"
          onSearch={(query) =>
            Promise.resolve({
              users: query ? [{ id: 51, login: "nova", name: "Nova Pixel" }] : users,
              more: !query,
            })
          }
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    )
    await screen.findByRole("checkbox", { name: "Pixel Sprite 0 @pixel-0" })
    for (const checkbox of screen.getAllByRole("checkbox")) {
      fireEvent.click(checkbox)
    }
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nova" } })
    const nova = await screen.findByRole("checkbox", { name: "Nova Pixel @nova" })
    expect(nova).toBeDisabled()
    const form = screen
      .getByRole("button", { name: "Add selected administrators" })
      .closest("form")!
    expect(new FormData(form).getAll("user_ids[]")).toHaveLength(50)
    const selected = screen.getByRole("checkbox", { name: "Pixel Sprite 0 @pixel-0" })
    expect(selected).toBeEnabled()
    fireEvent.click(selected)
    expect(nova).toBeEnabled()
    fireEvent.click(nova)
    expect(new FormData(form).getAll("user_ids[]")).toHaveLength(50)
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(50)
    expect(screen.getAllByRole("list")).toHaveLength(1)
  })

  it("ignores superseded search responses", async () => {
    let finish: ((results: HubAdministratorSearchResults) => void) | undefined
    const onSearch = vi.fn((query: string) =>
      query
        ? Promise.resolve({ users: [], more: false })
        : new Promise<HubAdministratorSearchResults>((resolve) => {
            finish = resolve
          }),
    )
    render(
      <ThemeProvider>
        <AddHubAdministrators
          data={addHubAdministratorsData}
          authenticityToken="token"
          onSearch={onSearch}
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    )
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith(""))
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } })
    expect(await screen.findByText(addHubAdministratorsData.emptyLabel)).toBeInTheDocument()
    finish?.({ users: [{ id: 2, login: "mona", name: "Mona Lisa" }], more: false })
    await waitFor(() => expect(screen.queryByText("@mona")).not.toBeInTheDocument())
  })

  it("prevents submission without confirmation and duplicate submissions", async () => {
    render(
      <ThemeProvider>
        <AddHubAdministrators
          data={addHubAdministratorsData}
          authenticityToken="token"
          onSearch={() =>
            Promise.resolve({
              users: [{ id: 2, login: "mona", name: "Mona Lisa" }],
              more: false,
            })
          }
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    )
    const form = screen
      .getByRole("button", { name: "Add selected administrators" })
      .closest("form")!
    expect(fireEvent.submit(form)).toBe(false)
    fireEvent.click(await screen.findByRole("checkbox", { name: "Mona Lisa @mona" }))
    expect(fireEvent.submit(form)).toBe(false)
    fireEvent.click(screen.getByRole("checkbox", { name: addHubAdministratorsData.confirmLabel }))
    expect(fireEvent.submit(form)).toBe(true)
    expect(new FormData(form).get("confirmed")).toBe("1")
    expect(new FormData(form).getAll("user_ids[]")).toEqual(["2"])
    expect(screen.getByRole("button", { name: "Add selected administrators" })).toBeDisabled()
    expect(fireEvent.submit(form)).toBe(false)
  })
})
