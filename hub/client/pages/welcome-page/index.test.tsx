import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { authenticatedHubWorkspaceData } from "@/storybook/fixtures/hub-administration"

import { WelcomePage } from "."
import type { WelcomePageData } from "./types"

function pageData(): WelcomePageData {
  return {
    workspace: {
      ...authenticatedHubWorkspaceData,
      welcomeLabel: "Welcome",
      welcomePath: "/welcome",
      selectedSection: "welcome",
    },
    heading: "Getting started with Replica",
    description: "Turn an idea into an interactive prototype.",
    videoUrl: null,
    videoEmbedUrl: "https://www.youtube-nocookie.com/embed/J2Z28CwIfsA",
    videoPosterUrl: "https://media.example.test/poster.jpg",
    videoLabel: "Learn how Replica works",
    videoDescription: "Watch an introduction to Replica.",
    videoUnavailable: "The introduction video is not available yet.",
    videoFailed: "The introduction video could not load.",
    readmeLabel: "Learn about Replica",
    readmeDescription: "Discover how Replica works.",
    readmePath: "https://github.com/github/replica#readme",
    setupLabel: "Getting started",
    setupDescription: "Follow a step-by-step guide.",
    setupPath: "https://github.com/github/replica/blob/main/docs/getting-started.md",
    createLabel: "Create prototype",
    createDescription: "Describe an idea in the GitHub Copilot app.",
    createUnavailable: "Creating a prototype here requires a connected GitHub repository.",
    hideLabel: "Hide welcome",
    hideDescription: "Remove Welcome from your sidebar on all devices.",
    hidePath: "/welcome",
    notice: null,
  }
}

describe("WelcomePage()", () => {
  it("embeds the introduction accessibly and keeps the welcome actions available", () => {
    const data = pageData()
    render(<WelcomePage data={data} />)
    const video = screen.getByLabelText(data.videoLabel)

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(data.heading)
    expect(video).toHaveAttribute("src", data.videoEmbedUrl)
    expect(video).toHaveAccessibleName(data.videoLabel)
    expect(video).toHaveAttribute("allowfullscreen")
    expect(video).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin")
    expect(video).toBeVisible()
    expect(screen.getByRole("heading", { level: 2, name: data.videoLabel })).toBeInTheDocument()
    expect(screen.getByText(data.videoDescription)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: data.readmeLabel })).toHaveAttribute(
      "href",
      data.readmePath,
    )
    expect(screen.getByRole("link", { name: data.readmeLabel })).toHaveAttribute("target", "_blank")
    expect(screen.getByRole("link", { name: data.readmeLabel })).toHaveAttribute(
      "rel",
      "noreferrer",
    )
    expect(screen.getByRole("link", { name: data.setupLabel })).toHaveAttribute(
      "href",
      data.setupPath,
    )
    expect(screen.getByRole("link", { name: data.setupLabel })).toHaveAttribute("target", "_blank")
    expect(screen.getByRole("link", { name: data.setupLabel })).toHaveAttribute("rel", "noreferrer")
    expect(screen.getByRole("link", { name: data.createLabel })).toHaveAttribute(
      "href",
      data.workspace.repository?.newPrototypePath,
    )
    for (const label of [data.readmeLabel, data.setupLabel, data.createLabel]) {
      expect(screen.getByRole("heading", { level: 2, name: label })).toBeInTheDocument()
    }
    expect(screen.getByText(data.readmeDescription)).toBeInTheDocument()
    expect(screen.getByText(data.setupDescription)).toBeInTheDocument()
    expect(screen.getByText(data.createDescription)).toBeInTheDocument()
    const hideButton = screen.getByRole("button", { name: data.hideLabel })
    expect(hideButton).toHaveAccessibleDescription(data.hideDescription)
    const form = hideButton.closest("form")
    expect(form).toHaveAttribute("action", "/welcome")
    expect(form).toHaveAttribute("method", "post")
    expect(form?.querySelector('input[name="_method"]')).toHaveValue("patch")
    expect(form?.querySelector('input[name="authenticity_token"]')).toHaveValue(
      data.workspace.authenticityToken,
    )
    expect(screen.getByRole("link", { name: "Welcome" })).toHaveAttribute("aria-current", "page")
  })

  it("uses the native player and reports failures for configured video assets", () => {
    const data = pageData()
    data.videoUrl = "https://media.example.test/intro.mp4"
    data.videoEmbedUrl = null
    render(<WelcomePage data={data} />)
    const video = screen.getByLabelText(data.videoLabel)

    expect(video).toHaveAttribute("src", data.videoUrl)
    expect(video).toHaveAttribute("poster", data.videoPosterUrl)
    expect(video).toHaveAttribute("controls")
    expect(video).toHaveAttribute("playsinline")
    expect(video).toHaveAttribute("preload", "metadata")
    expect(video).not.toHaveAttribute("autoplay")

    fireEvent.error(video)
    expect(screen.getByRole("alert")).toHaveTextContent(data.videoFailed)
    expect(screen.getByRole("link", { name: data.setupLabel })).toBeInTheDocument()
  })

  it.each(["missing", "local"])(
    "keeps an explanatory creation card for a %s repository",
    (state) => {
      const data = pageData()
      if (state === "missing") {
        data.workspace.repository = null
      } else if (data.workspace.repository) {
        data.workspace.repository.newPrototypePath = null
      }

      render(<WelcomePage data={data} />)

      expect(screen.getByRole("heading", { level: 2, name: data.createLabel })).toBeInTheDocument()
      expect(screen.getByText(data.createUnavailable)).toBeInTheDocument()
      expect(screen.queryByRole("link", { name: data.createLabel })).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: data.createLabel })).not.toBeInTheDocument()
      expect(screen.getByRole("link", { name: data.readmeLabel })).toBeInTheDocument()
      expect(screen.getByRole("link", { name: data.setupLabel })).toBeInTheDocument()
    },
  )

  it("keeps the introduction accessible without a video or a visible welcome link", () => {
    const data = pageData()
    data.videoUrl = null
    data.videoEmbedUrl = null
    data.hidePath = null
    data.workspace.welcomePath = null
    data.notice = "Welcome is hidden from your sidebar."
    const { container } = render(<WelcomePage data={data} />)

    expect(screen.getByText(data.videoUnavailable)).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(data.heading)
    expect(screen.getByRole("status")).toHaveTextContent(data.notice)
    expect(screen.queryByRole("link", { name: "Welcome" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: data.hideLabel })).not.toBeInTheDocument()
    expect(container.querySelector("video")).toBeNull()
    expect(screen.getByRole("link", { name: data.setupLabel })).toBeInTheDocument()
  })
})
