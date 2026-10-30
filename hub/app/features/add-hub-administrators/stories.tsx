import type { Meta, StoryObj } from "@storybook/react-vite"

import { addHubAdministratorsData } from "@/storybook/fixtures/hub-administration"

import { AddHubAdministrators } from "."
import type { HubAdministratorSearchResults } from "./types"

const meta = {
  title: "Hub/Features/Hub Administrators/Add administrators",
  component: AddHubAdministrators,
  parameters: { layout: "fullscreen" },
  args: {
    data: addHubAdministratorsData,
    authenticityToken: "storybook-token",
    onClose: () => undefined,
    onSearch: (query): Promise<HubAdministratorSearchResults> =>
      Promise.resolve({
        users: [
          { id: 1, login: "octocat", name: "The Octocat" },
          { id: 2, login: "mona", name: "Mona Lisa" },
        ].filter((user) =>
          `${user.login} ${user.name}`.toLowerCase().includes(query.toLowerCase()),
        ),
        more: false,
      }),
  },
  decorators: [
    (Story) => (
      <div onSubmit={(event) => event.preventDefault()}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AddHubAdministrators>

export default meta
type Story = StoryObj<typeof meta>

export const Multiple: Story = {}
export const Single: Story = {
  args: {
    onSearch: () =>
      Promise.resolve({ users: [{ id: 2, login: "mona", name: "Mona Lisa" }], more: false }),
  },
}
export const Empty: Story = {
  args: { onSearch: () => Promise.resolve({ users: [], more: false }) },
}
export const SearchFailed: Story = {
  args: {
    onSearch: () => Promise.reject(new Error("Search unavailable")),
  },
}
export const Loading: Story = {
  args: { onSearch: () => new Promise(() => undefined) },
}
