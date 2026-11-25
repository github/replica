import type { Meta, StoryObj } from "@storybook/react-vite"

import { RepositoryWorkspace } from "@features/repository-workspace"
import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"
import { authenticatedHeaderData } from "@/storybook/fixtures/authenticated-header"
import { githubEmpty, githubPrototype } from "@/storybook/fixtures/repositories"

import { EvaluationSettingsPrototype } from "."
import type { EvaluationSettingsPrototypeData } from "./types"

const workspace: RepositoryWorkspaceData = {
  ...authenticatedHeaderData,
  analyticsLabel: "Analytics",
  analyticsPath: "/repositories/2001/analytics",
  collapseNavigationLabel: "Collapse sidebar",
  expandNavigationLabel: "Expand sidebar",
  learningsLabel: "Learnings",
  learningsPath: "/repositories/2001/learnings",
  navigationLabel: "Repository navigation",
  newPrototypeLabel: "Create",
  newPrototypePath: "/repositories/2001/new",
  prototypesLabel: "Prototypes",
  prototypesPath: "/repositories/2001",
  repositories: [githubPrototype, githubEmpty],
  repositoryMenuLabel: "Repositories",
  repositorySelectorLabel: "Choose repository. github/prototype selected",
  selectedRepositoryId: "2001",
  selectedSection: "learnings",
  welcomeLabel: "Welcome",
  welcomePath: "/welcome",
}

const settings: EvaluationSettingsPrototypeData = {
  repositoryName: "github/prototype",
  learningsPath: "/iframe.html?id=hub-pages-learnings-library--multiple&viewMode=story",
  canManageHubBudget: true,
  canManageRepositorySettings: true,
  budgetLimitCredits: 100,
  usedCredits: 42,
  repositoryEnabled: false,
}

const meta = {
  title: "Hub/Pages/Learnings/Evaluation settings",
  component: EvaluationSettingsPrototype,
  parameters: { layout: "fullscreen" },
  args: { data: settings },
  render: ({ data }) => (
    <RepositoryWorkspace data={workspace}>
      <EvaluationSettingsPrototype data={data} />
    </RepositoryWorkspace>
  ),
} satisfies Meta<typeof EvaluationSettingsPrototype>

export default meta
type Story = StoryObj<typeof meta>

export const HubAndRepositoryAdmin: Story = {
  args: {
    data: {
      ...settings,
      learningsPath: "/iframe.html?id=hub-pages-learnings-library--hub-admin&viewMode=story",
    },
  },
}
export const RepositoryAdmin: Story = {
  args: { data: { ...settings, canManageHubBudget: false } },
}
export const BudgetReached: Story = {
  args: {
    data: {
      ...settings,
      canManageHubBudget: false,
      budgetLimitCredits: 100,
      usedCredits: 100,
      repositoryEnabled: true,
    },
  },
}
export const BudgetNotSet: Story = {
  args: {
    data: {
      ...settings,
      canManageHubBudget: false,
      budgetLimitCredits: 0,
      usedCredits: 0,
      repositoryEnabled: false,
    },
  },
}
