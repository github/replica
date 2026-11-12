import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HubUserAvatar } from "."

describe("HubUserAvatar()", () => {
  it("uses a decorative same-origin placeholder when no photo is available", () => {
    const { container } = render(<HubUserAvatar src={null} size={24} className="review-author" />)

    const image = screen.getByRole("presentation")
    expect(image).toHaveAttribute("src", "/avatar-placeholder.svg")
    expect(image).toHaveAttribute("alt", "")
    expect(container.querySelector(".review-author")).toHaveClass("hub-user-avatar--24")
  })

  it("falls back after a failed photo without retrying a failed placeholder", () => {
    render(<HubUserAvatar src="https://avatars.githubusercontent.com/u/1" />)

    const image = screen.getByRole("presentation")
    expect(image).toHaveAttribute("src", "https://avatars.githubusercontent.com/u/1")
    fireEvent.error(image)
    expect(image).toHaveAttribute("src", "/avatar-placeholder.svg")
    expect(image).toHaveAttribute("alt", "")

    const sourceChanges: string[] = []
    const observer = new MutationObserver((records) => {
      sourceChanges.push(...records.map((record) => record.attributeName || ""))
    })
    observer.observe(image, { attributes: true, attributeFilter: ["src"] })
    try {
      fireEvent.error(image)
      expect(image).toHaveAttribute("src", "/avatar-placeholder.svg")
      expect(observer.takeRecords()).toHaveLength(0)
      expect(sourceChanges).toHaveLength(0)
    } finally {
      observer.disconnect()
    }
  })
})
