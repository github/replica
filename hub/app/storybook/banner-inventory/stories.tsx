import { useState } from "react"

import { Button, Heading, Stack, Text } from "@primer/react-brand"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubAlert } from "@components/hub-alert"
import { WorkflowInstallation } from "@features/workflow-installation"
import type { WorkflowInstallationData } from "@features/workflow-installation/types"

const workflowCases: { label: string; data: WorkflowInstallationData }[] = [
  {
    label: "Missing workflow, repository writer",
    data: {
      actionLabel: "Open installation pull request",
      createPath: "/repositories/2001/workflow_installation",
      description: "Open a pull request that adds the Replica workflow for prototype branches.",
      heading: "Prototype workflow file missing",
      state: "installable",
    },
  },
  {
    label: "Different workflow, repository writer",
    data: {
      actionLabel: "Open workflow update pull request",
      createPath: "/repositories/2001/workflow_installation",
      description:
        "The Replica build Action has changed. Review a pull request that replaces the installed workflow with the latest version.",
      heading: "Build Action update available",
      state: "updatable",
    },
  },
  {
    label: "Missing workflow, no write access",
    data: {
      description: "A repository writer must install the Replica workflow.",
      documentationLabel: "Learn about the workflow",
      documentationUrl: "https://github.com/github/replica#prototype-build-workflow",
      heading: "Prototype workflow file missing",
      state: "requiresWriter",
    },
  },
  {
    label: "Different workflow, no write access",
    data: {
      description: "A repository writer must review the build Action update.",
      heading: "Build Action update available",
      state: "requiresWriter",
    },
  },
  {
    label: "Hub build action not configured",
    data: {
      description:
        "The Hub operator must configure the pinned Replica build action before this workflow can be installed.",
      heading: "Prototype workflow",
      state: "unavailable",
    },
  },
  {
    label: "Workflow check unavailable",
    data: {
      description: "Replica Hub could not check the repository workflow right now.",
      heading: "Prototype workflow",
      state: "unavailable",
    },
  },
]

const meta = {
  title: "Hub/Design/Banner inventory",
  parameters: { layout: "padded" },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const AllStates: Story = {
  render: function BannerInventoryStory() {
    const [showActionAlert, setShowActionAlert] = useState(true)

    return (
      <Stack gap="spacious" style={{ maxWidth: "52rem" }}>
        <Stack gap="condensed">
          <Heading as="h1" size="3">
            Banner inventory
          </Heading>

          <Text as="p">
            Repository workflow panels and alerts are separate components. Labels outside each panel
            describe the condition that displays it.
          </Text>
        </Stack>

        <section aria-labelledby="workflow-banners">
          <Stack gap="normal">
            <Heading as="h2" size="4" id="workflow-banners">
              Repository workflow
            </Heading>

            {workflowCases.map(({ label, data }) => (
              <Stack key={label} gap="condensed">
                <Text as="p" size="100">
                  {label}
                </Text>

                <div onSubmitCapture={(event) => event.preventDefault()}>
                  <WorkflowInstallation authenticityToken="storybook-token" data={data} />
                </div>
              </Stack>
            ))}
          </Stack>
        </section>

        <section aria-labelledby="alert-banners">
          <Stack gap="normal">
            <Heading as="h2" size="4" id="alert-banners">
              Alerts used in Hub
            </Heading>

            <Stack gap="condensed">
              <Text as="p" size="100">
                Access warning, compact
              </Text>

              <HubAlert
                variant="warning"
                layout="compact"
                title="Your GitHub account does not have access to this Hub's prototype repositories."
              />
            </Stack>

            <Stack gap="condensed">
              <Text as="p" size="100">
                Build failure, compact with detail
              </Text>

              <HubAlert
                variant="critical"
                layout="compact"
                title="Build failed"
                description="The repository workflow did not produce a valid prototype artifact."
              />
            </Stack>

            <Stack gap="condensed">
              <Text as="p" size="100">
                Comment failure
              </Text>

              <HubAlert
                variant="critical"
                title="The comment could not be saved. Review it and try again."
              />
            </Stack>
          </Stack>
        </section>

        <section aria-labelledby="alert-options">
          <Stack gap="normal">
            <Heading as="h2" size="4" id="alert-options">
              Other alert options
            </Heading>

            <Text as="p">
              These component states are available in Storybook, but are not currently used by the
              Hub pages above.
            </Text>

            <HubAlert variant="info" title="Comments are ready" />
            <HubAlert variant="success" title="Changes saved" />
            {showActionAlert ? (
              <HubAlert
                variant="warning"
                title="Repository access changed"
                action={<Button size="small">Review access</Button>}
                dismissLabel="Dismiss warning"
                onDismiss={() => setShowActionAlert(false)}
              />
            ) : null}
          </Stack>
        </section>
      </Stack>
    )
  },
}
