import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { PublishSettings } from "."

import "../prototype-canvas-hub-panel/styles.css"

const meta = {
  title: "Components/Prototype canvas/Publish settings",
  component: PublishSettings,
  args: {
    preference: {
      remember: false,
      loading: false,
      saving: false,
      error: "",
      save: () => Promise.resolve(),
      retry: () => Promise.resolve(),
    },
  },
  render: function SettingsStory({ preference }) {
    const [remember, setRemember] = useState(preference.remember)
    return (
      <div style={{ width: "20rem", maxWidth: "100%" }}>
        <PublishSettings
          preference={{
            ...preference,
            remember,
            save: (value) => {
              setRemember(value)
              return Promise.resolve()
            },
          }}
        />
      </div>
    )
  },
} satisfies Meta<typeof PublishSettings>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Enabled: Story = { args: { preference: { ...meta.args.preference, remember: true } } }
export const Loading: Story = {
  args: { preference: { ...meta.args.preference, remember: null, loading: true } },
}
export const Saving: Story = { args: { preference: { ...meta.args.preference, saving: true } } }
export const SaveFailed: Story = {
  args: { preference: { ...meta.args.preference, error: "Settings storage is unavailable." } },
}
