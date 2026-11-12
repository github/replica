import type { Meta, StoryObj } from "@storybook/react-vite"
import type { CSSProperties } from "react"

import { PrototypeCanvasThreadSample } from "."

const meta = {
  title: "Components/Prototype canvas/Follow-up thread sample",
  component: PrototypeCanvasThreadSample,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div
        style={
          { position: "relative", height: "100vh", "--canvas-preview-top": "0px" } as CSSProperties
        }
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PrototypeCanvasThreadSample>

export default meta
type Story = StoryObj<typeof meta>
export const Sample: Story = {}
