import { createRef } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { PublishChangesDialog } from "."

const meta = {
  title: "Components/Prototype canvas/Publish changes dialog",
  component: PublishChangesDialog,
  args: {
    busy: false,
    error: "",
    remembered: false,
    changes: {
      files: { paths: ["src/App.tsx", "src/components/Header.tsx"], total: 2 },
      localSkills: { paths: [".github/skills/replica-publish-prototype/SKILL.md"], total: 1 },
    },
    returnFocusRef: createRef<HTMLButtonElement>(),
    onClose: () => undefined,
    onChoose: () => undefined,
    onRetry: () => undefined,
  },
} satisfies Meta<typeof PublishChangesDialog>

export default meta
type Story = StoryObj<typeof meta>

export const UncommittedChanges: Story = {}
export const RememberedPreference: Story = {
  args: { remembered: true },
}
export const RequestFailed: Story = {
  args: { error: "The checkout changed while preparing to publish. Try again." },
}
export const CheckFailed: Story = {
  args: {
    changes: undefined,
    checkError:
      "Checking local changes took too long. Retry the check or publish the committed version only.",
  },
}
export const Publishing: Story = { args: { busy: true } }
export const RetryingCheck: Story = { args: { ...CheckFailed.args, busy: true } }
export const FilesOnly: Story = {
  args: {
    changes: {
      files: { paths: ["src/App.tsx"], total: 1 },
      localSkills: { paths: [], total: 0 },
    },
  },
}
export const LocalSkillsOnly: Story = {
  args: {
    changes: {
      files: { paths: [], total: 0 },
      localSkills: { paths: [".agents/skills/preview/SKILL.md"], total: 1 },
    },
  },
}
export const TruncatedChanges: Story = {
  args: {
    changes: {
      ...meta.args.changes,
      files: { paths: ["src/App.tsx", "src/components/Header.tsx"], total: 28 },
    },
  },
}
export const Dark: Story = { globals: { colorMode: "night" } }
