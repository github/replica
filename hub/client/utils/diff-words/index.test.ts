import { describe, expect, it } from "vitest"

import { diffWords } from "."

describe("diffWords()", () => {
  it("marks removed and added words and keeps shared words unchanged", () => {
    expect(
      diffWords("Make the primary action easy to spot", "Keep one clear primary action"),
    ).toEqual([
      { kind: "removed", text: "Make the " },
      { kind: "added", text: "Keep one clear " },
      { kind: "unchanged", text: "primary action" },
      { kind: "removed", text: " easy to spot" },
    ])
  })

  it("keeps a rewritten phrase whole instead of matching small shared words inside it", () => {
    expect(
      diffWords(
        "Use one primary button for the main action in a form, and label it with the result it produces.",
        "Use one primary button for the main action. On narrow screens, keep it clear of fields and other controls.",
      ),
    ).toEqual([
      { kind: "unchanged", text: "Use one primary button for the main action" },
      { kind: "removed", text: " in a form, and label it with the result it produces" },
      { kind: "added", text: ". On narrow screens, keep it clear of fields and other controls" },
      { kind: "unchanged", text: "." },
    ])
  })
})
