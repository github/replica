import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { CheckReadCoverage } from "@utils/prototype-checks/types"
import { ChecksReadCoverage } from "./index"

const files: CheckReadCoverage["files"] = [
  {
    file: "read.tsx",
    required: true,
    status: "read",
    readBytes: 50000,
    totalBytes: 50000,
  },
  {
    file: "partial.tsx",
    required: true,
    status: "partial",
    reason: "partial_read",
    readBytes: 4096,
    totalBytes: 50000,
  },
  {
    file: "unread.ts",
    required: true,
    status: "unread",
    reason: "not_read",
    readBytes: 0,
    totalBytes: 1000,
  },
  {
    file: "blocked.ts",
    required: true,
    status: "blocked",
    reason: "invalid_utf8",
    readBytes: 0,
    totalBytes: 1000,
  },
  {
    file: "asset.png",
    required: false,
    status: "blocked",
    reason: "binary",
    readBytes: 0,
    totalBytes: 1000,
  },
]

describe("ChecksReadCoverage", () => {
  it("shows source-only totals and expands partial, unread, blocked and read file pointers", () => {
    render(<ChecksReadCoverage coverage={{ version: 1, files }} />)
    expect(screen.getByText("Read coverage: 1 of 4 source files")).toBeVisible()
    expect(screen.getByText("partial.tsx")).not.toBeVisible()
    fireEvent.click(screen.getByText("Read coverage: 1 of 4 source files"))
    expect(screen.getByText("Fully read")).toBeVisible()
    expect(screen.getByText("Partially read")).toBeVisible()
    expect(screen.getByText("Unread")).toBeVisible()
    expect(screen.getByText("Not valid UTF-8 text.")).toBeVisible()
    expect(screen.getByText("4,096 of 50,000 bytes read")).toBeVisible()
    expect(screen.getByText("Binary asset; not required for source review.")).toBeVisible()
    expect(screen.getByText(/not executed tests or proof/)).toBeVisible()
  })

  it("distinguishes legacy unrecorded coverage from a measured empty scope", () => {
    const { rerender } = render(<ChecksReadCoverage />)
    expect(screen.getByText("Read coverage was not recorded for this run.")).toBeVisible()
    rerender(<ChecksReadCoverage coverage={{ version: 1, files: [] }} />)
    expect(screen.getByText("Read coverage: 0 of 0 source files")).toBeVisible()
    expect(
      screen.queryByText("Read coverage was not recorded for this run."),
    ).not.toBeInTheDocument()
  })

  it("bounds the file list and keeps unread pointers ahead of fully read files", () => {
    render(
      <ChecksReadCoverage
        coverage={{
          version: 1,
          files: [
            ...Array.from({ length: 30 }, (_, index) => ({
              ...files[0]!,
              file: `read-${index}.tsx`,
            })),
            files[2]!,
          ],
        }}
      />,
    )
    fireEvent.click(screen.getByText("Read coverage: 30 of 31 source files"))
    const list = screen.getByRole("list")
    expect(list.children).toHaveLength(25)
    expect(list.firstElementChild).toHaveTextContent("unread.ts")
    fireEvent.click(screen.getByRole("button", { name: "Show 6 more files" }))
    expect(list.children).toHaveLength(31)
    expect(screen.queryByRole("button", { name: /more files/ })).not.toBeInTheDocument()
  })
})
