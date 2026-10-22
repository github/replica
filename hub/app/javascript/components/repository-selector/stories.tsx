import type { Meta, StoryObj } from "@storybook/react-vite"

import { githubEmpty, githubPrototype } from "@/storybook/fixtures/repositories"

import { RepositorySelector } from "."

const meta = {
  title: "Components/Repository Selector",
  component: RepositorySelector,
  args: {
    ariaLabel: "Choose repository. github/prototype selected",
    menuLabel: "Repositories",
    repositories: [githubPrototype, githubEmpty],
    selectedRepositoryId: "2001",
  },
  decorators: [
    (Story, context) => (
      <div
        style={{
          width: context.args.collapsed ? "2.5rem" : "13.8125rem",
          background: "var(--brand-color-canvas-muted)",
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RepositorySelector>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Collapsed: Story = {
  args: { collapsed: true },
}

export const LongName: Story = {
  args: {
    ariaLabel:
      "Choose repository. github/a-very-long-repository-name-for-prototype-review-and-design-system-experiments selected",
    repositories: [
      {
        ...githubPrototype,
        nameWithOwner:
          "github/a-very-long-repository-name-for-prototype-review-and-design-system-experiments",
      },
      githubEmpty,
    ],
  },
}
