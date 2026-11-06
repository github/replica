import { describe, expect, it } from "vitest"

import { describeCommand } from "./index.ts"

describe("release command descriptions", () => {
  it("identifies revision and app operations without using resource arguments in labels", () => {
    const operations = [
      ["containerapp", "revision", "show"],
      ["containerapp", "revision", "activate"],
      ["containerapp", "revision", "deactivate"],
      ["containerapp", "show"],
    ]
    const labels = new Set<string>()
    for (const operation of operations) {
      const description = describeCommand("az", operation)
      expect(description.name).toBe(["az", ...operation].join("."))
      expect(description.label).not.toBe("External command")
      expect(
        describeCommand("az", [
          ...operation,
          "--name",
          "synthetic-private-app",
          "--revision",
          "synthetic-private-revision",
          "--resource-group",
          "synthetic-private-group",
          "--subscription",
          "synthetic-private-subscription",
        ]),
      ).toEqual(description)
      labels.add(description.label)
    }
    expect(labels.size).toBe(operations.length)
  })
})
