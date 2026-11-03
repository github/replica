import { createRef, useEffect, useRef, useState, type ComponentProps } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { octocatRootComment } from "@/storybook/fixtures/review/comments"
import { reviewCommentsCopy } from "@utils/review-comment/en"
import type { HubStatus } from "@utils/prototype-canvas/types"
import { publicationCopy } from "@utils/resolve-prototype-publication/en"
import { importedPrototype, publicationHub } from "@utils/resolve-prototype-publication/fixtures"

import { PrototypeCanvasHubPanel } from "."

const canvasPreview = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><style>
body { margin: 0; font: 16px system-ui; background: #fff; color: #1f2328; }
main { padding: 80px clamp(24px, 8vw, 120px); }
button { padding: 12px 24px; border: 1px solid #d1d9e0; border-radius: 6px; background: #f6f8fa; color: #1f2328; }
</style></head>
<body><main><h1>Welcome prototype</h1><p>A place to try the new experience.</p><button id="save">Save</button></main>
<script>
let selection = null;
const parentOrigin = parent.location.origin;
const route = { pathname: "/", search: "", hash: "" };
window.addEventListener("message", ({ data }) => {
  if (!data || !data.nonce) return;
  const send = (message) => parent.postMessage({ nonce: data.nonce, ...message }, parentOrigin);
  if (data.type === "replica:canvas:request-ready")
    send({ type: "replica:canvas:ready", protocolVersion: 1, route });
  if (data.type === "replica:canvas:resolve") {
    const bounds = document.getElementById("save").getBoundingClientRect();
    const rect = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    send({ type: "replica:canvas:resolved", protocolVersion: 1, route,
      results: data.anchors.map(({ id }) => ({ id, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, rect })) });
  }
  if (data.type === "replica:canvas:select") selection = data.nonce;
  if (data.type === "replica:canvas:cancel-selection") selection = null;
});
document.getElementById("save").addEventListener("click", () => {
  if (!selection) return;
  const bounds = document.getElementById("save").getBoundingClientRect();
  parent.postMessage({ type: "replica:canvas:selected", nonce: selection, anchor: {
    schemaVersion: 1, kind: "element", route, selector: "#save", accessibleName: "Save", tagName: "button", selectedText: "",
    rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    viewport: { width: innerWidth, height: innerHeight, scrollX: 0, scrollY: 0 }, elementOffset: { x: .5, y: .5 }
  } }, parentOrigin);
  selection = null;
});
</script></body></html>`

function ConnectedDemo({
  preview = false,
  rateLimited = false,
  commentsState = "single",
  failure,
  ...props
}: ComponentProps<typeof PrototypeCanvasHubPanel> & {
  preview?: boolean
  rateLimited?: boolean
  commentsState?: "single" | "empty" | "loading" | "failed" | "live-failed"
  failure?: "metadata" | "disconnect"
}) {
  const [ready, setReady] = useState(false)
  const [open, setOpen] = useState(!preview)
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const originalFetch = window.fetch.bind(window)
    const startingComment = props.status?.reviewRevision?.id
      ? {
          ...octocatRootComment,
          buildNumber: null,
          buildPath: null,
          draftRevisionId: props.status.reviewRevision.id,
          viewerLastSeenActivityVersion: octocatRootComment.activityVersion,
        }
      : octocatRootComment
    let comments = commentsState === "empty" ? [] : [startingComment]
    window.fetch = (input, init) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (
        (failure === "metadata" && path === "/api/hub/metadata") ||
        (failure === "disconnect" && path === "/api/hub/disconnect")
      )
        return Promise.resolve(Response.json({ error: "Hub returned HTTP 503." }, { status: 503 }))
      if (path === "/api/hub/metadata" || path === "/api/hub/disconnect")
        return Promise.resolve(Response.json({}))
      if (
        rateLimited &&
        path.startsWith("/api/hub/comments") &&
        init?.method &&
        init.method !== "GET" &&
        !path.endsWith("/read")
      )
        return Promise.resolve(
          Response.json(
            {
              error: "Too many requests. No changes were made. Wait 60 seconds, then try again.",
            },
            { status: 429 },
          ),
        )
      if (path === "/api/hub/events") {
        if (commentsState === "live-failed")
          return Promise.resolve(
            Response.json({ error: "Live updates are unavailable." }, { status: 503 }),
          )
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                init?.signal?.addEventListener("abort", () => controller.close(), { once: true })
              },
            }),
          ),
        )
      }
      if (path === "/api/hub/comments" || path.startsWith("/api/hub/comments?")) {
        if (commentsState === "loading") return new Promise(() => {})
        if (commentsState === "failed")
          return Promise.resolve(
            Response.json(
              { error: "Could not load comments. Retry when Hub is available." },
              { status: 503 },
            ),
          )
        if (init?.method === "POST") {
          if (typeof init.body !== "string")
            return Promise.reject(new Error("Expected a JSON comment request."))
          const { review_comment } = JSON.parse(init.body) as {
            review_comment: { body: string; anchor: typeof octocatRootComment.anchor }
          }
          const created = {
            ...startingComment,
            id: 2,
            body: review_comment.body,
            anchor: review_comment.anchor,
            viewerLastSeenActivityVersion: 2,
          }
          comments = [...comments, created]
          return Promise.resolve(Response.json({ comments: [created] }, { status: 201 }))
        }
        return Promise.resolve(
          new Response(JSON.stringify({ comments, hasMore: false, nextCursor: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }
      if (path === "/api/hub/discovery" || path === "/api/hub/status") {
        return Promise.resolve(
          new Response(JSON.stringify(props.status), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }
      if (path.startsWith("/api/hub/comments/")) {
        return Promise.resolve(new Response("{}", { status: 200 }))
      }
      if (path.startsWith("/api/"))
        return Promise.resolve(
          Response.json({ error: "This action is unavailable in this fixture." }, { status: 409 }),
        )
      return originalFetch(input, init)
    }
    const initial = window.setTimeout(() => setReady(true), 0)
    return () => {
      window.clearTimeout(initial)
      window.fetch = originalFetch
    }
  }, [props.status, rateLimited, commentsState, failure])

  return (
    <div
      style={{
        width: preview ? "100%" : "min(24rem, 100%)",
        height: "40rem",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div id="canvas-review-controls" />
      {preview ? (
        <iframe
          ref={frameRef}
          title="Welcome prototype"
          srcDoc={canvasPreview}
          style={{ width: "100%", height: "calc(100% - 2.75rem)", border: 0 }}
        />
      ) : null}
      {ready ? (
        <PrototypeCanvasHubPanel
          {...props}
          frameRef={preview ? frameRef : props.frameRef}
          config={
            preview
              ? { ...props.config, prototypeUrl: new URL("/", window.location.href).href }
              : props.config
          }
          open={open}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  )
}

const meta = {
  title: "Prototype canvas/Hub panel",
  component: PrototypeCanvasHubPanel,
  args: {
    config: {
      prototypeUrl: "http://localhost:4321/",
      name: "Welcome",
      token: "local-token",
    },
    frameRef: createRef<HTMLIFrameElement>(),
    status: {
      state: "disconnected",
      hubOrigin: "http://replica.localhost:19500",
      repository: "github/prototype",
      branch: "prototype/welcome",
    },
    onStatusChange: async () => {},
    onSelectHub: async () => {},
    onConnect: () => {},
    open: true,
    onClose: () => {},
  },
} satisfies Meta<typeof PrototypeCanvasHubPanel>

export default meta
type Story = StoryObj<typeof meta>

export const ChooseHub: Story = {
  args: {
    status: { state: "unconfigured" },
  },
}

export const Disconnected: Story = {}

export const BrowserApproval: Story = {
  args: {
    status: {
      ...meta.args.status,
      state: "pairing",
      pairing: {
        verificationUrl: "http://replica.localhost:19500/canvas/pair/ABCD1234",
        userCode: "ABCD1234",
      },
    },
  },
}

export const ConfiguredHub: Story = {
  args: {
    status: {
      state: "disconnected",
      repository: "github/prototype",
      hubOrigin: "https://team.example.com",
      discovery: { state: "valid", origin: "https://team.example.com", defaultBranch: "trunk" },
    },
  },
}

export const EditHub: Story = {
  args: { status: { ...meta.args.status, state: "unavailable" } },
  render: (args) => <ConnectedDemo {...args} />,
}

export const StatusUnavailable: Story = {
  args: {
    status: {
      ...meta.args.status,
      state: "unavailable",
      message: "Hub status unavailable: Load failed",
    },
    publication: {
      kind: "unknown",
      detail: publicationCopy.unknown("Load failed"),
      label: publicationCopy.retry,
      action: "retry",
    },
    onPublish: () => {},
    onRetryPublication: () => {},
  },
  play: ({ canvasElement }) => {
    const warning = canvasElement.querySelector(".canvas-hub-status > .hub-alert--warning")
    const retry = canvasElement.querySelector(".canvas-hub-status > button")
    if (!warning || !retry)
      throw new Error("Unavailable Hub status must show a warning banner and Retry status.")
    const gap = retry.getBoundingClientRect().top - warning.getBoundingClientRect().bottom
    if (Math.abs(gap - 16) > 0.5)
      throw new Error("Retry status must have the standard 16px gap below its warning banner.")
  },
}

export const RetryingStatus: Story = {
  args: { ...StatusUnavailable.args, publicationBusy: true },
  play: StatusUnavailable.play,
}

export const ConfigurationMismatch: Story = {
  args: {
    status: {
      state: "undiscovered",
      repository: "github/prototype",
      hubOrigin: "https://previous.example.com",
      discovery: { state: "valid", origin: "https://team.example.com", mismatch: true },
    },
  },
}

export const DiscoveryUnavailable: Story = {
  args: {
    status: {
      state: "unconfigured",
      discovery: {
        state: "unreachable",
        message: "GitHub configuration is unavailable. Retry when access returns.",
      },
    },
  },
}

export const AlternateHub: Story = {
  args: {
    status: {
      state: "disconnected",
      hubOrigin: "https://team.example.com",
      repository: "github/prototype",
      branch: "prototype/welcome",
    },
  },
}

export const Undiscovered: Story = {
  args: {
    status: {
      state: "undiscovered",
      hubOrigin: "https://hub.example.com",
      repository: "github/prototype",
      branch: "nshki-discussion-timeline-prototype",
    },
  },
}

export const Unpublished: Story = {
  args: {
    status: {
      state: "undiscovered",
      hubOrigin: "https://hub.example.com",
      repository: "github/prototype",
      branch: "nshki-discussion-timeline-prototype",
      repositoryAuthorized: true,
    },
    publication: {
      kind: "unpublished",
      detail: publicationCopy.absent,
      label: publicationCopy.publishBranch,
      action: "publish",
    },
    onPublish: () => {},
    onRetryPublication: () => {},
    dirty: true,
  },
  play: async ({ canvas }) => {
    await canvas.findByRole("heading", { name: "Hub" })
    await canvas.findByRole("button", { name: "Publish" })
    if (canvas.queryByText(/Local commenting readiness/))
      throw new Error("Publication must not include the local commenting explanation.")
  },
}

export const Pushing: Story = {
  ...Unpublished,
  render: (args) => <ConnectedDemo {...args} />,
  args: {
    ...Unpublished.args,
    publication: {
      kind: "requested",
      detail: publicationCopy.pending,
      label: publicationCopy.publishBranch,
      action: "none",
    },
  },
  play: async ({ canvas, canvasElement }) => {
    const button = await canvas.findByRole("button", { name: "Publish" })
    if (!button.hasAttribute("disabled") || button.getAttribute("aria-busy") !== "true")
      throw new Error("Pending Publish must remain disabled with a loading indicator.")
    const publication = canvasElement.querySelector(".canvas-branch-publication")
    if (!publication || publication.querySelectorAll("p").length !== 1)
      throw new Error("Pending publication must contain only its concise status.")
    if (publication.textContent?.includes("Uncommitted changes stay local"))
      throw new Error("Pending publication must not repeat approval explanations.")
    if (getComputedStyle(publication).borderBottomWidth !== "0px")
      throw new Error("Publication must not duplicate the next section's separator.")
    if (canvasElement.querySelector(".canvas-hub-settings"))
      throw new Error("Empty Hub settings must not be mounted.")
    if (canvasElement.querySelectorAll(".canvas-hub-section").length !== 1)
      throw new Error("Only the populated Hub section should follow pending publication.")
    canvasElement.dataset.pendingReview = "passed"
  },
}

export const WorkflowRunning: Story = {
  ...Pushing,
  args: {
    ...Pushing.args,
    publication: {
      kind: "building",
      detail: publicationCopy.workflowBuilding,
      label: publicationCopy.building,
      action: "none",
      runUrl: "https://github.com/github/example/actions/runs/1",
    },
  },
  play: async ({ canvas, canvasElement }) => {
    const link = await canvas.findByRole("link", { name: "View workflow run" })
    const hub = await canvas.findByRole("link", {
      name: "https://hub.example.com",
    })
    if (!link.className.includes("InlineLink"))
      throw new Error("The workflow run must use Brand's normal InlineLink component.")
    const style = getComputedStyle(link)
    const color = getComputedStyle(hub).color
    if (style.color !== color || style.textDecorationColor !== color)
      throw new Error("The workflow run text and underline must use the shared green Hub color.")
    if (
      link.getAttribute("href") !== "https://github.com/github/example/actions/runs/1" ||
      link.getAttribute("target") !== "_blank" ||
      link.getAttribute("rel") !== "noopener noreferrer"
    )
      throw new Error("The workflow link must preserve its URL and safe external attributes.")
    canvasElement.dataset.workflowReview = "passed"
  },
}

export const Connected: Story = {
  render: (args) => <ConnectedDemo {...args} />,
  play: async ({ canvas, canvasElement }) => {
    const button = await canvas.findByRole("button", { name: "Edit details" })
    const close = await canvas.findByRole("button", { name: "Close Hub" })
    const icon = close.querySelector("svg")
    if (!icon) throw new Error("The close button icon is missing.")
    const controlBounds = close.getBoundingClientRect()
    const iconBounds = icon.getBoundingClientRect()
    if (
      Math.abs(controlBounds.width - controlBounds.height) > 1 ||
      Math.abs(
        controlBounds.left + controlBounds.width / 2 - (iconBounds.left + iconBounds.width / 2),
      ) > 1 ||
      Math.abs(
        controlBounds.top + controlBounds.height / 2 - (iconBounds.top + iconBounds.height / 2),
      ) > 1
    )
      throw new Error("The close icon must be centered in a square control.")
    const prototypeTitle = await canvas.findByRole("heading", { name: "Welcome" })
    const header = canvasElement.querySelector(".canvas-hub-panel .hub-sidebar__header")
    if (
      !header ||
      Math.abs(
        prototypeTitle.getBoundingClientRect().top - header.getBoundingClientRect().bottom - 16,
      ) > 1
    )
      throw new Error("The prototype title must have only 16px of space above it.")
    const startPage = canvasElement.querySelector(".canvas-hub-publication__start-page")
    if (!startPage) throw new Error("Start page metadata is missing.")
    const gap = button.getBoundingClientRect().top - startPage.getBoundingClientRect().bottom
    const spacing = parseFloat(getComputedStyle(button).marginTop)
    if (
      getComputedStyle(startPage).marginBottom !== "0px" ||
      spacing !== 16 ||
      Math.abs(gap - 16) > 1
    )
      throw new Error("Metadata spacing must use the 16px spacing token.")
    const hubSection = await canvas.findByRole("region", { name: "Hub" })
    const disconnect = await canvas.findByRole("button", { name: "Disconnect Hub" })
    if (
      hubSection !== hubSection.parentElement?.lastElementChild ||
      !hubSection.contains(disconnect)
    )
      throw new Error("Hub must be the last section and contain Disconnect Hub.")
    if (button.className !== disconnect.className)
      throw new Error("Edit details and Disconnect Hub must use the same button style.")
    const build = canvasElement.querySelector(".canvas-hub-build")
    if (!build) throw new Error("Latest Build is missing.")
    const style = getComputedStyle(build)
    if (
      style.paddingTop !== "0px" ||
      style.borderTopWidth !== "0px" ||
      style.backgroundColor !== "rgba(0, 0, 0, 0)"
    )
      throw new Error("Latest Build must use the plain panel background without a card.")
    const title = await canvas.findByRole("link", { name: "Build #1" })
    const commit = await canvas.findByText("aaaaaaa")
    const row = title.parentElement
    if (!row || commit.parentElement !== row)
      throw new Error("The Build title and commit must share the same row.")
    const titleGap = commit.getBoundingClientRect().left - title.getBoundingClientRect().right
    if (Math.abs(titleGap - parseFloat(getComputedStyle(row).columnGap)) > 1)
      throw new Error("The commit must appear beside the Build title.")
    const author = await canvas.findByRole("link", { name: "The Octocat" })
    if (author.getAttribute("href") !== "https://github.com/octocat")
      throw new Error("The commit author must link using the associated GitHub login.")
    if (
      getComputedStyle(author).color !== getComputedStyle(author.parentElement!).color ||
      getComputedStyle(author).textDecorationLine !== "none"
    )
      throw new Error("The author link must look like normal text when not hovered.")
    if (canvas.queryByText(/^Commit author:/))
      throw new Error("The author must not have a visible Commit author prefix.")
    const history = await canvas.findByRole("link", { name: "Show build history" })
    if (
      history.getAttribute("href") !==
      "http://replica.localhost:19500/repositories/1/prototypes/1/builds"
    )
      throw new Error("Build history must use the current Hub and prototype identity.")
    if (canvas.queryByText(/versions?/))
      throw new Error("Latest Build must not show the successful Build count as versions.")
  },
  args: {
    status: {
      state: "connected",
      repository: "local/example",
      branch: "prototype/welcome",
      commitSha: "a".repeat(40),
      reviewRevision: publicationHub.reviewRevision,
      hubOrigin: "http://replica.localhost:19500",
      prototype: {
        id: 1,
        repositoryId: 1,
        branch: "prototype/welcome",
        name: "Welcome",
        description: "A place to try the new experience.",
        startPage: "/welcome?step=1#intro",
        viewerLogin: "octocat",
        registered: true,
        canEdit: true,
        canRegister: true,
        published: true,
        buildState: "successful",
        versionCount: 1,
        build: {
          url: "http://replica.localhost:19500/repositories/1/prototypes/1?build=1",
          number: 1,
          commitSha: "a".repeat(40),
          publishedAt: "2026-09-14T12:00:00Z",
          author: { login: "octocat", name: "The Octocat", avatarUrl: null },
        },
      },
    } satisfies HubStatus,
  },
}

export const NoSuccessfulBuild: Story = {
  render: (args) => <ConnectedDemo {...args} />,
  args: {
    status: {
      ...publicationHub,
      state: "connected",
      prototype: {
        ...importedPrototype,
        published: false,
        build: null,
        buildState: "failed",
        currentBuild: { commitSha: "a".repeat(40), state: "failed" },
      },
    },
  },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByText(/No successful imported Build yet/)
    if (canvas.queryByRole("link", { name: "Show build history" }))
      throw new Error("Build history must be hidden until a successful Build is available.")
    canvasElement.dataset.historyReview = "passed"
  },
}

export const CanvasComments: Story = {
  ...Connected,
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("button", { name: /^Comments, 1/ })
    await userEvent.click(toggle)
    const panel = await canvas.findByRole("complementary", { name: reviewCommentsCopy.heading })
    if (!panel.classList.contains("hub-sidebar"))
      throw new Error("Canvas comments must use the shared sidebar frame.")
    const close = await canvas.findByRole("button", { name: reviewCommentsCopy.closeLabel })
    if (!close.classList.contains("hub-icon-button--invisible"))
      throw new Error("Canvas comments must use the shared ghost close button.")
    const content = panel.querySelector(".hub-sidebar__content")
    const filters = panel.querySelector(".review-comment-filter-controls")
    const threads = panel.querySelector(".review-comments-sidebar__body")
    if (!content || !filters || !threads || getComputedStyle(content).overflow !== "hidden")
      throw new Error("Canvas comments must retain fixed filters and a separate scroll area.")
    await userEvent.click(close)
    if (panel.getAttribute("data-open") !== "false" || !panel.hasAttribute("inert"))
      throw new Error("Closed sidebars must be inaccessible without unmounting their content.")
    await userEvent.click(toggle)
    await canvas.findByRole("complementary", { name: reviewCommentsCopy.heading })
  },
}

export const PinWithCommentsClosed: Story = {
  ...Connected,
  render: (args) => <ConnectedDemo {...args} preview />,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "Click the avatar pin beside Save to open its conversation while the comments pane stays closed. To post a comment, choose Add a comment, then Comment on element, and click Save.",
      },
    },
  },
  play: async ({ canvas }) => {
    await canvas.findByRole("button", { name: "Unread thread started by @octocat" })
    if (
      canvas.getByRole("button", { name: /^Comments, 1/ }).getAttribute("aria-expanded") !== "false"
    )
      throw new Error("The pin playground must start with the comments pane closed.")
  },
}

export const RateLimited: Story = {
  ...PinWithCommentsClosed,
  render: (args) => <ConnectedDemo {...args} preview rateLimited />,
}

export const LocalDraftComments: Story = {
  ...PinWithCommentsClosed,
  args: {
    ...Connected.args,
    status: {
      ...publicationHub,
      state: "connected",
      reviewRevision: {
        ...publicationHub.reviewRevision!,
        id: 7,
        buildNumber: null,
        clean: false,
      },
      prototype: {
        ...importedPrototype,
        registered: false,
        published: false,
        build: null,
        currentBuild: null,
        buildState: null,
        versionCount: 0,
      },
    },
  },
  play: async ({ canvas }) => {
    await canvas.findByRole("button", { name: "Thread started by @octocat" })
  },
}

export const LocalCommentsBeforeFirstPublish: Story = {
  ...LocalDraftComments,
  args: {
    ...LocalDraftComments.args,
    status: {
      ...LocalDraftComments.args!.status!,
      state: "undiscovered",
      repositoryAuthorized: true,
      viewerLogin: "octocat",
      prototype: undefined,
      reviewRevision: {
        ...LocalDraftComments.args!.status!.reviewRevision!,
        prototypeId: null,
      },
    },
  },
}

export const LocalCommentUploadFailed: Story = {
  ...LocalDraftComments,
  args: {
    ...LocalDraftComments.args,
    status: {
      ...LocalDraftComments.args!.status!,
      localCommentsError:
        "Local comments not synced: Hub is unavailable. Your drafts are kept on this device.",
    },
  },
}

export const PostedCommentWithCommentsClosed: Story = {
  ...PinWithCommentsClosed,
  play: async ({ canvas, canvasElement, userEvent }) => {
    await canvas.findByRole("button", { name: "Unread thread started by @octocat" })
    await userEvent.click(canvas.getByRole("button", { name: "Add a comment" }))
    await userEvent.click(await canvas.findByRole("menuitem", { name: "Comment on element" }))
    const target = canvasElement.querySelector("iframe")?.contentDocument?.getElementById("save")
    if (!target) throw new Error("The preview target is unavailable.")
    await userEvent.click(target)
    await userEvent.type(
      await canvas.findByRole("textbox", { name: "Comment" }),
      "Please update this heading.",
    )
    await userEvent.click(canvas.getByRole("button", { name: "Comment" }))
    await canvas.findByRole("button", { name: "Thread started by @octocat" })
    const thread = await canvas.findByRole("dialog", { name: "Conversation" })
    if (
      !thread.classList.contains("review-thread-conversation--anchored") ||
      canvas.getByRole("button", { name: /^Comments, 2/ }).getAttribute("aria-expanded") !== "false"
    )
      throw new Error("Posting must show its anchored thread without opening comments.")
  },
}

export const PreviewMarker: Story = {
  render: () => (
    <div style={{ position: "relative", width: "20rem", height: "12rem", background: "#fff" }}>
      <button
        type="button"
        className="canvas-marker"
        style={{ left: "50%", top: "50%" }}
        aria-label="Open review thread 1"
      >
        6
      </button>
    </div>
  ),
}

export const CheckingConnection: Story = { args: { status: null } }
export const AccessDenied: Story = {
  args: {
    status: {
      ...meta.args.status,
      state: "denied",
      message: "Your repository access was removed. Reconnect after access is restored.",
    },
  },
}
export const InvalidDiscovery: Story = {
  args: {
    status: {
      ...meta.args.status,
      state: "undiscovered",
      discovery: { state: "invalid", message: "The repository Hub URL must use HTTPS." },
    },
  },
}
export const Connecting: Story = { args: { connecting: true } }
export const ReadOnly: Story = {
  ...Connected,
  play: undefined,
  args: {
    status: {
      ...Connected.args!.status!,
      prototype: { ...Connected.args!.status!.prototype!, canEdit: false, canRegister: false },
    },
  },
}
export const OlderBuild: Story = {
  ...Connected,
  play: undefined,
  args: { status: { ...Connected.args!.status!, commitSha: "b".repeat(40) } },
}
export const UnknownBuildAuthor: Story = {
  ...Connected,
  play: undefined,
  args: {
    status: {
      ...Connected.args!.status!,
      prototype: {
        ...Connected.args!.status!.prototype!,
        build: {
          ...Connected.args!.status!.prototype!.build!,
          author: { login: null, name: null, avatarUrl: null },
        },
      },
    },
  },
}
export const EditingMetadata: Story = {
  ...Connected,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Edit details" }))
    await canvas.findByRole("textbox", { name: "Name" })
  },
}
export const MetadataSaveFailed: Story = {
  ...EditingMetadata,
  render: (args) => <ConnectedDemo {...args} failure="metadata" />,
  play: async (context) => {
    await EditingMetadata.play?.(context)
    await context.userEvent.click(context.canvas.getByRole("button", { name: "Save metadata" }))
    await context.canvas.findByRole("alert")
  },
}
export const DisconnectFailed: Story = {
  ...Connected,
  render: (args) => <ConnectedDemo {...args} failure="disconnect" />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Disconnect Hub" }))
    await canvas.findByRole("alert")
  },
}
export const CommentsEmpty: Story = {
  ...CanvasComments,
  render: (args) => <ConnectedDemo {...args} commentsState="empty" />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /^Comments, 0/ }))
    await canvas.findByRole("complementary", { name: reviewCommentsCopy.heading })
  },
}
export const CommentsLoading: Story = {
  ...CommentsEmpty,
  render: (args) => <ConnectedDemo {...args} commentsState="loading" />,
}
export const CommentsFailed: Story = {
  ...CommentsEmpty,
  render: (args) => <ConnectedDemo {...args} commentsState="failed" />,
}
export const LiveUpdatesFailed: Story = {
  ...CanvasComments,
  render: (args) => <ConnectedDemo {...args} commentsState="live-failed" />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /^Comments, 1/ }))
    await canvas.findByRole("complementary", { name: reviewCommentsCopy.heading })
  },
}
export const ReviewRevisionFailed: Story = {
  ...LocalDraftComments,
  args: {
    status: {
      ...LocalDraftComments.args!.status!,
      reviewError: "Could not prepare this checkout for commenting. Retry after reconnecting.",
    },
  },
  play: LiveUpdatesFailed.play,
}
