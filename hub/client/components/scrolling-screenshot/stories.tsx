import type { Decorator, Meta, StoryObj } from "@storybook/react-vite"

import { screenshotViewportStyles } from "@utils/screenshot-viewports"

import {
  welcomeFullPageScreenshot,
  welcomeNarrowFullPageScreenshot,
  welcomeScreenshot,
} from "@/storybook/fixtures/builds"

import { ScrollingScreenshot } from "."

function previewFrame(aspectRatio: string): Decorator {
  return (Story) => (
    <div
      style={{
        width: "min(100%, 24rem)",
        aspectRatio,
        border: "1px solid var(--hub-border-muted)",
        borderRadius: "var(--hub-radius-medium)",
        overflow: "hidden",
      }}
    >
      <Story />
    </div>
  )
}

const meta = {
  title: "Components/Scrolling Screenshot",
  component: ScrollingScreenshot,
  args: {
    alt: "Full-height desktop screenshot of the welcome prototype",
    src: welcomeFullPageScreenshot,
  },
} satisfies Meta<typeof ScrollingScreenshot>

export default meta
type Story = StoryObj<typeof meta>

export const FullPage: Story = {
  decorators: [previewFrame(screenshotViewportStyles.desktop.aspectRatio)],
}

export const NarrowBuildDetail: Story = {
  args: {
    alt: "Full-height narrow screenshot of the welcome prototype",
    src: welcomeNarrowFullPageScreenshot,
  },
  decorators: [previewFrame(screenshotViewportStyles.narrow.aspectRatio)],
}

export const ViewportHeight: Story = {
  args: {
    alt: "Viewport-height screenshot of the welcome prototype",
    src: welcomeScreenshot,
  },
  decorators: [previewFrame(screenshotViewportStyles.desktop.aspectRatio)],
}
