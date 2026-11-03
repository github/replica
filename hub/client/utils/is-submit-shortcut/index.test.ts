import { describe, expect, it, vi } from "vitest"

import { isSubmitShortcut } from "."

describe("isSubmitShortcut()", () => {
  describe.each([
    { platform: "MacIntel", modifier: { metaKey: true }, wrongModifier: { ctrlKey: true } },
    { platform: "Win32", modifier: { ctrlKey: true }, wrongModifier: { metaKey: true } },
    { platform: "Linux x86_64", modifier: { ctrlKey: true }, wrongModifier: { metaKey: true } },
  ])("on $platform", ({ platform, modifier, wrongModifier }) => {
    it("matches the platform's submit shortcut", () => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
      expect(isSubmitShortcut(new KeyboardEvent("keydown", { key: "Enter", ...modifier }))).toBe(
        true,
      )
    })

    it.each([
      { key: "a" },
      { shiftKey: true },
      { altKey: true },
      { metaKey: true, ctrlKey: true },
      { isComposing: true },
      { keyCode: 229 },
      { repeat: true },
    ])("rejects extra modifiers, composition and repeats: %j", (overrides) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
      expect(
        isSubmitShortcut(new KeyboardEvent("keydown", { key: "Enter", ...modifier, ...overrides })),
      ).toBe(false)
    })

    it("rejects plain Enter and the other platform's modifier", () => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
      expect(isSubmitShortcut(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(false)
      expect(
        isSubmitShortcut(new KeyboardEvent("keydown", { key: "Enter", ...wrongModifier })),
      ).toBe(false)
    })

    it("allows plain Enter only when the caller opts in", () => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
      expect(
        isSubmitShortcut(new KeyboardEvent("keydown", { key: "Enter" }), {
          allowPlainEnter: true,
        }),
      ).toBe(true)
      expect(
        isSubmitShortcut(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }), {
          allowPlainEnter: true,
        }),
      ).toBe(false)
      expect(
        isSubmitShortcut(new KeyboardEvent("keydown", { key: "Enter", ...wrongModifier }), {
          allowPlainEnter: true,
        }),
      ).toBe(false)
    })
  })
})
