import { createRef } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { replicaBrowseData } from "@/storybook/fixtures/replica-browse"

import { PrototypePreview } from "."

const previewUrl = new URL("prototype-preview/index.html", window.location.href).toString()
const meta = {
  title: "Features/Prototype Preview",
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
