import { describe, expect, it } from "vitest"

import canvasStyles from "../styles.css?inline"
import reactionStyles from "@features/review-comment-reactions/styles.css?inline"
import improvementStyles from "@features/prototype-canvas-improvement-notes/styles.css?inline"
import threadStyles from "@features/prototype-canvas-improvement-threads/styles.css?inline"

describe("canvas counters", () => {
  it("shares a neutral transparent 10% fill without changing outside-canvas defaults", () => {
    const canvas = canvasStyles.match(/\.canvas-base \{\s*(--hub-counter-background:[^;]+;)/)?.[1]
    expect(canvas).toContain(
      "--hub-counter-background: color-mix(in srgb, var(--hub-fg-default) 10%, transparent)",
    )
    expect(reactionStyles).toContain("background: var(--hub-counter-background, transparent)")
    expect(improvementStyles).not.toContain(".improvement-demo__fix-all .hub-counter")
    expect(improvementStyles).not.toContain(".improvement-demo__fix-all:disabled .hub-counter")
    expect(threadStyles).not.toContain(".thread-sample__fix-all .hub-counter")
  })
})
