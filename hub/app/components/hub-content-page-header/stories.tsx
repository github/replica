import type { Meta, StoryObj } from "@storybook/react-vite"

import { BuildStateLabel } from "@components/build-state-label"

import { HubContentPageHeader } from "."

const meta = {
  title: "Components/Content Page Header",
  component: HubContentPageHeader,
  args: { title: "History" },
} satisfies Meta<typeof HubContentPageHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Title: Story = {}

export const WithDescription: Story = {
  args: {
    title: "Share links",
    description: "Share one fixed successful Build without exposing private review data.",
  },
}

export const WithStatus: Story = {
  args: {
    title: "build 4",
    trailing: <BuildStateLabel state="successful" label="Successful" />,
  },
}
