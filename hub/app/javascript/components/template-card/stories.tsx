import type { Meta, StoryObj } from "@storybook/react-vite"

import { templatesData } from "@/storybook/fixtures/templates"

import { TemplateCard } from "."

const meta = {
  title: "Components/Template Card",
  component: TemplateCard,
  args: {
    template: templatesData.templates[1]!,
    openLabel: templatesData.openTemplateLabel,
    unavailableLabel: templatesData.previewUnavailableLabel,
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: "24rem" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TemplateCard>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {}

export const FullHeight: Story = {
  args: { template: templatesData.templates[2]! },
}

export const Unavailable: Story = {
  args: { template: { ...templatesData.templates[0]!, screenshotSrc: undefined } },
}

export const LongContent: Story = {
  args: {
    template: {
      ...templatesData.templates[1]!,
      name: "Welcome to the independent journal and issue archive",
      description:
        "Browse stories, explore the complete issue archive, and build a reading experience for a community of curious people.",
    },
  },
}
