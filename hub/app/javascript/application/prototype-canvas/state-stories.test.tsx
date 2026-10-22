import { composeStories } from "@storybook/react-vite"
import { screen } from "@testing-library/react"
import { userEvent, within } from "storybook/test"
import { describe, expect, it } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"
import { shareCopy } from "@hooks/use-canvas-share-links/en"
import * as browserStories from "@components/prototype-browser-bar/stories"
import * as buildStories from "@components/prototype-build-details-dialog/stories"
import * as connectionStories from "@components/prototype-hub-connection-dialog/stories"
import * as controlsStories from "@components/prototype-controls-panel/stories"
import * as hubStories from "@features/prototype-canvas-hub-panel/stories"
import * as sharingStories from "@features/prototype-canvas-share-links/stories"
import * as overlayStories from "@features/prototype-review-overlays/stories"
import { reviewCommentsCopy } from "@utils/review-comment/en"
import { copy } from "@utils/prototype-canvas/en"

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
const overlays = composeStories(overlayStories, annotations)

describe("Canvas state stories", () => {
  it("shows the failed comment state without losing the draft", async () => {
    await overlays.CommentFailed.run({
      canvas: within(document.body),
      userEvent: userEvent.setup(),
    })
    expect(screen.getByText("Could not save your comment. Your draft is still here.")).toBeVisible()
    expect(screen.getByRole("textbox", { name: reviewCommentsCopy.composerLabel })).toHaveValue(
      "Please align this control with the content above it.",
    )
    expect(screen.getByRole("button", { name: reviewCommentsCopy.submitLabel })).toBeEnabled()
  })

  it.each([
    ["invalid address", browser.InvalidAddress, copy.browserAddressInvalid],
    ["cross-origin address", browser.CrossOriginAddress, copy.browserAddressOrigin],
    ["browser launch failure", browser.OpenTabFailed, "Could not open your browser."],
    ["clipboard failure", build.CopyFailed, copy.buildDetailsCopyFailed("Branch")],
    ["Hub URL save failure", connection.SaveFailed, "Could not save the Hub URL. Try again."],
    ["Hub URL reset failure", connection.ResetFailed, "Could not read the repository's Hub URL."],
    ["metadata save failure", hub.MetadataSaveFailed, "Hub returned HTTP 503."],
    ["disconnect failure", hub.DisconnectFailed, "Hub returned HTTP 503."],
    ["share label validation", sharing.InvalidLabel, shareCopy.labelInvalid],
  ] as const)("reaches the %s state through the real interaction", async (_name, story, error) => {
    await story.run({ canvas: within(document.body), userEvent: userEvent.setup() })
    expect(screen.getByRole("alert")).toHaveTextContent(error)
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
