import type { Meta, StoryObj } from "@storybook/react-vite"

import { authenticatedHubWorkspaceData } from "@/storybook/fixtures/hub-administration"

import { NotificationSettingsPage } from "."
import type { NotificationSettingsPageData } from "./types"

const data: NotificationSettingsPageData = {
  ...authenticatedHubWorkspaceData,
  notificationSettings: { label: "Notifications", path: "/notification_settings" },
  heading: "Notifications",
  description: "Choose which review updates reach you outside Hub. Your Inbox stays unchanged.",
  enabled: true,
  enabledLabel: "Receive hourly Slack digests",
  explanation: "Digests include comment previews and links to conversations you can access.",
  privacy: "Text already delivered outside Hub may remain there after deletion or loss of access.",
  pausedMessage: null,
  submitPath: "/notification_settings",
  saveLabel: "Save preferences",
  mutedHeading: "Muted prototypes",
  mutedEmpty:
    "You have not muted any prototypes. Use a prototype's More actions menu to mute its external notifications.",
  prototypeExplanation:
    "Muting stops all external updates for that prototype, including mentions, for you only.",
  mutes: [],
  administration: null,
}

const mute = {
  id: 1,
  repository: "github/prototype",
  prototype: "Welcome",
  path: "/repositories/2001/prototypes/1",
  submitPath: "/repositories/2001/prototypes/1/notification_mute",
  unmuteLabel: "Unmute",
}

const meta = {
  title: "Hub/Pages/Notification settings",
  component: NotificationSettingsPage,
  parameters: { layout: "fullscreen" },
  args: { data },
  decorators: [
    (Story) => (
      <div onSubmit={(event) => event.preventDefault()}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NotificationSettingsPage>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}
export const Single: Story = { args: { data: { ...data, mutes: [mute] } } }
export const Multiple: Story = {
  args: {
    data: {
      ...data,
      enabled: false,
      mutes: [
        mute,
        {
          ...mute,
          id: 2,
          prototype: "Review conversations",
          path: "/repositories/2001/prototypes/2",
          submitPath: "/repositories/2001/prototypes/2/notification_mute",
        },
      ],
    },
  },
}
export const Administrator: Story = {
  args: {
    data: {
      ...data,
      pausedMessage:
        "External delivery is turned off for this Hub. Your personal preferences are saved.",
      administration: {
        heading: "Hub delivery",
        description:
          "Turn external notifications on or off for everyone. Turning them off cancels pending digests.",
        status: "External delivery is off",
        submitPath: "/notification_delivery_setting",
        operation: "enable",
        submitLabel: "Turn on for everyone",
        confirmLabel:
          "I understand this changes external notification delivery for everyone using this Hub.",
        failureMessage:
          "2 delivery items need attention. Check the sanitized delivery failure codes in the server logs or database.",
      },
    },
  },
}
export const SaveFailure: Story = {
  args: {
    data: { ...data, alert: "Notification preferences could not be saved. Try again." },
  },
}
