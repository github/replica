import { createRef } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor } from "storybook/test"

import { replicaBrowseData } from "@/storybook/fixtures/replica-browse"

import { PrototypePreview } from "."

const previewUrl = new URL("prototype-preview/index.html", window.location.href).toString()
const meta = {
  title: "Hub/Features/Prototype Preview",
  component: PrototypePreview,
  args: {
    address: previewUrl,
    copy: { ...replicaBrowseData, openInNewTabLabel: "Open in new tab" },
    iframeRef: createRef<HTMLIFrameElement>(),
    previewUrl,
    frameTitle: "Replica preview",
    previewTheme: "light",
  },
  decorators: [
    (Story) => (
      <div style={{ display: "flex", height: "36rem" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PrototypePreview>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {}

export const WithControls: Story = {
  args: {
    controlsIdentity: "storybook-preview-controls",
    address: new URL("/prototype-preview/build-controls/index.html", window.location.href).href,
    previewUrl: new URL("/prototype-preview/build-controls/index.html", window.location.href).href,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Controls" }))
    await canvas.findByRole("textbox", { name: "Title" })
  },
}

export const MinimizedControls: Story = {
  ...WithControls,
  args: { ...WithControls.args, minimized: true },
}

export const MissingControlsRuntime: Story = {
  args: { controlsIdentity: "storybook-preview-missing-controls-runtime" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Controls" }))
    await waitFor(
      () =>
        expect(
          canvas.getByText(
            "Build Controls did not connect. Reload the preview or check its definitions.",
          ),
        ).toBeVisible(),
      { timeout: 10_000 },
    )
    await expect(
      canvas.queryByRole("button", { name: "Diagnose with Copilot" }),
    ).not.toBeInTheDocument()
  },
}
