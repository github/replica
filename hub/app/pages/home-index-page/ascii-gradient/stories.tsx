import type { Meta, StoryObj } from "@storybook/react-vite"

import { AsciiGradient } from "."

const meta = {
  title: "Components/ASCII Gradient",
  component: AsciiGradient,
  args: {
    backgroundColor: "#000000",
    controlBorderColor: "#5FED83",
    controlColor: "#FFFFFF",
    highlightColor: "#47B966",
    pauseLabel: "Pause animation",
    pixelColor: "#258B48",
    resumeLabel: "Resume animation",
  },
  argTypes: {
    backgroundColor: { control: "color" },
    controlBorderColor: { control: "color" },
    controlColor: { control: "color" },
    highlightColor: { control: "color" },
    pixelColor: { control: "color" },
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A shader-like density field shifts through a fixed pixel grid. Black first dithers into solid dark green, then an ordered second transition mixes toward muted light green on the right. Mouse movement gently steers the shape; the corner control pauses or resumes all motion. Reduced motion keeps the field still.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: "100%", height: "100dvh" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AsciiGradient>

export default meta
type Story = StoryObj<typeof meta>

export const Illustration: Story = { name: "Replica green" }

export const PaletteCycle: Story = {
  name: "Animated palette cycle",
  args: {
    palettes: [
      { pixelColor: "#258B48", highlightColor: "#47B966" },
      { pixelColor: "#0D6731", highlightColor: "#8CF2A6" },
      { pixelColor: "#0377FF", highlightColor: "#80CCFF" },
      { pixelColor: "#8534F3", highlightColor: "#C898FD" },
      { pixelColor: "#0E4A2E", highlightColor: "#BFFFD1" },
    ],
  },
}

export const LavenderLight: Story = {
  name: "Lavender light",
  args: {
    backgroundColor: "#F2F5F3",
    controlBorderColor: "#8534F3",
    controlColor: "#43179E",
    highlightColor: "#E0C3FF",
    pixelColor: "#C898FD",
  },
}

export const NeutralDark: Story = {
  name: "Neutral dark",
  args: {
    backgroundColor: "#121613",
    controlBorderColor: "#58635B",
    controlColor: "#F2F5F3",
    highlightColor: "#77827A",
    pixelColor: "#353D37",
  },
}

export const NeutralLight: Story = {
  name: "Neutral light",
  args: {
    backgroundColor: "#F2F5F3",
    controlBorderColor: "#77827A",
    controlColor: "#000000",
    highlightColor: "#FFFFFF",
    pixelColor: "#D2D9D4",
  },
}

export const CampaignBlue: Story = {
  name: "Campaign blue",
  args: {
    backgroundColor: "#DDF4FF",
    controlBorderColor: "#0377FF",
    controlColor: "#000000",
    highlightColor: "#80CCFF",
    pixelColor: "#0377FF",
  },
}

export const GreenSoft: Story = {
  name: "Green soft",
  args: {
    backgroundColor: "#BFFFD1",
    controlBorderColor: "#08872B",
    controlColor: "#0E4A2E",
    highlightColor: "#5FED83",
    pixelColor: "#08872B",
  },
}

export const AiryGreen: Story = {
  name: "Airy green",
  args: {
    backgroundColor: "#EBF9F4",
    controlBorderColor: "#0D6731",
    controlColor: "#0E4A2E",
    highlightColor: "#8CF2A6",
    pixelColor: "#0D6731",
  },
}

export const VerdantGreen: Story = {
  name: "Verdant green",
  args: {
    backgroundColor: "#8CF2A6",
    controlBorderColor: "#0E4A2E",
    controlColor: "#0D3024",
    highlightColor: "#BFFFD1",
    pixelColor: "#0E4A2E",
  },
}

export const ForestMint: Story = {
  name: "Forest mint",
  args: {
    backgroundColor: "#0D3024",
    controlBorderColor: "#8CF2A6",
    controlColor: "#BFFFD1",
    highlightColor: "#BFFFD1",
    pixelColor: "#8CF2A6",
  },
}

export const EvergreenBright: Story = {
  name: "Evergreen bright",
  args: {
    backgroundColor: "#0E4A2E",
    controlBorderColor: "#5FED83",
    controlColor: "#BFFFD1",
    highlightColor: "#BFFFD1",
    pixelColor: "#5FED83",
  },
}

export const DeepGreenMist: Story = {
  name: "Deep green mist",
  args: {
    backgroundColor: "#0D6731",
    controlBorderColor: "#BFFFD1",
    controlColor: "#F2F5F3",
    highlightColor: "#FFFFFF",
    pixelColor: "#BFFFD1",
  },
}
