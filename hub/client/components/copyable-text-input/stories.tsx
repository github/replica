import type { Meta, StoryObj } from "@storybook/react-vite"

import { CopyableTextInput } from "."

const meta = {
  title: "Components/Copyable Text Input",
  component: CopyableTextInput,
  args: {
    value: "https://replica.example/share/12345678-1234-1234-1234-123456789abc",
    label: "Usability review",
    copyLabel: "Copy link",
    copiedLabel: "Copied",
    copyErrorLabel: "Copy failed",
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: "36rem" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CopyableTextInput>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Compact: Story = {
  args: { compact: true },
}

export const ShareLink: Story = {
  args: {
    value: "https://replica.example/share/12345678-1234-1234-1234-123456789abc",
  },
  decorators: [
    (Story) => (
      <div style={{ width: "min(100%, 52rem)" }}>
        <Story />
      </div>
    ),
  ],
}

export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: "12rem" }}>
        <Story />
      </div>
    ),
  ],
}

export const Copied: Story = {
  play: async ({ canvas }) => {
    const previousClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    })

    try {
      canvas.getByRole("button", { name: "Copy link" }).click()
      await canvas.findByRole("button", { name: "Copied" })
    } finally {
      if (previousClipboard) {
        Object.defineProperty(navigator, "clipboard", previousClipboard)
      } else {
        Reflect.deleteProperty(navigator, "clipboard")
      }
    }
  },
}

export const CopyFailed: Story = {
  play: async ({ canvas }) => {
    const previousClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("Clipboard unavailable")) },
    })

    try {
      canvas.getByRole("button", { name: "Copy link" }).click()
      await canvas.findByRole("alert")
    } finally {
      if (previousClipboard) {
        Object.defineProperty(navigator, "clipboard", previousClipboard)
      } else {
        Reflect.deleteProperty(navigator, "clipboard")
      }
    }
  },
}
