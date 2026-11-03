import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  authenticatedHubWorkspaceData,
  hubAdministrationData,
} from "@/storybook/fixtures/hub-administration"

import { BuildSettingsPage } from "."
import type { BuildSettingsPageData } from "./types"

const data: BuildSettingsPageData = {
  ...hubAdministrationData,
  administrationWorkspace: {
    ...hubAdministrationData.administrationWorkspace,
    selectedSection: "builds",
    administrationLinks: [
      ...(hubAdministrationData.administrationWorkspace.administrationLinks ?? []),
      { section: "builds", label: "Build packages", path: "/build_settings" },
    ],
  },
  heading: "Build packages",
  description:
    "Set the maximum unpacked size for future Build imports. Successful Builds and their previews stay unchanged.",
  accessDenied: false,
  emptyLabel: "Only Hub administrators can view or change the Build package limit.",
  maximumPackageMib: "150",
  limitLabel: "Maximum package size (MiB)",
  limitDescription:
    "Includes app files, screenshots, and package metadata. The default is 150 MiB. Raising this limit can increase storage and download usage.",
  submitPath: "/build_settings",
  submitLabel: "Save package limit",
  confirmLabel: "I confirm this deployment-wide change for future imports.",
  verification:
    "This change requires recent GitHub verification in this browser. Hub continues your confirmed change after verification.",
}

const meta = {
  title: "Hub/Pages/Settings/Build packages",
  component: BuildSettingsPage,
  parameters: { layout: "fullscreen" },
  args: { data },
} satisfies Meta<typeof BuildSettingsPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const InvalidLimit: Story = {
  args: {
    data: {
      ...data,
      alert:
        "Enter a positive whole number of MiB that fits in a signed 64-bit integer. No Build settings changed.",
    },
  },
}
export const AccessRemoved: Story = {
  args: {
    data: {
      ...hubAdministrationData,
      heading: data.heading,
      description: data.description,
      accessDenied: true,
      administrationWorkspace: null,
      authenticatedWorkspace: authenticatedHubWorkspaceData,
      emptyLabel: data.emptyLabel,
      alert: "Your account is not a current Hub administrator. No Build settings changed.",
    },
  },
}
