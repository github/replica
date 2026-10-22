import { createRef, useState, type ComponentProps } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { ShareLinksPage } from "."
import { shareCopy } from "@hooks/use-canvas-share-links/en"
import type { ShareLink, SharingState } from "@hooks/use-canvas-share-links/types"

const createdAt = new Date()
const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000)

const link: ShareLink = {
  id: 1,
  url: "https://replica.example/share/12345678-1234-1234-1234-123456789abc",
  buildNumber: 1,
  label: "Usability review",
  expiresAt: expiresAt.toISOString(),
  createdAt: createdAt.toISOString(),
  createdBy: { login: "octocat", name: "The Octocat" },
}

const state: SharingState = {
  open: true,
  context: {
    target: "fixture",
    repository: "github/prototype",
    branch: "prototype/welcome",
    hubOrigin: "https://replica.example",
    prototype: {
      id: 1,
      repositoryId: 2001,
      branch: "prototype/welcome",
      name: "Welcome",
      description: null,
      viewerLogin: "octocat",
      registered: true,
      canEdit: true,
      canManageShareLinks: true,
      shareLinkExpirationOptions: ["one_day", "seven_days"],
      canRegister: true,
      published: true,
      buildState: "successful",
      versionCount: 2,
      build: {
        number: 2,
        commitSha: "a".repeat(40),
        publishedAt: "2026-10-05T07:00:00Z",
        url: "https://replica.example/repositories/2001/prototypes/1?build=2",
        author: { login: "octocat", name: "The Octocat", avatarUrl: null },
      },
    },
  },
  links: [],
  loading: false,
  busy: false,
  stale: false,
  error: "",
  notice: "",
  created: null,
}

const meta = {
  title: "Components/Prototype canvas/Share links page",
  component: ShareLinksPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh", width: "100%" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    state,
    currentCommit: "a".repeat(40),
    shareButtonRef: createRef<HTMLButtonElement>(),
    onClose: () => undefined,
    onRefresh: () => undefined,
    onCreate: () => Promise.resolve(false),
    onDelete: () => Promise.resolve(false),
    onOpen: () => undefined,
  },
} satisfies Meta<typeof ShareLinksPage>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}
export const ThirtyDayMaximum: Story = {
  args: {
    state: {
      ...state,
      context: {
        ...state.context!,
        prototype: {
          ...state.context!.prototype,
          shareLinkExpirationOptions: ["one_day", "seven_days", "thirty_days"],
        },
      },
    },
  },
}
export const InternalOnly: Story = {
  args: {
    state: {
      ...state,
      context: {
        ...state.context!,
        prototype: { ...state.context!.prototype, canEdit: false, canManageShareLinks: false },
      },
    },
  },
}
export const InternalUrlUnavailable: Story = {
  args: {
    state: {
      ...state,
      context: {
        ...state.context!,
        prototype: {
          ...state.context!.prototype,
          build: { ...state.context!.prototype.build!, url: "" },
        },
      },
    },
  },
}
export const SharingDisabled: Story = {
  args: {
    state: {
      ...state,
      sharingDisabled: true,
      stale: true,
      links: [link],
      created: link,
    },
  },
}
export const PolicyChanged: Story = {
  args: {
    state: {
      ...state,
      sharingDisabled: true,
      stale: true,
      error:
        "Sharing policy changed during this request. No link was created. Refresh and review the current sharing policy before trying again.",
    },
  },
}
export const AccessChanged: Story = {
  args: {
    state: {
      ...state,
      stale: true,
      error:
        "Repository access changed during this request. No link was created. Refresh and check your current access before trying again.",
    },
  },
}
export const Single: Story = { args: { state: { ...state, links: [link] } } }
export const TwoBuilds: Story = {
  render: (args) => <ControlSettingsPreview {...args} />,
  args: {
    buildDetails: {
      1: {
        commitSha: "b".repeat(40),
        author: "octocat",
        publishedAt: "2026-10-04T08:00:00Z",
      },
      2: {
        commitSha: "a".repeat(40),
        author: "octocat",
        publishedAt: "2026-10-05T07:00:00Z",
      },
    },
    state: {
      ...state,
      links: [
        {
          ...link,
          id: 2,
          buildNumber: 2,
          label: "Stakeholder review",
          url: "https://replica.example/share/12345678-1234-1234-1234-123456789abd",
        },
        link,
      ],
    },
  },
}
export const Multiple: Story = {
  args: {
    state: {
      ...state,
      links: [
        { ...link, id: 2, buildNumber: 2 },
        link,
        {
          ...link,
          id: 3,
          label: "Long review label for prototype stakeholders and accessibility testing",
        },
      ],
    },
  },
}
export const ManyLinks: Story = {
  args: {
    state: {
      ...state,
      links: Array.from({ length: 30 }, (_, index) => ({
        ...link,
        id: index + 1,
        label: `Usability review ${index + 1}`,
      })),
    },
  },
}
export const PreviousBuild: Story = {
  args: { currentCommit: "b".repeat(40), state: { ...state, links: [link] } },
}
function ControlSettingsPreview(props: ComponentProps<typeof ShareLinksPage>) {
  const [included, setIncluded] = useState(props.controlSettings?.included ?? false)
  return (
    <ShareLinksPage
      {...props}
      controlSettings={{
        ...props.controlSettings,
        included,
        query: "rc.page.title=%22Configured%22",
        onChange: setIncluded,
      }}
    />
  )
}

export const ControlSettings: Story = {
  args: { currentCommit: "b".repeat(40), state: { ...state, links: [link] } },
  render: (args) => <ControlSettingsPreview {...args} />,
}
export const ControlSettingsWarning: Story = {
  args: {
    currentCommit: "b".repeat(40),
    state: { ...state, links: [link] },
    controlSettings: { included: true, onChange: () => undefined },
  },
  render: (args) => <ControlSettingsPreview {...args} />,
}
export const ControlSettingsMatchingBuild: Story = {
  args: {
    state: { ...state, links: [link] },
    controlSettings: { included: true, onChange: () => undefined },
  },
  render: (args) => <ControlSettingsPreview {...args} />,
}
export const ControlSettingsUncommittedChanges: Story = {
  args: {
    hasLocalChanges: true,
    state: { ...state, links: [link] },
    controlSettings: { included: true, onChange: () => undefined },
  },
  render: (args) => <ControlSettingsPreview {...args} />,
}
export const ControlSettingsUnknownStatus: Story = {
  args: {
    currentCommit: undefined,
    state: { ...state, links: [link] },
    controlSettings: { included: true, onChange: () => undefined },
  },
  render: (args) => <ControlSettingsPreview {...args} />,
}
export const Loading: Story = { args: { state: { ...state, loading: true, stale: true } } }
export const Failed: Story = {
  args: { state: { ...state, stale: true, error: "Hub returned HTTP 503.", links: [link] } },
}
export const UnknownOutcome: Story = {
  args: { state: { ...state, stale: true, error: shareCopy.unknown } },
}
export const FreshAuthorizationRequired: Story = {
  args: {
    state: {
      ...state,
      stale: true,
      error:
        "Fresh GitHub authorization is required. No changes were made. Verify your account, then submit the action again.",
      authorization: {
        url: "https://replica.example/authorization/12345678-1234-1234-1234-123456789abc",
        expiresAt: "2026-10-05T23:00:00Z",
      },
    },
    onAuthorize: () => undefined,
  },
}
export const Creating: Story = { args: { state: { ...state, busy: true, links: [link] } } }
export const Created: Story = {
  args: { state: { ...state, links: [link], created: link } },
}
export const Disconnected: Story = {
  args: {
    state: { ...state, context: null, stale: true, error: shareCopy.disconnected },
    onConnect: () => undefined,
  },
}
export const NoBuild: Story = {
  args: {
    state: {
      ...state,
      context: {
        ...state.context!,
        prototype: { ...state.context!.prototype, published: false, build: null },
      },
    },
  },
}
export const InsufficientPermission: Story = {
  args: {
    state: {
      ...state,
      context: {
        ...state.context!,
        prototype: { ...state.context!.prototype, canManageShareLinks: false },
      },
    },
  },
}

export const PermissionUnknown: Story = {
  args: {
    state: {
      ...state,
      context: {
        ...state.context!,
        prototype: { ...state.context!.prototype, canManageShareLinks: undefined },
      },
    },
  },
}
export const ExpiredLink: Story = {
  args: {
    state: { ...state, links: [{ ...link, expiresAt: "2020-01-01T00:00:00Z" }] },
  },
}
export const NeverExpires: Story = {
  args: { state: { ...state, links: [{ ...link, expiresAt: null }] } },
}
export const CreatedLinkRecovery: Story = {
  args: {
    state: {
      ...state,
      stale: true,
      created: link,
      error: "The link was created, but the list could not be refreshed. Copy it below or retry.",
    },
  },
}
export const RefreshingExistingLinks: Story = {
  args: { state: { ...state, loading: true, links: [link] } },
}
export const ControlSettingsSaving: Story = {
  args: {
    state: { ...state, links: [link] },
    controlSettings: { included: true, pending: true, onChange: () => undefined },
  },
}
export const ControlSettingsFailed: Story = {
  args: {
    state: { ...state, links: [link] },
    controlSettings: {
      included: true,
      blocked: true,
      error: "Could not save control settings. Retry before sharing this configuration.",
      onChange: () => undefined,
    },
  },
}
export const InvalidLabel: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole("textbox", { name: "Label" }), "   ")
    await userEvent.click(canvas.getByRole("button", { name: shareCopy.create }))
    await canvas.findByRole("alert")
  },
}
