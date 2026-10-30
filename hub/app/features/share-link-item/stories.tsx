import type { Meta, StoryObj } from "@storybook/react-vite"

import { ShareLinkItem } from "."

const shareLink = {
  buildLabel: "Build 1",
  createdAt: "2026-09-15T12:00:00Z",
  createdLabel: "Created by @octocat",
  deletePath: "/repositories/2001/prototypes/1/share_links/1",
  deletePrompt: "Delete “Usability review”?",
  expiresAt: "2026-09-22T12:00:00Z",
  expiresLabel: "Expires September 22",
  id: 1,
  label: "Usability review",
  url: "https://replica.example/share/12345678-1234-1234-1234-123456789abc",
}

const meta = {
  title: "Hub/Features/Share Links/Item",
  component: ShareLinkItem,
  args: {
    authenticityToken: "csrf-token",
    shareLink,
    copiedLabel: "Copied",
    copyErrorLabel: "Copy failed",
    copyLabel: "Copy link",
    deleteLabel: "Delete link",
    openLabel: "Open",
  },
  decorators: [
    (Story) => (
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          maxWidth: "44rem",
          padding: 0,
        }}
      >
        <Story />
      </ul>
    ),
  ],
} satisfies Meta<typeof ShareLinkItem>

export default meta
type Story = StoryObj<typeof meta>

export const Expiring: Story = {}

export const Permanent: Story = {
  args: {
    shareLink: {
      ...shareLink,
      expiresAt: null,
      expiresLabel: "Never expires",
      label: "Partner review",
    },
  },
}

export const ReadOnly: Story = {
  args: { canDelete: false },
}
