import { describe, expect, it } from "vitest"
import { improvementThreadView } from "."
import type { Note } from "../types"

function createNote(): Note {
  return {
    id: 1,
    localId: "original",
    kind: "improvement_note",
    author: "octocat",
    body: "Clarify the save action.",
    route: "/projects",
    target: "Save",
    selector: "#save",
    rect: { x: 0, y: 0, width: 120, height: 40 },
    thread: { originalStatus: "open", messages: [] },
    status: "open",
    sync: "local",
    revision: 1,
  }
}

describe("improvementThreadView()", () => {
  it("preserves independent original and follow-up author snapshots", () => {
    const note = createNote()
    note.thread = {
      originalStatus: "ready",
      originalAuthor: {
        id: 1,
        login: "original-owner",
        avatarUrl: "https://avatars.githubusercontent.com/u/1",
      },
      messages: [
        {
          id: "follow-up",
          role: "author",
          body: "Another change",
          status: "open",
          author: {
            id: 1,
            login: "renamed-owner",
            avatarUrl: "https://avatars.githubusercontent.com/u/2",
          },
        },
      ],
    }
    const view = improvementThreadView(note)
    expect(view.author).toBe("@original-owner")
    expect(view.avatarUrl).toBe("https://avatars.githubusercontent.com/u/1")
    expect(view.messages[0]).toMatchObject({
      author: "@renamed-owner",
      avatarUrl: "https://avatars.githubusercontent.com/u/2",
    })
  })

  it("keeps an offline unowned author unattributed", () => {
    const note = createNote()
    note.author = "local"
    expect(improvementThreadView(note)).toMatchObject({
      author: "Local author",
      avatarUrl: undefined,
    })
  })
})
