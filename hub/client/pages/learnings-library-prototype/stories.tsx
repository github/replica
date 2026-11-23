import type { Meta, StoryObj } from "@storybook/react-vite"

import { RepositoryWorkspace } from "@features/repository-workspace"
import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"
import { authenticatedHeaderData } from "@/storybook/fixtures/authenticated-header"
import { githubEmpty, githubPrototype } from "@/storybook/fixtures/repositories"

import { LearningsLibraryPrototype } from "."
import type { LearningActivityDay, LearningRecord, LearningsLibraryPrototypeData } from "./types"

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

const learnings = [
  {
    id: "visible-form-labels",
    title: "Label every form field",
    guidance:
      "Give every input a visible label that stays in place after someone starts typing. Do not rely on placeholder text as the only label.",
    status: "suggested",
    topic: "Accessibility",
    reviewerCount: 3,
    prototypeCount: 2,
    updatedAt: "2026-11-18T17:20:00Z",
    evidence: [
      {
        id: "evidence-1",
        body: "The email field has no label. Its placeholder disappears as soon as I type.",
        authorLogin: "mona",
        prototypeName: "Signup flow",
        buildNumber: 4,
        createdAt: "2026-11-18T17:20:00Z",
        reviewPath: "/repositories/2001/prototypes/13?build=4&comment=104",
        stance: "supports",
      },
      {
        id: "evidence-2",
        body: "Screen readers announce this card number input as an unnamed edit field.",
        authorLogin: "hubot",
        prototypeName: "Checkout",
        buildNumber: 2,
        createdAt: "2026-11-17T14:05:00Z",
        reviewPath: "/repositories/2001/prototypes/17?build=2&comment=131",
        stance: "supports",
      },
      {
        id: "evidence-3",
        body: "This form is short enough that the placeholder is clear to me.",
        authorLogin: "octocat",
        prototypeName: "Signup flow",
        buildNumber: 4,
        createdAt: "2026-11-16T10:42:00Z",
        reviewPath: "/repositories/2001/prototypes/13?build=4&comment=109",
        stance: "opposes",
      },
    ],
  },
  {
    id: "clear-primary-actions",
    title: "Make the primary action easy to spot",
    guidance:
      "Use one primary button for the main action in a form, and label it with the result it produces.",
    status: "active",
    topic: "Visual hierarchy",
    reviewerCount: 4,
    prototypeCount: 3,
    updatedAt: "2026-11-12T09:30:00Z",
    acceptedBy: "mona",
    evidence: [
      {
        id: "evidence-4",
        body: "Both buttons look equally important, so I cannot tell which one saves my changes.",
        authorLogin: "hubot",
        prototypeName: "Profile settings",
        buildNumber: 7,
        createdAt: "2026-11-12T09:30:00Z",
        reviewPath: "/repositories/2001/prototypes/22?build=7&comment=201",
        stance: "supports",
      },
    ],
  },
  {
    id: "icon-only-actions",
    title: "Use icons without labels",
    guidance: "Replace text labels with familiar icons to keep action bars compact.",
    status: "rejected",
    topic: "Navigation",
    reviewerCount: 2,
    prototypeCount: 2,
    updatedAt: "2026-11-09T15:10:00Z",
    rejectionReason:
      "The reviewers found that people could not tell what the icons did without labels.",
    evidence: [
      {
        id: "evidence-5",
        body: "I could not tell whether this icon saves, shares, or closes the panel.",
        authorLogin: "mona",
        prototypeName: "Project overview",
        buildNumber: 3,
        createdAt: "2026-11-09T15:10:00Z",
        reviewPath: "/repositories/2001/prototypes/24?build=3&comment=246",
        stance: "supports",
      },
    ],
  },
] satisfies [LearningRecord, LearningRecord, LearningRecord]

/**
 * Builds weekday runs from Jan 1 to the story's today, with a few skipped days and one
 * failed run so the year grid shows the states people will meet.
 */
function createActivity(): LearningActivityDay[] {
  const dayMilliseconds = 24 * 60 * 60 * 1000
  const start = Date.UTC(2026, 0, 1)
  const end = Date.UTC(2026, 10, 20)
  const days: LearningActivityDay[] = []
  for (let time = start, index = 0; time <= end; time += dayMilliseconds, index += 1) {
    const weekday = new Date(time).getUTCDay()
    if (weekday === 0 || weekday === 6 || index % 9 === 4) continue
    const date = new Date(time).toISOString().slice(0, 10)
    const failed = date === "2026-10-19"
    days.push({
      date,
      runState: failed ? "failed" : "succeeded",
      startedAt: `${date}T16:30:00Z`,
      startedBy: index % 10 === 3 ? "@mona" : "Daily schedule",
      commentsAnalyzed: 2 + ((index * 7) % 13),
      commentsTagged: failed ? 0 : (index * 5) % 6,
      suggestions: failed || index % 4 ? 0 : 1 + (index % 3),
    })
  }
  return days
}

const generatedPatterns = [
  {
    title: "Explain why an action is unavailable",
    guidance: "When a button is disabled, say what someone needs to do to enable it.",
    topic: "Content",
  },
  {
    title: "Confirm before deleting work",
    guidance: "Ask for confirmation before removing anything that cannot be restored.",
    topic: "Safety",
  },
  {
    title: "Keep error messages next to the field",
    guidance: "Show each validation error beside the field it belongs to.",
    topic: "Forms",
  },
  {
    title: "Show progress for long tasks",
    guidance: "Show progress for any task that takes more than a few seconds.",
    topic: "Feedback",
  },
  {
    title: "Preview changes before saving",
    guidance: "Let people see the result of a change before they commit to it.",
    topic: "Forms",
  },
  {
    title: "Group related settings",
    guidance: "Put settings that change the same thing under one heading.",
    topic: "Information architecture",
  },
]

const generatedAreas = [
  "checkout",
  "signup",
  "billing",
  "profile settings",
  "search",
  "notifications",
  "file uploads",
  "team settings",
  "onboarding",
  "project overview",
  "reports",
  "integrations",
  "access requests",
  "dashboards",
  "comments",
  "releases",
  "audit log",
]

/** Creates enough learnings in every status to need more than one page. */
function createManyLearnings(): LearningRecord[] {
  const combinations = generatedAreas.flatMap((area) =>
    generatedPatterns.map((pattern) => ({ area, pattern })),
  )
  return combinations.map(({ area, pattern }, index) => {
    const updatedAt = new Date(Date.UTC(2026, 10, 20, 17) - index * 9 * 60 * 60 * 1000)
      .toISOString()
      .replace(".000", "")
    const status: LearningRecord["status"] =
      index < 60 ? "suggested" : index < 90 ? "active" : "rejected"
    return {
      id: `generated-learning-${index + 1}`,
      title: `${pattern.title} in ${area}`,
      guidance: pattern.guidance,
      status,
      topic: pattern.topic,
      reviewerCount: 2 + (index % 4),
      prototypeCount: 1 + (index % 3),
      updatedAt,
      ...(status === "active" ? { acceptedBy: "mona" } : {}),
      ...(status === "rejected"
        ? { rejectionReason: "Reviewers preferred the existing pattern for this flow." }
        : {}),
      evidence: [
        {
          id: `generated-evidence-${index + 1}`,
          body: `I expected the ${area} prototype to ${pattern.title.toLowerCase()}.`,
          authorLogin: index % 2 ? "hubot" : "octocat",
          prototypeName: area.charAt(0).toUpperCase() + area.slice(1),
          buildNumber: 1 + (index % 5),
          createdAt: updatedAt,
          reviewPath: `/repositories/2001/prototypes/${30 + index}?build=1&comment=${500 + index}`,
          stance: "supports",
        },
      ],
    }
  })
}

const data: LearningsLibraryPrototypeData = {
  canDecide: true,
  learnings: [...learnings],
  activity: createActivity(),
  today: "2026-11-20",
}

function StoryPage({ data }: { data: LearningsLibraryPrototypeData }) {
  return (
    <RepositoryWorkspace data={workspace}>
      <LearningsLibraryPrototype data={data} />
    </RepositoryWorkspace>
  )
}

const meta = {
  title: "Hub/Pages/Learnings Library",
  component: LearningsLibraryPrototype,
  parameters: { layout: "fullscreen" },
  args: { data },
  render: (args) => <StoryPage {...args} />,
} satisfies Meta<typeof LearningsLibraryPrototype>

export default meta
type Story = StoryObj<typeof meta>

export const Multiple: Story = {}

export const RepositoryMember: Story = {
  args: {
    data: { ...data, canDecide: false },
  },
}

export const Single: Story = {
  args: {
    data: { ...data, learnings: [learnings[0]] },
  },
}

export const ManyLearnings: Story = {
  args: {
    data: { ...data, learnings: createManyLearnings() },
  },
}

export const Empty: Story = {
  args: {
    data: { ...data, learnings: [], activity: [] },
  },
}

export const FailedRun: Story = {
  args: {
    data: {
      ...data,
      activity: data.activity.map((day, index) =>
        index === data.activity.length - 1
          ? {
              ...day,
              runState: "failed" as const,
              suggestions: 0,
            }
          : day,
      ),
    },
  },
}

export const RejectedLearning: Story = {
  args: {
    data: { ...data, learnings: [learnings[2]] },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Rejected/ }))
    await userEvent.click(canvas.getByRole("button", { name: "Use icons without labels" }))
  },
}

export const LearningDetails: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Label every form field" }))
  },
}

export const EditingLearning: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Label every form field" }))
    await userEvent.click(canvas.getByRole("button", { name: "Edit learning" }))
  },
}
