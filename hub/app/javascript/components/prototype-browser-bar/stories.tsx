import type { Meta, StoryObj } from "@storybook/react-vite"
import type { CSSProperties } from "react"

import { BrowserBar } from "."
import { copy } from "@utils/prototype-canvas/en"

const meta = {
  title: "Components/Prototype canvas/Browser bar",
  component: BrowserBar,
  decorators: [
    (Story) => (
      <div style={{ width: "100%", minWidth: 320 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    address: "http://localhost:5173/#/cli/cli/tree/main",
    canGoBack: true,
    canGoForward: false,
    appearance: "light",
    onAppearanceChange: () => {},
    onBack: () => {},
    onForward: () => {},
    onNavigate: () => {},
    onOpenTab: async () => {},
    onReload: () => {},
  },
} satisfies Meta<typeof BrowserBar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Dark: Story = {
  args: { appearance: "dark" },
  globals: { colorMode: "night" },
}

export const Tinted: Story = {
  globals: { colorMode: "day" },
  decorators: [
    (Story) => (
      <div
        style={
          {
            "--background-color-default": "#f2eee5",
            "--text-color-default": "#302b24",
            "--text-color-muted": "#665e52",
            "--border-color-default": "#c9c0b1",
            "--color-focus-outline": "#7757a8",
            "--true-color-red": "#b43838",
          } as CSSProperties
        }
      >
        <Story />
      </div>
    ),
  ],
}

export const Narrow: Story = {
  globals: { viewport: { value: "mobile" } },
}

export const NoHistory: Story = { args: { canGoBack: false, canGoForward: false } }
export const ForwardHistory: Story = { args: { canGoBack: true, canGoForward: true } }
export const CrossOriginAddress: Story = {
  play: async ({ canvas, userEvent }) => {
    const address = canvas.getByRole("textbox")
    await userEvent.clear(address)
    await userEvent.type(address, "https://github.com/{Enter}")
    await canvas.findByRole("alert")
  },
}
export const InvalidAddress: Story = {
  play: async ({ canvas, userEvent }) => {
    const address = canvas.getByRole("textbox")
    await userEvent.clear(address)
    await userEvent.type(address, "http://[[invalid{Enter}")
    await canvas.findByRole("alert")
  },
}
export const OpenTabFailed: Story = {
  args: { onOpenTab: () => Promise.reject(new Error("Could not open your browser.")) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: copy.browserOpenTab }))
    await canvas.findByRole("alert")
  },
}
