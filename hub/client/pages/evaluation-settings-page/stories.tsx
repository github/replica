import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { RepositoryWorkspace } from "@features/repository-workspace"
import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"
import { authenticatedHeaderData } from "@/storybook/fixtures/authenticated-header"
import { githubEmpty, githubPrototype } from "@/storybook/fixtures/repositories"

import { EvaluationSettingsPage } from "."
import type { EvaluationSettingsPageData } from "./types"

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

const settings: EvaluationSettingsPageData = {
  repositoryName: "github/prototype",
  learningsPath: "/iframe.html?id=hub-pages-learnings-library--multiple&viewMode=story",
  budget: { limitCredits: "100", usedCredits: "42", editable: true },
  evaluations: {
    editable: true,
    enabled: true,
    screenshotsAllowed: true,
    screenshotsRecord: "Allowed by @mona on 12/20/2026",
  },
}

/** Keeps each story's changes in its own state, as Hub would after saving. */
function EvaluationSettingsStory({
  busy,
  data,
}: {
  busy: boolean
  data: EvaluationSettingsPageData
}) {
  const [current, setCurrent] = useState(data)
  return (
    // The budget form posts to Hub, so the story saves the value itself instead.
    <div
      onSubmit={(event) => {
        event.preventDefault()
        const limit = new FormData(event.target).get("monthlyBudgetCredits")
        if (typeof limit !== "string") return
        setCurrent((value) => ({ ...value, budget: { ...value.budget, limitCredits: limit } }))
      }}
    >
      <RepositoryWorkspace data={workspace}>
        <EvaluationSettingsPage
          busy={busy}
          data={current}
          onChange={({ enabled, screenshots }) =>
            setCurrent((value) => ({
              ...value,
              evaluations: {
                ...value.evaluations,
                ...(enabled === undefined ? {} : { enabled }),
                ...(screenshots === undefined ? {} : { screenshotsAllowed: screenshots }),
              },
            }))
          }
        />
      </RepositoryWorkspace>
    </div>
  )
}

const meta = {
  title: "Hub/Pages/Learnings/Evaluation settings",
  component: EvaluationSettingsPage,
  parameters: { layout: "fullscreen" },
  args: { busy: false, data: settings, onChange: () => {} },
  render: ({ busy, data }) => <EvaluationSettingsStory busy={busy} data={data} />,
} satisfies Meta<typeof EvaluationSettingsPage>

export default meta
type Story = StoryObj<typeof meta>

export const HubAndRepositoryAdmin: Story = {}
export const RepositoryAdmin: Story = {
  args: { data: { ...settings, budget: { ...settings.budget, editable: false } } },
}
export const HubAdmin: Story = {
  args: {
    data: {
      ...settings,
      evaluations: {
        editable: false,
        enabled: false,
        screenshotsAllowed: false,
        screenshotsRecord: null,
      },
    },
  },
}
export const BudgetReached: Story = {
  args: { data: { ...settings, budget: { ...settings.budget, usedCredits: "100" } } },
}
export const BudgetNotSet: Story = {
  args: {
    data: {
      ...settings,
      budget: { limitCredits: "0", usedCredits: "0", editable: false },
      evaluations: { ...settings.evaluations, enabled: false, screenshotsAllowed: false },
    },
  },
}
