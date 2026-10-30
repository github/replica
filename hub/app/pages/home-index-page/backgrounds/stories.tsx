import type { Meta, StoryObj } from "@storybook/react-vite"

import { BackgroundsGallery } from "."

const meta = {
  title: "Components/Backgrounds",
  component: BackgroundsGallery,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A gallery of the 1920 × 1080 Replica backgrounds exported from the Figma vectors+logo section.",
      },
    },
  },
} satisfies Meta<typeof BackgroundsGallery>

export default meta
type Story = StoryObj<typeof meta>

export const Gallery: Story = {}
