import type { Meta, StoryObj } from "@storybook/react-vite"

import { ScreenshotImage } from "."

const light = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="450"><rect width="720" height="450" fill="#fff"/><rect x="40" y="40" width="640" height="370" rx="12" fill="#f0f3f6"/><text x="80" y="130" font-family="sans-serif" font-size="32" fill="#24292f">Light prototype</text></svg>')}`
const dark = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="450"><rect width="720" height="450" fill="#0d1117"/><rect x="40" y="40" width="640" height="370" rx="12" fill="#161b22"/><text x="80" y="130" font-family="sans-serif" font-size="32" fill="#e6edf3">Dark prototype</text></svg>')}`

const meta = {
  title: "Components/Screenshot Image",
  component: ScreenshotImage,
  args: {
    src: light,
    darkSrc: dark,
    alt: "Synthetic theme-aware prototype screenshot",
    style: { width: "min(100%, 36rem)" },
  },
} satisfies Meta<typeof ScreenshotImage>

export default meta
type Story = StoryObj<typeof meta>

export const Light: Story = { globals: { colorMode: "day" } }
export const Dark: Story = { globals: { colorMode: "night" } }
export const LegacyInDarkMode: Story = {
  args: { darkSrc: undefined },
  globals: { colorMode: "night" },
}
