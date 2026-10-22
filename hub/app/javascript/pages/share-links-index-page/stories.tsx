import type { Meta, StoryObj } from "@storybook/react-vite"

import { prototypeWorkspaceData } from "@/storybook/fixtures/prototype-workspace"

import { ShareLinksIndexPage } from "."
import type { ShareLinksIndexPageData } from "./types"

const shareLink = {
  buildLabel: "Build 1",
  createdAt: "2026-09-15T12:00:00Z",
  createdLabel: "Created by @octocat",
  deletePath: "/repositories/2001/prototypes/1/share_links/1",
  deletePrompt: "Delete “Usability review”?",
  expiresAt: "2026-09-22T12:00:00Z",
  expiresLabel: "Expires September 22",
  id: 1,
  label: "Usability review",
  url: "https://replica.example/share/12345678-1234-1234-1234-123456789abc",
}

const data: ShareLinksIndexPageData = {
  ...prototypeWorkspaceData,
  alert: null,
  closePath: "/repositories/2001/prototypes/1",
  copyErrorLabel: "Copy failed",
  copiedLabel: "Copied",
  copyLabel: "Copy link",
  deleteLabel: "Delete link",
  description:
    "Anyone with a link can view this Build without signing in. The prototype may expose sensitive or customer information. Check its content before creating a public link.",
  emptyHeading: "No active share links",
  emptyLabel: "Create a link when someone needs signed-out access.",
  form: {
    buildLabel: "Build 1",
    createPath: "/repositories/2001/prototypes/1/share_links",
    expirationLabel: "Expires after",
    expirationOptions: [
      { label: "1 day", value: "one_day" },
      { label: "7 days", value: "seven_days" },
    ],
    labelLabel: "Label",
    labelMaximumBytes: 100,
    labelPlaceholder: "Usability review",
    submitLabel: "Create share link",
  },
  heading: "Share links",
  noBuildHeading: "No successful Build",
  noBuildLabel: "A successful Build is required before creating a share link.",
  notice: null,
  openLabel: "Open",
  pageTitle: "Share links",
  shareLinksLabel: "Share links",
  shareLinksPath: "/repositories/2001/prototypes/1/share_links",
  shareLinks: [],
  publicSharingEnabled: true,
  disabledLabel:
    "Public sharing is disabled for this Hub. No public links can be created or opened. A Hub administrator must explicitly enable sharing; previously revoked links never return.",
}

const meta = {
  title: "Hub/Pages/Share Links",
  component: ShareLinksIndexPage,
  args: { data },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ShareLinksIndexPage>

export default meta
type Story = StoryObj<typeof meta>

export const NoBuild: Story = {
  args: {
    data: {
      ...data,
      buildOptions: [],
      closePath: "/repositories/2001/prototypes/1",
      selectedBuild: undefined,
      shareLinksLabel: undefined,
      shareLinksPath: undefined,
    },
  },
}

export const Empty: Story = {}
export const MandatorySevenDayMaximum: Story = {
  args: {
    data: {
      ...data,
      form: {
        ...data.form,
        expirationOptions: data.form.expirationOptions.filter((option) =>
          ["one_day", "seven_days"].includes(option.value),
        ),
      },
    },
  },
}

export const ThirtyDayMaximum: Story = {
  args: {
    data: {
      ...data,
      form: {
        ...data.form,
        expirationOptions: [
          ...data.form.expirationOptions,
          { label: "30 days", value: "thirty_days" },
        ],
      },
    },
  },
}

export const SharingDisabled: Story = {
  args: { data: { ...data, publicSharingEnabled: false } },
}

export const Single: Story = {
  args: {
    data: { ...data, shareLinks: [shareLink] },
  },
}

export const Multiple: Story = {
  args: {
    data: {
      ...data,
      shareLinks: [
        shareLink,
        {
          ...shareLink,
          id: 2,
          label: "Partner review",
          url: "https://replica.example/share/87654321-4321-4321-4321-cba987654321",
        },
      ],
    },
  },
}

export const Error: Story = {
  args: {
    data: {
      ...data,
      alert: "The share link could not be created.",
      shareLinks: [shareLink],
    },
  },
}

export const AuthorizationSucceeded: Story = {
  args: {
    data: {
      ...data,
      notice:
        "GitHub authorization succeeded for this connection only. Return to the action and submit it again within five minutes.",
    },
  },
}

export const AccessChanged: Story = {
  args: {
    data: {
      ...data,
      alert:
        "Repository access changed during this request. No link was created. Refresh and check your current access before trying again.",
    },
  },
}

export const PolicyChanged: Story = {
  args: {
    data: {
      ...data,
      alert:
        "Sharing policy changed during this request. No link was created. Refresh and review the current sharing policy before trying again.",
    },
  },
}
