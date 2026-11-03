import { createRef } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { resolvePublication } from "@utils/resolve-prototype-publication"
import { publicationExamples } from "@utils/resolve-prototype-publication/fixtures"
import { resolveShareReadiness } from "@utils/resolve-prototype-share-readiness"
import { readinessCopy } from "@utils/resolve-prototype-share-readiness/en"
import { ShareReadinessDialog } from "."

function example(name: string) {
  const { state, hub } = publicationExamples[name]!
  return resolveShareReadiness(state, hub, resolvePublication(state, hub))
}

const meta = {
  title: "Prototype canvas/Share readiness dialog",
  component: ShareReadinessDialog,
  args: {
    readiness: example("Disconnected"),
    busy: false,
    shareButtonRef: createRef<HTMLButtonElement>(),
    onClose: () => undefined,
    onConnect: () => undefined,
    onPublish: () => undefined,
    onRetry: () => undefined,
    onManage: () => undefined,
  },
} satisfies Meta<typeof ShareReadinessDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Disconnected: Story = {}
export const Unpublished: Story = { args: { readiness: example("Unpublished branch") } }
const unpublished = publicationExamples["Unpublished branch"]!
const olderHub = {
  ...unpublished.hub!,
  canPublish: undefined,
  repositoryAuthorized: true,
  registrationReason: "remote_branch_missing",
}
export const OlderHubUnpublished: Story = {
  args: {
    readiness: resolveShareReadiness(
      unpublished.state,
      olderHub,
      resolvePublication(unpublished.state, olderHub),
    ),
  },
}
export const Importing: Story = { args: { readiness: example("Awaiting Hub import") } }
export const Failed: Story = { args: { readiness: example("Build failed") } }
export const VerificationError: Story = { args: { readiness: example("Remote check failed") } }
export const ReadOnly: Story = { args: { readiness: example("Write access required") } }
export const Checking: Story = { args: { readiness: example("Loading") } }
export const Ready: Story = {
  args: {
    readiness: { kind: "ready", title: readinessCopy.ready, detail: readinessCopy.readyDetail },
  },
}
export const WaitingForCopilot: Story = { args: { readiness: example("Waiting for Copilot") } }
export const Queued: Story = { args: { readiness: example("Build queued") } }
export const Building: Story = { args: { readiness: example("Building") } }
export const AwaitingBuild: Story = { args: { readiness: example("Awaiting build") } }
export const Registering: Story = { args: { readiness: example("Automatic publication") } }
export const RegistrationFailed: Story = {
  args: { readiness: example("Automatic publication failed") },
}
export const CheckoutChanged: Story = {
  args: {
    readiness: {
      kind: "restricted",
      title: readinessCopy.changed,
      detail: readinessCopy.changedDetail,
    },
  },
}
export const Busy: Story = { args: { readiness: example("Unpublished branch"), busy: true } }
export const DetachedCheckout: Story = { args: { readiness: example("Detached checkout") } }
export const MissingWorkflow: Story = { args: { readiness: example("Workflow missing") } }
export const HubUnavailable: Story = { args: { readiness: example("Hub unavailable") } }
export const HubAccessDenied: Story = { args: { readiness: example("Hub access denied") } }
export const DefaultBranch: Story = { args: { readiness: example("Default branch") } }
export const BranchAuthorshipRequired: Story = {
  args: { readiness: example("Branch authorship required") },
}
export const RepositoryMismatch: Story = { args: { readiness: example("Repository mismatch") } }
export const AlreadyRegistered: Story = { args: { readiness: example("Already registered") } }
export const LocalRepository: Story = {
  args: {
    readiness: resolveShareReadiness(
      publicationExamples["Published"]!.state,
      { ...publicationExamples["Published"]!.hub!, discovery: { state: "local" } },
      resolvePublication(
        publicationExamples["Published"]!.state,
        publicationExamples["Published"]!.hub,
      ),
    ),
  },
}
