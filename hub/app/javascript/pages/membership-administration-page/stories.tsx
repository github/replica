import type { Meta, StoryObj } from "@storybook/react-vite"

import { MembershipAdministrationPage } from "."

const meta = {
  title: "Hub/Pages/Identity/Membership administration",
  component: MembershipAdministrationPage,
  parameters: { layout: "fullscreen" },
  args: {
    loading: false,
    error: null,
    memberships: [
      {
        id: "membership-1",
        role: "administrator",
        status: "active",
        user: {
          id: "user-1",
          displayName: "Mona Lisa",
          externalIdentities: [
            {
              id: "identity-1",
              provider: "github",
              issuer: "https://github.com",
              subject: "42",
              username: "mona",
            },
          ],
        },
      },
      {
        id: "membership-2",
        role: "member",
        status: "suspended",
        user: {
          id: "user-2",
          displayName: "Ada Lovelace",
          externalIdentities: [
            {
              id: "identity-2",
              provider: "oidc",
              issuer: "https://login.example",
              subject: "ada-1843",
              username: "ada",
            },
          ],
        },
      },
    ],
    invitations: [
      {
        id: "invitation-1",
        provider: "github",
        issuer: "https://github.com",
        subject: "99",
        role: "administrator",
        expiresAt: "2026-11-03T20:00:00.000Z",
        consumedAt: null,
        revokedAt: null,
      },
    ],
    onInvite: () => undefined,
    onChange: () => undefined,
    onRevokeInvitation: () => undefined,
    onSignIn: () => undefined,
    onSignOut: () => undefined,
  },
} satisfies Meta<typeof MembershipAdministrationPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
