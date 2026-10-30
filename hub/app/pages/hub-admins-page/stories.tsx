import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  authenticatedHubWorkspaceData,
  addHubAdministratorsData,
  hubAdministrationData,
} from "@/storybook/fixtures/hub-administration"

import { HubAdminsPage } from "."
import type { HubAdminsPageData } from "./types"

const octocat = {
  id: 1,
  login: "octocat",
  name: "The Octocat",
  identity: "GitHub identity 1001 - Hub user 1",
  role: "Hub administrator",
  actionLabel: "Remove administrator",
  confirmationPath: "/hub_admins/1/edit",
}

const data: HubAdminsPageData = {
  ...hubAdministrationData,
  pageTitle: "Hub administrators",
  emptyLabel: "No Hub administrators are available.",
  nextLabel: "Next page",
  nextPath: null,
  addLabel: "Add administrator",
  administratorsLabel: "0 administrators",
  addAdministrator: addHubAdministratorsData,
  users: [],
}

const candidates = [
  { id: 3, login: "nova", name: "Nova Pixel" },
  { id: 4, login: "luna", name: "Luna Sketch" },
  { id: 5, login: "atlas", name: "Atlas Bloom" },
  { id: 6, login: "echo", name: "Echo Finch" },
  { id: 7, login: "pip", name: "Pip Willow" },
  { id: 8, login: "sage", name: "Sage Cloud" },
  ...["Comet", "Doodle", "Ember", "Fable", "Glitter", "Nimbus", "Orbit", "Zenith"].flatMap(
    (first, firstIndex) =>
      ["Acorn", "Bubble", "Clover", "Drift", "Feather", "Pebble", "Sprout", "Wisp"].map(
        (last, lastIndex) => ({
          id: 9 + firstIndex * 8 + lastIndex,
          login: `${first}-${last}`.toLowerCase(),
          name: `${first} ${last}`,
        }),
      ),
  ),
].sort((a, b) => (a.login < b.login ? -1 : a.login > b.login ? 1 : a.id - b.id))

const meta = {
  title: "Hub/Pages/Security/Hub administrators",
  component: HubAdminsPage,
  parameters: { layout: "fullscreen" },
  args: {
    data,
    onSearch: (query) => {
      const search = query.trim().slice(0, 100).toLowerCase()
      const matches = candidates.filter(
        (user) =>
          user.login.toLowerCase().includes(search) || user.name.toLowerCase().includes(search),
      )
      return Promise.resolve({ users: matches.slice(0, 50), more: matches.length > 50 })
    },
  },
  decorators: [
    (Story) => (
      <div onSubmit={(event) => event.preventDefault()}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HubAdminsPage>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}
export const Single: Story = {
  args: { data: { ...data, administratorsLabel: "1 administrator", users: [octocat] } },
}
export const Multiple: Story = {
  args: {
    data: {
      ...data,
      administratorsLabel: "2 administrators",
      users: [
        octocat,
        {
          id: 2,
          login: "mona",
          name: "Mona Lisa",
          identity: "GitHub identity 1002 - Hub user 2",
          role: "Hub administrator",
          actionLabel: "Remove administrator",
          confirmationPath: "/hub_admins/2/edit",
        },
      ],
    },
  },
}
export const Denied: Story = {
  args: {
    data: {
      ...data,
      administratorsLabel: "1 administrator",
      users: [octocat],
      alert:
        "This user's role already changed. Review their current role and confirm again. No role changes were made.",
    },
  },
}
export const AccessRemoved: Story = {
  args: {
    data: {
      ...data,
      auditPath: null,
      administrationWorkspace: null,
      addAdministrator: null,
      administratorsLabel: null,
      authenticatedWorkspace: authenticatedHubWorkspaceData,
      hubAdminsPath: null,
      sharingSettingsPath: null,
      githubAppPath: null,
      sessionRevocationPath: null,
      emptyLabel:
        "Your GitHub repository permissions are unchanged. Hub administrator controls and deployment security records are not available to this account.",
      alert: "Your account is no longer a Hub administrator. No role changes were made.",
    },
  },
}
