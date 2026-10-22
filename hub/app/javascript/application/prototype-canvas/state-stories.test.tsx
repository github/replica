import { composeStories } from "@storybook/react-vite"
import { screen } from "@testing-library/react"
import { userEvent, within } from "storybook/test"
import { describe, expect, it } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"
import * as browserStories from "@components/prototype-browser-bar/stories"
import * as buildStories from "@components/prototype-build-details-dialog/stories"
import * as connectionStories from "@components/prototype-hub-connection-dialog/stories"
import * as controlsStories from "@components/prototype-controls-panel/stories"
import * as hubStories from "@features/prototype-canvas-hub-panel/stories"
import * as sharingStories from "@features/prototype-canvas-share-links/stories"

const annotations = {
  decorators: [
    (Story: React.ComponentType) => (
      <HubThemeProvider>
        <Story />
      </HubThemeProvider>
    ),
  ],
}
const browser = composeStories(browserStories, annotations)
const build = composeStories(buildStories, annotations)
const connection = composeStories(connectionStories, annotations)
const controls = composeStories(controlsStories, annotations)
const hub = composeStories(hubStories, annotations)
const sharing = composeStories(sharingStories, annotations)

describe("Canvas state stories", () => {
  it.each([
    ["invalid address", browser.InvalidAddress],
    ["cross-origin address", browser.CrossOriginAddress],
    ["browser launch failure", browser.OpenTabFailed],
    ["clipboard failure", build.CopyFailed],
    ["Hub URL save failure", connection.SaveFailed],
    ["Hub URL reset failure", connection.ResetFailed],
    ["metadata save failure", hub.MetadataSaveFailed],
    ["disconnect failure", hub.DisconnectFailed],
    ["share label validation", sharing.InvalidLabel],
  ] as const)("reaches the %s state through the real interaction", async (_name, story) => {
    await story.run({ canvas: within(document.body), userEvent: userEvent.setup() })
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0)
  })

  it("keeps the diagnosis failure visible with a usable retry action", async () => {
    await controls.DiagnosisFailed.run({
      canvas: within(document.body),
      userEvent: userEvent.setup(),
    })
    expect(screen.getByText("Could not reach Copilot. Try again.")).toBeVisible()
    expect(screen.getByRole("button", { name: "Diagnose with Copilot" })).toBeEnabled()
  })

  it("acknowledges a requested diagnosis without sending it again", async () => {
    await controls.DiagnosisRequested.run({
      canvas: within(document.body),
      userEvent: userEvent.setup(),
    })
    expect(screen.getByRole("button", { name: "Requested in chat" })).toBeDisabled()
  })

  it("disables controls when the connection needs a new command budget", async () => {
    await controls.ReconnectionRequired.run()
    expect(screen.getByRole("textbox", { name: "Title" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Retry connection" })).toBeEnabled()
  })
})
