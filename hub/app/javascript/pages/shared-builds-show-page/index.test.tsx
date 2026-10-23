import { act, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { SharedBuildsShowPage } from "."
import type { SharedBuildsShowPageData } from "./types"

const PAGE_DATA: SharedBuildsShowPageData = {
  frameTitle: "Partner review shared prototype",
  label: "Partner review",
  pageTitle: "Partner review · Shared prototype",
  previewUrl: "/share/12345678-1234-1234-1234-123456789abc/preview",
  productName: "Replica Hub",
}

describe("SharedBuildsShowPage()", () => {
  it("shows the Build preview without a Hub header", () => {
    const { container } = render(<SharedBuildsShowPage data={PAGE_DATA} />)

    expect(container.querySelector("header")).not.toBeInTheDocument()
    expect(screen.queryByText("Replica Hub")).not.toBeInTheDocument()
    expect(screen.queryByRole("heading")).not.toBeInTheDocument()
    expect(screen.getByTitle("Partner review shared prototype")).toHaveAttribute(
      "src",
      "/share/12345678-1234-1234-1234-123456789abc/preview",
    )
    expect(screen.getByTitle("Partner review shared prototype")).toHaveAttribute(
      "sandbox",
      "allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts",
    )
    expect(screen.queryByText("Sign in with GitHub")).not.toBeInTheDocument()
  })

  it("keeps prototype controls in a floating toolbar", async () => {
    await act(() => {
      render(
        <SharedBuildsShowPage
          data={{
            ...PAGE_DATA,
            controlsIdentity: "shared-build-test",
            controlsOrigin: "https://preview.example.com",
          }}
        />,
      )
      return Promise.resolve()
    })

    expect(screen.getByRole("toolbar")).toHaveClass("build-controls-floating-toolbar")
    expect(screen.getByRole("button", { name: "Controls" })).toBeInTheDocument()
  })
})
