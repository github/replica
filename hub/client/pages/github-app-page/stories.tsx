import type { Meta, StoryObj } from "@storybook/react-vite"

import { hubAdministrationData } from "@/storybook/fixtures/hub-administration"
import { signedInWorkspace } from "@/storybook/fixtures/signed-in-workspace"

import { GithubAppPage } from "."
import type { GithubAppPageData } from "./types"

const data: GithubAppPageData = {
  ...hubAdministrationData,
  administrationWorkspace: { ...signedInWorkspace, selectedSection: "github" },
  pageTitle: "GitHub App",
  heading: "GitHub App",
  description: "Design reference only. Hub no longer offers these GitHub App settings.",
  configurationId: 1,
  version: 0,
  identity: "App 123 - github (Organization, identity 321)",
  installation: "Installation 456: active",
  busyLabel: null,
  verification: "",
  paragraphs: ["Only the current webhook secret is accepted."],
  links: [],
  form: null,
}

const meta = {
  title: "Hub/Design/Legacy GitHub App/Settings",
  component: GithubAppPage,
  parameters: { layout: "fullscreen" },
  args: { data },
} satisfies Meta<typeof GithubAppPage>

export default meta
type Story = StoryObj<typeof meta>

export const DesignReference: Story = {}
