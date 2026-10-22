import type { Meta, StoryObj } from "@storybook/react-vite"

import { octocat } from "@/storybook/fixtures/users"

import { HubUserAvatar } from "."

const meta = {
  title: "Components/Brand-based: User avatar",
  component: HubUserAvatar,
  args: { src: octocat.avatarUrl },
} satisfies Meta<typeof HubUserAvatar>

export default meta
type Story = StoryObj<typeof meta>

export const Profile: Story = {}

export const MissingPhoto: Story = {
  args: { src: null },
}

export const FailedPhoto: Story = {
  args: { src: "/missing-avatar.png" },
}
