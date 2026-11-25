import type { Meta, StoryObj } from "@storybook/react-vite"

import { RepositoryWorkspace } from "@features/repository-workspace"
import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"
import { authenticatedHeaderData } from "@/storybook/fixtures/authenticated-header"
import { githubEmpty, githubPrototype } from "@/storybook/fixtures/repositories"
import { mona } from "@/storybook/fixtures/users"

import { ScreenshotConsentPrototype } from "."
import type { ScreenshotConsentPrototypeData } from "./types"

const workspace: RepositoryWorkspaceData = {
  ...authenticatedHeaderData,
  accountMenuLabel: "Account menu for @mona",
  currentUser: mona,
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
  selectedSection: null,
  welcomeLabel: "Welcome",
  welcomePath: "/welcome",
}

const data: ScreenshotConsentPrototypeData = {
  repositoryName: "github/prototype",
  personName: "@mona",
  consentRecordedAt: "November 24, 2026",
  evaluatorName: "Prototype quality reviewer",
  consentEvaluatorName: null,
  evaluationAvailable: true,
  consent: null,
}

const meta = {
  title: "Hub/Design/Screenshot consent",
  component: ScreenshotConsentPrototype,
  parameters: { layout: "fullscreen" },
  args: { data },
  render: (args) => (
    <RepositoryWorkspace data={workspace}>
      <ScreenshotConsentPrototype {...args} />
    </RepositoryWorkspace>
  ),
} satisfies Meta<typeof ScreenshotConsentPrototype>

export default meta
type Story = StoryObj<typeof meta>

export const FirstUse: Story = {}

export const Allowed: Story = {
  args: {
    data: { ...data, consentEvaluatorName: data.evaluatorName, consent: true },
  },
}

export const Declined: Story = {
  args: {
    data: { ...data, consent: false },
  },
}

export const Withdrawing: Story = {
  args: {
    data: { ...data, consentEvaluatorName: data.evaluatorName, consent: true },
  },
  play: async ({ canvas, userEvent }) => {
    // Primer Brand covers the native checkbox with a styled box, so click its label.
    await userEvent.click(canvas.getByText("Allow screenshot capture and automated review"))
  },
}

export const Withdrawn: Story = {
  args: {
    data: { ...data, consentEvaluatorName: data.evaluatorName, consent: true },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByText("Allow screenshot capture and automated review"))
    await userEvent.click(canvas.getByRole("button", { name: "Withdraw and request deletion" }))
  },
}

export const ConsentRenewal: Story = {
  args: {
    data: {
      ...data,
      evaluatorName: "Updated quality reviewer",
      consentEvaluatorName: "Prototype quality reviewer",
      consent: true,
    },
  },
}

export const EvaluationUnavailable: Story = {
  args: {
    data: { ...data, evaluationAvailable: false },
  },
}

export const EvaluationUnavailableAfterConsent: Story = {
  args: {
    data: {
      ...data,
      evaluationAvailable: false,
      consentEvaluatorName: data.evaluatorName,
      consent: true,
    },
  },
}
