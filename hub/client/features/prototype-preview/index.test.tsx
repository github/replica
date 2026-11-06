import { act, fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { replicaBrowseData } from "@/storybook/fixtures/replica-browse"

import { PrototypePreview } from "."

const props = {
  address: "http://replica.localhost:19500/repositories/2001/replica?return_path=%2F",
  externalAddress: replicaBrowseData.selectedBuild!.previewUrl,
  copy: { ...replicaBrowseData, openInNewTabLabel: "Open in new tab" },
  iframeRef: createRef<HTMLIFrameElement>(),
  previewUrl: replicaBrowseData.selectedBuild!.previewUrl,
  frameTitle: replicaBrowseData.selectedBuild!.frameTitle,
  previewTheme: "light" as const,
}

describe("PrototypePreview()", () => {
  it("preserves the external-tab control for consumers that do not supply minimize", () => {
    render(<PrototypePreview {...props} />)
    const link = screen.getByRole("link", { name: props.copy.openInNewTabLabel })
    expect(link).toHaveAttribute("href", props.externalAddress)
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(screen.getByRole("textbox", { name: props.copy.previewUrlLabel })).toHaveValue(
      props.address,
    )
    expect(
      screen.queryByRole("button", { name: replicaBrowseData.minimizeHubLabel }),
    ).not.toBeInTheDocument()
  })

  it("uses minimize without external-tab copy and keeps the same frame through viewport changes", () => {
    const onClick = vi.fn()
    const minimize = { label: replicaBrowseData.minimizeHubLabel, onClick }
    const { rerender } = render(
      <PrototypePreview {...props} copy={replicaBrowseData} minimize={minimize} />,
    )
    const frame = screen.getByTitle(props.frameTitle)
    expect(frame).toHaveAttribute(
      "sandbox",
      "allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts",
    )
    expect(
      screen.queryByRole("link", { name: props.copy.openInNewTabLabel }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: minimize.label }))
    expect(onClick).toHaveBeenCalledOnce()

    rerender(<PrototypePreview {...props} copy={replicaBrowseData} minimize={minimize} minimized />)
    expect(frame.closest(".review-shell__preview")).toHaveClass("review-shell__preview--minimized")
    expect(screen.getByTitle(props.frameTitle)).toBe(frame)
    expect(frame).toHaveAttribute("src", props.previewUrl)
    rerender(
      <PrototypePreview
        {...props}
        copy={replicaBrowseData}
        minimize={minimize}
        minimized={false}
      />,
    )
    expect(screen.getByTitle(props.frameTitle)).toBe(frame)
    expect(frame.closest(".review-shell__preview")).not.toHaveClass(
      "review-shell__preview--minimized",
    )
  })

  it("keeps controls folds and the same frame through dismissal and minimization", async () => {
    const controlled = { ...props, controlsIdentity: "preview-controls-test" }
    const { rerender } = render(<PrototypePreview {...controlled} />)
    const frame = screen.getByTitle(props.frameTitle)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Controls" }))
      await Promise.resolve()
    })
    fireEvent.click(screen.getByRole("button", { name: "Collapse controls" }))
    rerender(<PrototypePreview {...controlled} minimized />)
    expect(screen.getByTitle(props.frameTitle)).toBe(frame)
    expect(screen.getByRole("button", { name: "Expand controls" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Controls" }))
    expect(screen.queryByRole("button", { name: "Expand controls" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Controls" }))
    expect(screen.getByRole("button", { name: "Expand controls" })).toBeInTheDocument()
    expect(screen.getByTitle(props.frameTitle)).toBe(frame)
    expect(frame).toHaveAttribute("src", props.previewUrl)
  })
})
