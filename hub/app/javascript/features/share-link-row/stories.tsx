import { Button } from "@primer/react-brand/esm"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { ShareLinkRow } from "."

const meta = {
  title: "Hub/Features/Share Links/Row",
  component: ShareLinkRow,
  args: {
    shareLink: {
      id: 1,
      label: "Usability review",
      url: "https://replica.example/share/12345678-1234-1234-1234-123456789abc",
      buildLabel: "Build 1",
      createdAt: "2026-10-05T07:00:00Z",
      createdLabel: "Created by @octocat",
      expiresAt: null,
      expiresLabel: "Never expires",
    },
    copyLabel: "Copy link",
    copiedLabel: "Copied",
    copyErrorLabel: "Copy failed",
    children: <Button variant="secondary">Open</Button>,
  },
  decorators: [
    (Story) => (
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <Story />
      </ul>
    ),
  ],
} satisfies Meta<typeof ShareLinkRow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Created: Story = { args: { highlighted: true } }
export const Expired: Story = {
  args: { unavailableLabel: "This link has expired. Refresh links." },
}
