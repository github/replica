import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { expect, it } from "vitest"

import {
  importedPrototype,
  publicationHub,
  publicationState,
} from "@utils/resolve-prototype-publication/fixtures"
import { publishPreparation } from "@utils/resolve-prototype-publication/fixtures"
import { sharingFixture } from "./sharing-fixture"
import { App } from ".."

it("offers only an explicit committed publication when inspection and retry fail despite saved permission", async () => {
  const { fixture, fetch } = sharingFixture()
  fixture.remember = true
  const preparation = publishPreparation(fixture.state, true)
  const respond = fetch.getMockImplementation()!
  let checks = 0
  fetch.mockImplementation((path, options) =>
    path === "/api/publish/prepare"
      ? Promise.resolve(
          Response.json({
            target: preparation.target,
            workingTree: "unavailable",
            workingTreeError: ++checks === 1 ? "Git status timed out." : "Git status still failed.",
            remember: true,
          }),
        )
      : respond(path, options),
  )
  const view = render(
    <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
  )
  fireEvent.click(await screen.findByRole("button", { name: "Publish" }))
  const dialog = await screen.findByRole("dialog", { name: "Could not check local changes" })
  expect(within(dialog).getByText("Git status timed out.")).toBeVisible()
  expect(
    within(dialog).queryByRole("button", { name: "Commit changes & publish" }),
  ).not.toBeInTheDocument()
  expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument()
  expect(
    within(dialog).getByRole("button", { name: "Publish committed version only" }),
  ).toBeEnabled()
  expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
  fireEvent.click(within(dialog).getByRole("button", { name: "Retry check" }))
  await within(dialog).findByText("Git status still failed.")
  expect(checks).toBe(2)
  expect(within(dialog).getByRole("button", { name: "Retry check" })).toBeEnabled()
  expect(
    within(dialog).queryByRole("button", { name: "Commit changes & publish" }),
  ).not.toBeInTheDocument()
  expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument()
  expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
  fireEvent.click(within(dialog).getByRole("button", { name: "Publish committed version only" }))
  await waitFor(() =>
    expect(fetch.mock.calls.filter(([path]) => path === "/api/publish")).toHaveLength(1),
  )
  const body = fetch.mock.calls.find(([path]) => path === "/api/publish")?.[1]?.body
  if (typeof body !== "string") throw new Error("Expected a JSON publish request.")
  expect(JSON.parse(body)).toEqual({
    target: preparation.target,
    workingTree: "unavailable",
    mode: "committed-only",
    remember: false,
  })
  expect(fetch.mock.calls.some(([path]) => path === "/api/publish/preference")).toBe(false)
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  view.unmount()
})

it.each(["clean", "changed"] as const)(
  "rechecks unavailable changes and restores the normal %s publication flow",
  async (workingTree) => {
    const { fixture, fetch } = sharingFixture()
    const preparation = publishPreparation(fixture.state)
    const respond = fetch.getMockImplementation()!
    let checks = 0
    fetch.mockImplementation((path, options) =>
      path === "/api/publish/prepare"
        ? Promise.resolve(
            Response.json(
              ++checks === 1
                ? {
                    target: preparation.target,
                    workingTree: "unavailable",
                    workingTreeError: "Git status timed out.",
                    remember: false,
                  }
                : {
                    ...preparation,
                    workingTree,
                    changes: {
                      files: {
                        paths: workingTree === "changed" ? ["src/recovered.tsx"] : [],
                        total: workingTree === "changed" ? 1 : 0,
                      },
                      localSkills: { paths: [], total: 0 },
                    },
                  },
            ),
          )
        : respond(path, options),
    )
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    fireEvent.click(await screen.findByRole("button", { name: "Publish" }))
    const unavailable = await screen.findByRole("dialog", {
      name: "Could not check local changes",
    })
    fireEvent.click(within(unavailable).getByRole("button", { name: "Retry check" }))
    if (workingTree === "changed") {
      const changed = await screen.findByRole("dialog", { name: "Publish uncommitted changes?" })
      expect(within(changed).getByText("src/recovered.tsx")).toBeVisible()
      expect(
        within(changed).getByRole("button", { name: "Commit changes & publish" }),
      ).toBeEnabled()
      expect(within(changed).getByRole("checkbox")).toBeEnabled()
      expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
      fireEvent.click(within(changed).getByRole("button", { name: "Commit changes & publish" }))
    }
    await waitFor(() =>
      expect(fetch.mock.calls.filter(([path]) => path === "/api/publish")).toHaveLength(1),
    )
    expect(checks).toBe(2)
    const body = fetch.mock.calls.find(([path]) => path === "/api/publish")?.[1]?.body
    if (typeof body !== "string") throw new Error("Expected a JSON publish request.")
    expect(JSON.parse(body)).toMatchObject({
      target: preparation.target,
      workingTree,
      mode: workingTree === "changed" ? "commit-changes" : "committed-only",
    })
    expect(JSON.parse(body)).not.toMatchObject({ remember: true })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    view.unmount()
  },
)

it("closes an unavailable check without publishing or granting commit permission", async () => {
  const { fixture, fetch } = sharingFixture()
  const respond = fetch.getMockImplementation()!
  fetch.mockImplementation((path, options) =>
    path === "/api/publish/prepare"
      ? Promise.resolve(
          Response.json({
            target: publishPreparation(fixture.state).target,
            workingTree: "unavailable",
            workingTreeError: "Git status failed.",
            remember: false,
          }),
        )
      : respond(path, options),
  )
  const view = render(
    <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
  )
  const publish = await screen.findByRole("button", { name: "Publish" })
  fireEvent.click(publish)
  const dialog = await screen.findByRole("dialog", { name: "Could not check local changes" })
  fireEvent.click(within(dialog).getByRole("button", { name: "Close publishing dialog" }))
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(publish).toHaveFocus()
  expect(
    fetch.mock.calls.some(([path]) => ["/api/publish", "/api/publish/preference"].includes(path)),
  ).toBe(false)
  view.unmount()
})

it.each(["commit-changes", "committed-only"] as const)(
  "asks in a dialog on Publish and dispatches the selected %s mode",
  async (mode) => {
    const { fixture, fetch } = sharingFixture()
    fixture.state.stats.workingTree = "changed"
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    const publish = await screen.findByRole("button", { name: "Publish" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(fetch.mock.calls.some(([path]) => path === "/api/publish/prepare")).toBe(false)
    const frame = screen.getByTitle("Demo prototype")
    fireEvent.click(publish)
    const dialog = await screen.findByRole("dialog", { name: "Publish uncommitted changes?" })
    expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
    expect(
      within(dialog).getByText(
        "Do you want to commit changes before publishing? Publishing the committed version only excludes your local uncommitted edits.",
      ),
    ).toBeVisible()
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/On this computer only/)).not.toBeInTheDocument()
    const remember = within(dialog).getByRole("checkbox", {
      name: "Always commit changes before publishing for this prototype",
    })
    expect(remember).not.toBeChecked()
    fireEvent.click(remember)
    fireEvent.click(
      within(dialog).getByRole("button", {
        name:
          mode === "commit-changes" ? "Commit changes & publish" : "Publish committed version only",
      }),
    )
    await waitFor(() =>
      expect(fetch.mock.calls.filter(([path]) => path === "/api/publish")).toHaveLength(1),
    )
    const serialized = fetch.mock.calls.find(([path]) => path === "/api/publish")?.[1]?.body
    if (typeof serialized !== "string") throw new Error("Expected a JSON publish request.")
    expect(JSON.parse(serialized)).toEqual({
      target: publishPreparation(fixture.state).target,
      workingTree: "changed",
      mode,
      remember: mode === "commit-changes",
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.getByTitle("Demo prototype")).toBe(frame)
    view.unmount()
  },
)

it("closes without dispatching or remembering permission and restores Publish focus", async () => {
  const { fixture, fetch } = sharingFixture()
  fixture.state.stats.workingTree = "changed"
  const view = render(
    <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
  )
  const publish = await screen.findByRole("button", { name: "Publish" })
  fireEvent.click(publish)
  const dialog = await screen.findByRole("dialog", { name: "Publish uncommitted changes?" })
  fireEvent.click(within(dialog).getByRole("checkbox"))
  fireEvent.click(within(dialog).getByRole("button", { name: "Close publishing dialog" }))
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(publish).toHaveFocus()
  expect(
    fetch.mock.calls.some(([path]) => ["/api/publish", "/api/publish/preference"].includes(path)),
  ).toBe(false)
  view.unmount()
})

it("coordinates the publishing choice with sharing readiness without stacking dialogs", async () => {
  const { fixture, fetch } = sharingFixture()
  fixture.state.stats.workingTree = "changed"
  const view = render(
    <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
  )
  await screen.findByRole("button", { name: "Publish" })
  const share = screen.getByRole("button", { name: "Share prototype" })
  fireEvent.click(share)
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish" }))
  const dialog = await screen.findByRole("dialog", { name: "Publish uncommitted changes?" })
  expect(screen.getAllByRole("dialog")).toHaveLength(1)
  fireEvent.click(within(dialog).getByRole("button", { name: "Close publishing dialog" }))
  expect(
    screen.queryByRole("dialog", { name: "Publish uncommitted changes?" }),
  ).not.toBeInTheDocument()
  expect(screen.getAllByRole("dialog")).toHaveLength(1)
  expect(share).toHaveFocus()
  expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
  view.unmount()
})

it("saves publishing permission from the bottom Settings toggle without publishing", async () => {
  const { fixture, fetch } = sharingFixture(publicationState, {
    ...publicationHub,
    state: "connected",
    prototype: importedPrototype,
  })
  fixture.remember = true
  fixture.state.stats.workingTree = "changed"
  const view = render(
    <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
  )
  await screen.findByRole("button", { name: "Publish changes" })
  fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
  const sidebar = screen.getByRole("complementary", { name: "Hub" })
  const settings = within(sidebar).getByRole("region", { name: "Settings" })
  const toggle = within(settings).getByRole("switch", {
    name: "Always commit changes before publishing",
  })
  await waitFor(() => expect(toggle).toBeEnabled())
  expect(toggle).toBeChecked()
  expect(sidebar.querySelector(".hub-sidebar__content")?.lastElementChild).toBe(settings)
  expect(screen.queryByRole("button", { name: "Publishing preferences" })).not.toBeInTheDocument()
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).not.toBeChecked())
  expect(fixture.remember).toBe(false)
  expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).toBeChecked())
  fireEvent.click(screen.getAllByRole("button", { name: "Publish changes" })[0]!)
  await waitFor(() =>
    expect(fetch.mock.calls.filter(([path]) => path === "/api/publish")).toHaveLength(1),
  )
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  const serialized = fetch.mock.calls.find(([path]) => path === "/api/publish")?.[1]?.body
  if (typeof serialized !== "string") throw new Error("Expected a JSON publish request.")
  expect(JSON.parse(serialized)).toMatchObject({ mode: "commit-changes" })
  view.unmount()
})

it("keeps Settings unavailable for an undiscovered prototype", async () => {
  const { fetch } = sharingFixture(publicationState, {
    ...publicationHub,
    state: "undiscovered",
    prototype: undefined,
  })
  const view = render(
    <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
  )
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/hub/open", expect.anything()))
  fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
  expect(screen.queryByRole("region", { name: "Settings" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Publishing preferences" })).not.toBeInTheDocument()
  view.unmount()
})

it.each(["toolbar", "sidebar", "sharing"] as const)(
  "blocks the %s Publish action until disabling automatic-commit permission finishes",
  async (entry) => {
    const { fixture, fetch } = sharingFixture(publicationState, {
      ...publicationHub,
      state: "connected",
      prototype: { ...importedPrototype, published: false },
    })
    fixture.remember = true
    fixture.state.stats.workingTree = "changed"
    fixture.state.stats.commitSha = "b".repeat(40)
    fixture.state.stats.remoteBranch!.commitSha = fixture.state.stats.commitSha
    fixture.hub.commitSha = fixture.state.stats.commitSha
    const respond = fetch.getMockImplementation()!
    let finish!: () => void
    fetch.mockImplementation((path, options) =>
      path === "/api/publish/preference"
        ? new Promise<Response>((resolve) => {
            finish = () => {
              fixture.remember = false
              resolve(Response.json({ remember: false }))
            }
          })
        : respond(path, options),
    )
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("button", { name: "Publish changes" })
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    const sidebar = screen.getByRole("complementary", { name: "Hub" })
    const toggle = within(sidebar).getByRole("switch")
    await waitFor(() => expect(toggle).toBeChecked())
    fireEvent.click(toggle)
    if (entry === "sharing")
      fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
    const publish =
      entry === "sharing"
        ? within(screen.getByRole("dialog")).getByRole("button", { name: /Publish/ })
        : entry === "sidebar"
          ? within(sidebar).getByRole("button", { name: "Publish changes" })
          : screen.getAllByRole("button", { name: "Publish changes" })[0]!
    expect(publish).toBeDisabled()
    const prepared = fetch.mock.calls.filter(([path]) => path === "/api/publish/prepare").length
    fireEvent.click(publish)
    expect(fetch.mock.calls.filter(([path]) => path === "/api/publish/prepare")).toHaveLength(
      prepared,
    )
    expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
    await act(() => Promise.resolve(finish()))
    await waitFor(() => expect(publish).toBeEnabled())
    fireEvent.click(publish)
    await screen.findByRole("dialog", { name: "Publish uncommitted changes?" })
    expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
    view.unmount()
  },
)

it("reloads the saved permission after closing and reopening Edit details during a save", async () => {
  const { fixture, fetch } = sharingFixture(publicationState, {
    ...publicationHub,
    state: "connected",
    prototype: importedPrototype,
  })
  const respond = fetch.getMockImplementation()!
  let finish!: () => void
  fetch.mockImplementation((path, options) =>
    path === "/api/publish/preference"
      ? new Promise<Response>((resolve) => {
          finish = () => {
            fixture.remember = true
            resolve(Response.json({ remember: true }))
          }
        })
      : respond(path, options),
  )
  const view = render(
    <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
  )
  await screen.findByRole("button", { name: "Published" })
  fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
  const toggle = screen.getByRole("switch")
  await waitFor(() => expect(toggle).toBeEnabled())
  fireEvent.click(toggle)
  fireEvent.click(screen.getByRole("button", { name: "Close Hub" }))
  fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  })
  await act(() => Promise.resolve(finish()))
  await waitFor(() => expect(toggle).toBeChecked())
  expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
  view.unmount()
})

it("retains the saved toggle value after a failed save and retries the read without publishing", async () => {
  const { fetch } = sharingFixture(publicationState, {
    ...publicationHub,
    state: "connected",
    prototype: importedPrototype,
  })
  const respond = fetch.getMockImplementation()!
  fetch.mockImplementation((path, options) =>
    path === "/api/publish/preference"
      ? Promise.resolve(
          Response.json({ error: "Settings storage is unavailable." }, { status: 503 }),
        )
      : respond(path, options),
  )
  const view = render(
    <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
  )
  await screen.findByRole("button", { name: "Published" })
  fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
  const settings = screen.getByRole("region", { name: "Settings" })
  const toggle = within(settings).getByRole("switch")
  await waitFor(() => expect(toggle).toBeEnabled())
  fireEvent.click(toggle)
  await within(settings).findByText("Settings storage is unavailable.")
  expect(toggle).not.toBeChecked()
  fireEvent.click(within(settings).getByRole("button", { name: "Retry settings" }))
  await waitFor(() =>
    expect(
      within(settings).queryByText("Settings storage is unavailable."),
    ).not.toBeInTheDocument(),
  )
  expect(fetch.mock.calls.filter(([path]) => path === "/api/publish/preference")).toHaveLength(1)
  expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
  view.unmount()
})

it("offers publishing for local edits on an already published commit without republishing that commit", async () => {
  const { fixture, fetch } = sharingFixture(publicationState, {
    ...publicationHub,
    state: "connected",
    prototype: importedPrototype,
  })
  fixture.state.stats.workingTree = "changed"
  const view = render(
    <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
  )
  fireEvent.click(await screen.findByRole("button", { name: "Publish changes" }))
  const dialog = await screen.findByRole("dialog", { name: "Publish uncommitted changes?" })
  fireEvent.click(within(dialog).getByRole("button", { name: "Publish committed version only" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
  const shared = await screen.findByRole("main", { name: "Share prototype" })
  expect(
    await within(shared).findByRole("link", { name: "Open internal prototype link" }),
  ).toHaveAttribute("href", importedPrototype.build!.url)
  expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
  view.unmount()
})

it("keeps the Published status non-interactive until local edits are detected", async () => {
  const { fixture, fetch } = sharingFixture(publicationState, {
    ...publicationHub,
    state: "connected",
    prototype: importedPrototype,
  })
  const respond = fetch.getMockImplementation()!
  fetch.mockImplementation((path, options) =>
    path === "/api/publish/prepare"
      ? Promise.resolve(
          Response.json({ ...publishPreparation(fixture.state), workingTree: "changed" }),
        )
      : respond(path, options),
  )
  const view = render(
    <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
  )
  const published = await screen.findByRole("button", { name: "Published" })
  fireEvent.click(published)
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(fetch.mock.calls.some(([path]) => path === "/api/publish/prepare")).toBe(false)
  fixture.state.stats.workingTree = "changed"
  fireEvent.focus(window)
  fireEvent.click(await screen.findByRole("button", { name: "Publish changes" }))
  await screen.findByRole("dialog", { name: "Publish uncommitted changes?" })
  expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
  view.unmount()
})

it("lists the detected changes and leaves local agent skills out of the commit", async () => {
  const { fixture, fetch } = sharingFixture()
  fixture.state.stats.workingTree = "changed"
  const respond = fetch.getMockImplementation()!
  fetch.mockImplementation((path, options) =>
    path === "/api/publish/prepare"
      ? Promise.resolve(
          Response.json({
            ...publishPreparation(fixture.state),
            changes: {
              files: { paths: ["src/App.tsx"], total: 3 },
              localSkills: { paths: [".github/skills/publish/SKILL.md"], total: 1 },
            },
          }),
        )
      : respond(path, options),
  )
  const view = render(
    <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
  )
  fireEvent.click(await screen.findByRole("button", { name: "Publish" }))
  const dialog = await screen.findByRole("dialog", { name: "Publish uncommitted changes?" })
  const files = within(dialog).getByRole("region", { name: "Uncommitted changes" })
  expect(
    within(files)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["src/App.tsx", "2 more"])
  expect(
    within(dialog).getByText(
      "1 local agent skill file stays uncommitted. Copilot commits only changes related to this prototype task and asks if it cannot tell which changes belong.",
    ),
  ).toBeVisible()
  view.unmount()
})

it("keeps a failed publish choice visible and never falls back to publishing the committed version", async () => {
  const { fixture, fetch } = sharingFixture()
  fixture.state.stats.workingTree = "changed"
  const respond = fetch.getMockImplementation()!
  fetch.mockImplementation((path, options) =>
    path === "/api/publish"
      ? Promise.resolve(Response.json({ error: "The checkout changed." }, { status: 409 }))
      : respond(path, options),
  )
  const view = render(
    <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
  )
  fireEvent.click(await screen.findByRole("button", { name: "Publish" }))
  const dialog = await screen.findByRole("dialog", { name: "Publish uncommitted changes?" })
  fireEvent.click(within(dialog).getByRole("button", { name: "Commit changes & publish" }))
  await waitFor(() => expect(within(dialog).getByText("The checkout changed.")).toBeVisible())
  expect(fetch.mock.calls.filter(([path]) => path === "/api/publish")).toHaveLength(1)
  expect(within(dialog).getByRole("button", { name: "Commit changes & publish" })).toBeEnabled()
  view.unmount()
})
