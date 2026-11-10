import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  addHubAdministratorsData,
  hubAdministrationData,
} from "@/storybook/fixtures/hub-administration"

import { HubAdminsPage } from "."
import type { HubAdminsPageData } from "./types"

const octocat = {
  id: "11111111-1111-4111-8111-111111111111",
  provider: "github",
  login: "octocat",
  name: "The Octocat",
  identity: "GitHub account · Membership 11111111-1111-4111-8111-111111111111",
  role: "Hub administrator",
  actionLabel: "Remove administrator",
  confirmationPath: "/settings/administrators/11111111-1111-4111-8111-111111111111/revoke",
}

const data: HubAdminsPageData = {
  ...hubAdministrationData,
  pageTitle: "Hub administrators",
  emptyLabel: "No Hub administrators are available.",
  nextLabel: "Next page",
  nextPath: null,
  addLabel: "Add administrator",
  administratorsLabel: "0 administrators",
  addAdministrator: {
    ...addHubAdministratorsData,
    submitPath: "/api/administrators/authorizations/start",
    operation: "DESIGNATE_ADMINISTRATORS",
  },
  users: [],
}

const candidates = [
  {
    id: "00000000-0000-4000-8000-000000000003",
    provider: "github",
    login: "nova",
    name: "Nova Pixel",
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    provider: "entra",
    login: "luna",
    name: "Luna Sketch",
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    provider: "github",
    login: "atlas",
    name: "Atlas Bloom",
  },
  {
    id: "00000000-0000-4000-8000-000000000006",
    provider: "entra",
    login: "echo",
    name: "Echo Finch",
  },
  {
    id: "00000000-0000-4000-8000-000000000007",
    provider: "github",
    login: "pip",
    name: "Pip Willow",
  },
  {
    id: "00000000-0000-4000-8000-000000000008",
    provider: "entra",
    login: "sage",
    name: "Sage Cloud",
  },
  ...["Comet", "Doodle", "Ember", "Fable", "Glitter", "Nimbus", "Orbit", "Zenith"].flatMap(
    (first, firstIndex) =>
      ["Acorn", "Bubble", "Clover", "Drift", "Feather", "Pebble", "Sprout", "Wisp"].map(
        (last, lastIndex) => ({
          id: `00000000-0000-4000-8000-${String(9 + firstIndex * 8 + lastIndex).padStart(12, "0")}`,
          provider: firstIndex % 2 === 0 ? "github" : "entra",
          login: `${first}-${last}`.toLowerCase(),
          name: `${first} ${last}`,
        }),
      ),
  ),
].sort((a, b) => (a.login < b.login ? -1 : a.login > b.login ? 1 : a.id.localeCompare(b.id)))

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
          id: "22222222-2222-4222-8222-222222222222",
          provider: "entra",
          login: "mona",
          name: "Mona Lisa",
          identity: "Microsoft Entra account · Membership 22222222-2222-4222-8222-222222222222",
          role: "Hub administrator",
          actionLabel: "Remove administrator",
          confirmationPath: "/settings/administrators/22222222-2222-4222-8222-222222222222/revoke",
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
      authenticatedWorkspace: null,
      signedOut: true,
      addAdministrator: null,
      administratorsLabel: null,
      hubAdminsPath: null,
      sharingSettingsPath: null,
      githubAppPath: null,
      sessionRevocationPath: null,
      emptyLabel: "Administrator navigation has been removed from this session.",
      description:
        "Your account no longer has Hub administrator controls. Hub ended this browser session when the role changed.",
      notice: "Your Hub administrator access was removed and this session ended.",
      alert: null,
    },
  },
}
export const ProfileUnavailable: Story = {
  args: {
    data: {
      ...data,
      administratorsLabel: "1 administrator",
      users: [
        {
          ...octocat,
          provider: null,
          login: null,
          name: null,
          identity:
            "Provider profile unavailable · Membership 11111111-1111-4111-8111-111111111111",
        },
      ],
    },
  },
}
