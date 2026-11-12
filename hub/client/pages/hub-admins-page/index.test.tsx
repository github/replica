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
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "atlas" } })
    await screen.findByRole("checkbox", { name: /Atlas Bloom/ })
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } })
    expect(await screen.findByText(addHubAdministratorsData.loadingLabel)).toBeInTheDocument()
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nova" } })
    fireEvent.click(await screen.findByRole("checkbox", { name: /Nova Pixel/ }))
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "luna" } })
    fireEvent.click(await screen.findByRole("checkbox", { name: /Luna Sketch/ }))
    const form = screen
      .getByRole("button", { name: "Add selected administrators" })
      .closest("form")!
    expect(new FormData(form).getAll("targetMembershipIds")).toEqual([
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
    ])
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zenith-wisp" } })
    fireEvent.click(await screen.findByRole("checkbox", { name: /Zenith Wisp/ }))
    expect(
      within(screen.getByRole("dialog", { name: "Add administrator" })).getAllByRole("list"),
    ).toHaveLength(1)
    expect(screen.getAllByRole("checkbox", { name: /Nova Pixel/ })).toHaveLength(1)
    expect(screen.getByRole("checkbox", { name: /Nova Pixel/ })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: /Luna Sketch/ })).toBeChecked()
    expect(new FormData(form).getAll("targetMembershipIds")).toEqual([
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
      "00000000-0000-4000-8000-000000000072",
    ])
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
    const membershipId = "22222222-2222-4222-8222-222222222222"
    const cursor = "opaque+/cursor=="
    render(
      <ThemeProvider>
        <HubAdminsPage
          onSearch={() => Promise.resolve({ users: [], more: false })}
          data={{
            ...data,
            administratorsLabel: "1 administrator",
            nextPath: `/settings/administrators?before=${encodeURIComponent(cursor)}`,
            users: [
              {
                id: membershipId,
                provider: "github",
                login: "mona",
                name: "Mona Lisa",
                identity: `GitHub membership ${membershipId}`,
                role: "Hub administrator",
                actionLabel: "Remove administrator",
                confirmationPath: `/settings/administrators/${membershipId}/revoke`,
              },
            ],
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByText("@mona")).toBeInTheDocument()
    expect(screen.getByText("GitHub membership 22222222-2222-4222-8222-222222222222")).toBeVisible()
    expect(screen.getByRole("heading", { name: "1 administrator" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Remove administrator" })).toHaveAttribute(
      "href",
      `/settings/administrators/${membershipId}/revoke`,
    )
    expect(screen.queryByRole("button", { name: "Remove administrator" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      `/settings/administrators?before=${encodeURIComponent(cursor)}`,
    )
  })

  it("shows provider and membership identity when candidate profile fields are unavailable", async () => {
    const membershipId = "22222222-2222-4222-8222-222222222222"
    render(
      <ThemeProvider>
        <HubAdminsPage
          data={data}
          onSearch={() =>
            Promise.resolve({
              users: [{ id: membershipId, provider: null, login: null, name: null }],
              more: false,
            })
          }
        />
      </ThemeProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Add administrator" }))

    const candidate = await screen.findByRole("checkbox", {
      name: `Profile unavailable, provider unavailable, membership ${membershipId}`,
    })
    expect(candidate).toBeVisible()
    expect(screen.getByText("Login unavailable")).toBeVisible()
    expect(screen.getByText(`provider unavailable · Membership ${membershipId}`)).toBeVisible()
  })

  it("shows explicit fallbacks and stable identity for an unavailable roster profile", () => {
    const membershipId = "22222222-2222-4222-8222-222222222222"
    render(
      <ThemeProvider>
        <HubAdminsPage
          onSearch={() => Promise.resolve({ users: [], more: false })}
          data={{
            ...data,
            administratorsLabel: "1 administrator",
            users: [
              {
                id: membershipId,
                provider: null,
                login: null,
                name: null,
                identity: `Provider profile unavailable · Membership ${membershipId}`,
                role: "Hub administrator",
                actionLabel: "Remove administrator",
                confirmationPath: `/settings/administrators/${membershipId}/revoke`,
              },
            ],
          }}
        />
      </ThemeProvider>,
    )

    expect(screen.getByText("Profile unavailable")).toBeVisible()
    expect(screen.getByText("Login unavailable")).toBeVisible()
    expect(
      screen.getByText(`Provider profile unavailable · Membership ${membershipId}`),
    ).toBeVisible()
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
