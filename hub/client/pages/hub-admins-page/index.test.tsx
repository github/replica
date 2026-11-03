import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  addHubAdministratorsData,
  hubAdministrationData,
} from "@/storybook/fixtures/hub-administration"

import { HubAdminsPage } from "."
import storyMeta, { Multiple } from "./stories"
import type { HubAdminsPageData } from "./types"

const data: HubAdminsPageData = {
  ...hubAdministrationData,
  pageTitle: "Hub administrators",
  emptyLabel: "No Hub administrators are available.",
  nextLabel: "Next page",
  nextPath: null,
  addLabel: "Add administrator",
  administratorsLabel: "0 administrators",
  addAdministrator: addHubAdministratorsData,
  users: [],
}

describe("HubAdminsPage()", () => {
  it("offers searchable fictional non-administrators in the populated page story", async () => {
    const storyData = Multiple.args!.data!
    const onSearch = storyMeta.args.onSearch
    const candidates = await onSearch("")
    expect(candidates.users).toHaveLength(50)
    expect(candidates.more).toBe(true)
    expect(candidates.users.map((user) => user.login)).toEqual(
      candidates.users.map((user) => user.login).sort(),
    )
    expect(
      candidates.users.every(
        (candidate) => !storyData.users.some((user) => user.id === candidate.id),
      ),
    ).toBe(true)
    expect((await onSearch("NOVA")).users.map((user) => user.login)).toEqual(["nova"])
    expect((await onSearch("luna")).users.map((user) => user.login)).toEqual(["luna"])
    expect(candidates.users.some((user) => user.login === "zenith-wisp")).toBe(false)
    expect((await onSearch(" Zenith Wisp ")).users.map((user) => user.login)).toEqual([
      "zenith-wisp",
    ])
    expect((await onSearch("zenith")).more).toBe(false)
    const allCandidates = (
      await Promise.all(
        [
          "comet",
          "doodle",
          "ember",
          "fable",
          "glitter",
          "nimbus",
          "orbit",
          "zenith",
          "nova",
          "luna",
          "atlas",
          "echo",
          "pip",
          "sage",
        ].map(onSearch),
      )
    ).flatMap((result) => result.users)
    expect(allCandidates).toHaveLength(70)
    expect(new Set(allCandidates.map((user) => user.id)).size).toBe(70)
    expect(new Set(allCandidates.map((user) => user.login)).size).toBe(70)
    render(
      <ThemeProvider>
        <HubAdminsPage data={storyData} onSearch={onSearch} />
      </ThemeProvider>,
    )
    expect(screen.getByRole("heading", { name: "2 administrators" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Add administrator" }))
    await screen.findByRole("checkbox", { name: "Atlas Bloom @atlas" })
    expect(screen.getByText(addHubAdministratorsData.moreLabel)).toBeInTheDocument()
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nova" } })
    fireEvent.click(await screen.findByRole("checkbox", { name: "Nova Pixel @nova" }))
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "luna" } })
    fireEvent.click(await screen.findByRole("checkbox", { name: "Luna Sketch @luna" }))
    const form = screen
      .getByRole("button", { name: "Add selected administrators" })
      .closest("form")!
    expect(new FormData(form).getAll("user_ids[]")).toEqual(["3", "4"])
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zenith-wisp" } })
    fireEvent.click(await screen.findByRole("checkbox", { name: "Zenith Wisp @zenith-wisp" }))
    expect(
      within(screen.getByRole("dialog", { name: "Add administrator" })).getAllByRole("list"),
    ).toHaveLength(1)
    expect(screen.getAllByRole("checkbox", { name: "Nova Pixel @nova" })).toHaveLength(1)
    expect(screen.getByRole("checkbox", { name: "Nova Pixel @nova" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Luna Sketch @luna" })).toBeChecked()
    expect(new FormData(form).getAll("user_ids[]")).toEqual(["3", "4", "72"])
  })

  it("explains an empty list without offering identity provisioning", () => {
    render(
      <ThemeProvider>
        <HubAdminsPage data={data} onSearch={() => Promise.resolve({ users: [], more: false })} />
      </ThemeProvider>,
    )
    expect(screen.getByText(data.emptyLabel)).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "0 administrators" })).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  })

  it("lists administrators and links to removal confirmation without mutating roles", () => {
    render(
      <ThemeProvider>
        <HubAdminsPage
          onSearch={() => Promise.resolve({ users: [], more: false })}
          data={{
            ...data,
            administratorsLabel: "1 administrator",
            nextPath: "/hub_admins?before=1",
            users: [
              {
                id: 2,
                login: "mona",
                name: "Mona Lisa",
                identity: "GitHub identity 1002 - Hub user 2",
                role: "Hub administrator",
                actionLabel: "Remove administrator",
                confirmationPath: "/hub_admins/2/edit",
              },
            ],
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByText("@mona")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "1 administrator" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Remove administrator" })).toHaveAttribute(
      "href",
      "/hub_admins/2/edit",
    )
    expect(screen.queryByRole("button", { name: "Remove administrator" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      "/hub_admins?before=1",
    )
  })

  it("shows a denial without exposing users or global audit navigation", () => {
    render(
      <ThemeProvider>
        <HubAdminsPage
          onSearch={() => Promise.resolve({ users: [], more: false })}
          data={{
            ...data,
            administrationWorkspace: null,
            auditPath: null,
            addAdministrator: null,
            alert: "No role changes were made.",
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("alert")).toHaveTextContent("No role changes were made.")
    expect(screen.queryByRole("link", { name: "Security audit" })).not.toBeInTheDocument()
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add administrator" })).not.toBeInTheDocument()
  })

  it("opens the add dialog and returns focus to its trigger on cancellation", () => {
    render(
      <ThemeProvider>
        <HubAdminsPage data={data} onSearch={() => Promise.resolve({ users: [], more: false })} />
      </ThemeProvider>,
    )
    const trigger = screen.getByRole("button", { name: "Add administrator" })
    fireEvent.click(trigger)
    expect(screen.getByRole("dialog", { name: "Add administrator" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
