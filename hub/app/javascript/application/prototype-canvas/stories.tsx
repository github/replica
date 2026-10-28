import { useEffect, useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { App } from "."
import { publicationExamples } from "@utils/resolve-prototype-publication/fixtures"
import { repliedReviewThread } from "@/storybook/fixtures/review/comments"
import type { ShareLink } from "@hooks/use-canvas-share-links/types"
import type { HubStatus, PrototypeState, PublishPreparation } from "@utils/prototype-canvas/types"
import type { ReviewComment } from "@utils/review-comment/types"
import createPageMeta from "@pages/new-prototype-page/stories"

import { serverConnectionFixtureResponse } from "./server-connection/fixture-response"

import "./stories.css"

function PublicationDemo({
  scenario,
  prototypeUrl,
  withShareLinks = false,
  withComments = false,
  withoutPreview = false,
  catalogState = "ready",
  serverState = "empty",
}: {
  scenario: string
  prototypeUrl: string
  withShareLinks?: boolean
  withComments?: boolean
  withoutPreview?: boolean
  catalogState?: "ready" | "default" | "loading" | "failed" | "submission-failed"
  serverState?: string
}) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const fixture = publicationExamples[scenario]
    if (!fixture) throw new Error(`Unknown publication example: ${scenario}`)
    let state: PrototypeState | null = structuredClone(fixture.state)
    let hub: HubStatus | null = structuredClone(fixture.hub)
    let remember = false
    if (withShareLinks && hub?.prototype)
      hub.prototype = { ...hub.prototype, canManageShareLinks: true }
    if (withComments && hub?.prototype?.build)
      hub.prototype = {
        ...hub.prototype,
        build: {
          ...hub.prototype.build,
          number: 2,
          url: "https://hub.example.com/repositories/2001/prototypes/1?build=2",
        },
      }
    let comments: ReviewComment[] = withComments
      ? [
          repliedReviewThread.root,
          ...repliedReviewThread.replies,
          {
            ...repliedReviewThread.root,
            id: 3,
            buildNumber: 2,
            buildPath: "/repositories/2001/prototypes/1?build=2",
            body: "The updated button spacing looks good.",
            author: repliedReviewThread.replies[0]!.author,
            viewerLastSeenActivityVersion: 2,
          },
          {
            ...repliedReviewThread.root,
            id: 4,
            buildNumber: 2,
            buildPath: "/repositories/2001/prototypes/1?build=2",
            body: "Can we keep the heading aligned?",
          },
          {
            ...repliedReviewThread.replies[0]!,
            id: 5,
            rootId: 4,
            body: "I checked the narrow layout.",
          },
          {
            ...repliedReviewThread.replies[0]!,
            id: 6,
            rootId: 4,
            body: "Thanks, the heading now stays aligned.",
            author: repliedReviewThread.root.author,
          },
        ]
      : []
    let links: ShareLink[] = ["Usability review", "Design review"].map((label, index) => ({
      id: index + 1,
      label,
      buildNumber: 1,
      url: `https://hub.example.com/share/12345678-1234-1234-1234-${String(index + 1).padStart(12, "0")}`,
      expiresAt: null,
      createdAt: "2026-10-05T07:00:00Z",
      createdBy: { login: "octocat", name: "The Octocat" },
    }))
    let nextId = links.length + 1
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (!path.startsWith("/api/")) return originalFetch(input, init)
      let data: unknown
      if (withoutPreview && path === "/api/prototypes/new") {
        if (init?.method === "POST") {
          if (catalogState === "submission-failed")
            return Response.json(
              { error: "Copilot could not receive your brief. Try again." },
              { status: 503 },
            )
          data = { requested: true }
        } else {
          if (catalogState === "loading") return new Promise<Response>(() => {})
          if (catalogState === "failed")
            return Response.json(
              { error: "Hub could not load this repository's templates. Try again." },
              { status: 503 },
            )
          const source = createPageMeta.args.data
          data = {
            ...source,
            templates: (catalogState === "default"
              ? source.templates.slice(0, 1)
              : source.templates
            ).map(({ id, name, route }) => ({ id, name, route })),
          }
        }
      } else if (withoutPreview && (path === "/api/servers" || path.startsWith("/api/server/")))
        return serverConnectionFixtureResponse(serverState, path)
      else if (path === "/api/state" || path === "/api/refresh") data = state
      else if (path === "/api/hub/status") data = hub
      else if (path === "/api/hub/open" || path === "/api/hub/activity") data = hub
      else if (path === "/api/hub/discovery") data = hub
      else if (
        path === "/api/publish/prepare" &&
        state?.stats.repository &&
        state.stats.branch &&
        state.stats.commitSha
      )
        data = {
          target: {
            repository: state.stats.repository,
            branch: state.stats.branch,
            commitSha: state.stats.commitSha,
            originFingerprint: null,
            pushFingerprint: null,
          },
          workingTree: state.stats.workingTree === "changed" ? "changed" : "clean",
          remember,
        } satisfies PublishPreparation
      else if (path === "/api/publish/preference") {
        const body: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "{}")
        if (
          !body ||
          typeof body !== "object" ||
          !("remember" in body) ||
          typeof body.remember !== "boolean"
        )
          throw new Error("Invalid demo publishing preference.")

        remember = body.remember
        data = { remember }
      } else if (path === "/api/agent/next") data = { command: null }
      else if (withShareLinks && path.startsWith("/api/hub/share-links/")) {
        const body: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "{}")
        if (!body || typeof body !== "object") throw new Error("Invalid demo sharing input.")
        if (path.endsWith("/context")) {
          data = {
            target: "storybook-share-target",
            hubOrigin: hub?.hubOrigin,
            repository: hub?.repository,
            branch: hub?.branch,
            prototype: hub?.prototype,
          }
        } else if (path.endsWith("/list")) {
          data = { shareLinks: links, hasMore: false, nextCursor: null }
        } else if (path.endsWith("/create") && "label" in body && "expiration" in body) {
          if (typeof body.label !== "string" || !hub?.prototype?.build)
            throw new Error("Invalid demo share creation.")
          const days =
            body.expiration === "one_day" ? 1 : body.expiration === "thirty_days" ? 30 : 7
          const id = nextId++
          const link: ShareLink = {
            id,
            label: body.label.trim(),
            buildNumber: hub.prototype.build.number,
            url: `https://hub.example.com/share/12345678-1234-1234-1234-${String(id).padStart(12, "0")}`,
            createdAt: new Date().toISOString(),
            createdBy: { login: "octocat", name: "The Octocat" },
            expiresAt:
              body.expiration === "never"
                ? null
                : new Date(Date.now() + days * 86_400_000).toISOString(),
          }
          links = [link, ...links]
          data = link
        } else if (path.endsWith("/delete") && "id" in body) {
          links = links.filter((link) => link.id !== body.id)
          data = { deleted: true }
        } else if (path.endsWith("/open")) {
          data = { opened: true }
        } else throw new Error("Unknown demo sharing action.")
      } else if (path === "/api/publish" && state) {
        state = {
          ...state,
          publishRequest: {
            state: "requested",
            requestedAt: new Date().toISOString(),
            commitSha: state.stats.commitSha,
          },
        }
        data = {
          message:
            "Demo only: Publish would push this branch and wait for its Hub Build. Select another scenario to continue.",
        }
      } else if (path === "/api/hub/prototype" && hub?.prototype) {
        hub = { ...hub, prototype: { ...hub.prototype, registered: true, published: true } }
        data = hub.prototype
      } else if (path === "/api/hub/comments")
        data = {
          comments,
          hasMore: false,
          nextCursor: null,
        }
      else if (withComments && /^\/api\/hub\/comments\/\d+\/read$/.test(path)) {
        const id = Number(path.split("/").at(-2))
        const root = comments.find((comment) => comment.id === id && comment.kind === "root")
        if (!root || root.kind !== "root") throw new Error("Unknown demo conversation.")
        if (init?.method !== "POST" && init?.method !== "DELETE")
          throw new Error("Unsupported demo read-state action.")

        const updated = {
          ...root,
          viewerLastSeenActivityVersion: init.method === "DELETE" ? null : root.activityVersion,
        }
        comments = comments.map((comment) => (comment.id === root.id ? updated : comment))
        data = { comments: [updated] }
      } else if (path === "/api/hub/events") {
        return new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener("abort", () => controller.close(), { once: true })
            },
          }),
        )
      } else {
        return new Response(
          JSON.stringify({
            error:
              "Demo only: this action is disabled. Select another scenario; no real API was called.",
          }),
          { status: 409 },
        )
      }
      return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } })
    }
    const timer = window.setTimeout(() => setReady(true), 0)
    return () => {
      window.clearTimeout(timer)
      window.fetch = originalFetch
    }
  }, [scenario, withShareLinks, withComments, withoutPreview, catalogState, serverState])
  return (
    <div className="publication-demo">
      <div className="publication-demo-canvas">
        {ready ? (
          <App
            config={{
              prototypeUrl: withoutPreview ? null : prototypeUrl,
              name: "Welcome prototype",
              token: "fixture-only",
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

const configuredPrototypeUrl: unknown = import.meta.env.VITE_STORYBOOK_PROTOTYPE_URL
const meta = {
  title: "Prototype canvas/Publication example",
  component: PublicationDemo,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Uses story-only fixtures. No real commits, pushes, publication, or public share links. Open never launches a browser.",
      },
    },
  },
  args: {
    scenario: "Unpublished branch",
    prototypeUrl:
      typeof configuredPrototypeUrl === "string"
        ? configuredPrototypeUrl
        : new URL("/prototype-preview/index.html", window.location.href).href,
  },
  argTypes: { scenario: { control: "select", options: Object.keys(publicationExamples) } },
  render: (args) => (
    <PublicationDemo
      key={`${args.scenario}/${args.withShareLinks}/${args.withComments}/${args.withoutPreview}/${args.catalogState}/${args.serverState}`}
      {...args}
    />
  ),
} satisfies Meta<typeof PublicationDemo>

export default meta
type Story = StoryObj<typeof meta>
export const Playground: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Use the Light appearance and Dark appearance buttons to switch the preview and lower canvas UI together. The URL bar retains the Copilot app theme, with a system-theme fallback outside Copilot. Button colors switch immediately without transitions or backdrop blur. Open Controls, Hub, or a dialog to review the selected preview appearance on those surfaces.",
      },
    },
  },
}
export const NoPrototype: Story = { args: { withoutPreview: true } }
export const NoPrototypeServerScanning: Story = {
  args: { withoutPreview: true, serverState: "scanning" },
}
export const NoPrototypeSingleServer: Story = {
  args: { withoutPreview: true, serverState: "single" },
}
export const NoPrototypeMultipleServers: Story = {
  args: { withoutPreview: true, serverState: "multiple" },
}
export const NoPrototypeScriptSelection: Story = {
  args: { withoutPreview: true, serverState: "scripts" },
}
export const NoPrototypeScriptMenuOpen: Story = {
  ...NoPrototypeScriptSelection,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Dev server script: npm run dev" }),
    )
  },
}
export const NoPrototypeServerScanFailed: Story = {
  args: { withoutPreview: true, serverState: "scan-failed" },
}
export const NoPrototypeServerWarnings: Story = {
  args: { withoutPreview: true, serverState: "warnings" },
}
export const NoPrototypeStartupUnavailable: Story = {
  args: { withoutPreview: true, serverState: "startup-unavailable" },
}
export const NoPrototypeConnecting: Story = {
  args: { withoutPreview: true, serverState: "connecting" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Connect" }))
  },
}
export const NoPrototypeConnectFailed: Story = {
  ...NoPrototypeConnecting,
  args: { withoutPreview: true, serverState: "connect-failed" },
}
export const NoPrototypeStarting: Story = {
  args: { withoutPreview: true, serverState: "starting" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Start dev server" }))
    await canvas.findByLabelText("Dev server output")
  },
}
export const NoPrototypeStartFailed: Story = {
  args: { withoutPreview: true, serverState: "start-failed" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Start dev server" }))
    await canvas.findByRole("alert")
  },
}
export const NoPrototypeDefaultTemplate: Story = {
  args: { withoutPreview: true, catalogState: "default" },
}
export const NoPrototypeDisconnected: Story = {
  args: { withoutPreview: true, scenario: "Disconnected" },
}
export const NoPrototypeCatalogLoading: Story = {
  args: { withoutPreview: true, catalogState: "loading" },
}
export const NoPrototypeCatalogFailed: Story = {
  args: { withoutPreview: true, catalogState: "failed" },
}
export const NoPrototypeDetails: Story = {
  args: { withoutPreview: true },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Add details" }))
    await canvas.findByRole("dialog", { name: "Add details (optional)" })
  },
}
export const NoPrototypeTemplatePicker: Story = {
  args: { withoutPreview: true },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Template: Default" }))
    await canvas.findByRole("listbox", { name: "Template" })
  },
}
export const NoPrototypeSubmissionFailed: Story = {
  args: { withoutPreview: true, catalogState: "submission-failed" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByRole("textbox", { name: "What should we create?" }),
      "Help people organize their saved notes.",
    )
    await userEvent.click(canvas.getByRole("button", { name: "Create prototype" }))
    await canvas.findByRole("alert")
  },
}
export const Queued: Story = { args: { scenario: "Build queued" } }
export const UnpushedChanges: Story = { args: { scenario: "Unpushed changes" } }
export const AwaitingBuild: Story = { args: { scenario: "Awaiting build" } }
export const Building: Story = { args: { scenario: "Building" } }
export const Disconnected: Story = { args: { scenario: "Disconnected" } }
export const CheckingRemoteBranch: Story = { args: { scenario: "Checking remote branch" } }
export const WaitingForCopilot: Story = {
  args: { scenario: "Waiting for Copilot" },
  render: (args) => (
    <PublicationDemo
      {...args}
      prototypeUrl={new URL("/prototype-preview/index.html", window.location.href).href}
    />
  ),
}
export const PublishBlocked: Story = {
  ...WaitingForCopilot,
  args: { scenario: "Publish blocked" },
}
export const Importing: Story = { args: { scenario: "Awaiting Hub import" } }
export const AutomaticPublication: Story = { args: { scenario: "Automatic publication" } }
export const AutomaticPublicationFailed: Story = {
  args: { scenario: "Automatic publication failed" },
}
export const WriteAccessRequired: Story = { args: { scenario: "Write access required" } }
export const MissingRemoteBranch: Story = {
  args: { scenario: "Missing remote branch" },
  parameters: {
    docs: {
      description: {
        story:
          "The critical banner separates Branch not eligible for Hub registration from The branch no longer exists on the remote repository.",
      },
    },
  },
}
export const RegistrationAwaitingBuild: Story = {
  args: { scenario: "Registration awaiting Build" },
}
export const UnknownRegistrationReason: Story = {
  args: { scenario: "Unknown registration reason" },
}
export const Failed: Story = { args: { scenario: "Build failed" } }
export const Ready: Story = { args: { scenario: "Published" } }
export const CommentsSidebar: Story = {
  args: {
    scenario: "Published",
    withComments: true,
  },
  render: (args) => (
    <PublicationDemo
      {...args}
      prototypeUrl={new URL("/prototype-preview/index.html", window.location.href).href}
    />
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: /^Comments, 3/ }, { timeout: 5_000 }),
    )
    await canvas.findByRole("complementary", { name: "Comments" })
    await canvas.findByRole("link", { name: "build 1" })
    await canvas.findByText("1 reply")
    await canvas.findByText("2 replies")
    const link = await canvas.findByRole("link", { name: "build 1" })
    const row = link.closest("article")
    const unread = row?.querySelector(".review-comment-row__unread")
    if (!row || !unread) throw new Error("The unread comment fixture is missing.")
    const bounds = row.getBoundingClientRect()
    const surface = getComputedStyle(row, "::before")
    const surfaceLeft = bounds.left + parseFloat(surface.left)
    const surfaceRight = bounds.right - parseFloat(surface.right)
    const scroller = row.closest(".review-comments-sidebar__body")?.getBoundingClientRect()
    if (
      !scroller ||
      !Number.isFinite(surfaceLeft) ||
      !Number.isFinite(surfaceRight) ||
      surfaceLeft < scroller.left - 0.5 ||
      surfaceRight > scroller.right + 0.5
    )
      throw new Error("The wider hover surface must remain inside the comment scroll area.")
    const body = row.querySelector(".review-comment-row__body")?.getBoundingClientRect()
    const avatar = row.querySelector(".review-comment-row__avatar")?.getBoundingClientRect()
    const author = row.querySelector(".review-comment-row__author")?.getBoundingClientRect()
    const dot = unread.getBoundingClientRect()
    if (!body || Math.abs(dot.top + dot.height / 2 - body.top - body.height / 2) > 0.5)
      throw new Error("The unread dot must be vertically centered beside the comment text.")
    if (
      !avatar ||
      !author ||
      Math.abs(avatar.width - 20) > 0.5 ||
      Math.abs(avatar.left - surfaceLeft - 8) > 0.5 ||
      Math.abs(avatar.left + avatar.width / 2 - dot.left - dot.width / 2) > 0.5 ||
      Math.abs(avatar.top + avatar.height / 2 - author.top - author.height / 2) > 0.5
    )
      throw new Error("The compact avatar must align above the unread dot beside the author.")
  },
}
export const ShareManagement: Story = {
  args: {
    scenario: "Published",
    withShareLinks: true,
    prototypeUrl:
      typeof configuredPrototypeUrl === "string"
        ? configuredPrototypeUrl
        : new URL("/prototype-preview/index.html", window.location.href).href,
  },
}
export const NarrowShareManagement: Story = {
  ...ShareManagement,
  render: (args) => (
    <div style={{ width: "24rem", maxWidth: "100%", height: "100vh" }}>
      <PublicationDemo {...args} />
    </div>
  ),
}
