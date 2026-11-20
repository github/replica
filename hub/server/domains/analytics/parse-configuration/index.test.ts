import { describe, expect, it } from "vitest"

import type { DestinationInput } from "../types"
import { parseAnalyticsConfiguration } from "."

describe("same-recipient custom destination edits", () => {
  const policy = { hubHosts: ["hub.example.com"] }
  const fields = {
    name: "Synthetic",
    endpoint: "https://events.example.com/collect",
    headers: {
      authorization: { $secret: "auth" },
      "x-route": { $secret: "route" },
    },
    template: { event: { $field: "event_name" } },
    secrets: [
      { name: "auth", value: "Bearer synthetic" },
      { name: "route", value: "synthetic-route" },
    ],
  }
  function parse(
    configuration: unknown,
    previous?: ReturnType<typeof parseAnalyticsConfiguration>["configuration"],
  ) {
    const input: DestinationInput = {
      provider: "custom",
      eventTypes: ["prototype_registered"],
      configuration,
    }
    return parseAnalyticsConfiguration(input, policy, previous)
  }

  it("allows auth rotation but refuses new routing even if its secret reference is unchanged", () => {
    const previous = parse(fields).configuration
    const keepPending = {
      ...fields,
      keepPending: true,
      secrets: [
        { name: "auth", value: "Bearer rotated" },
        { name: "route", value: "" },
      ],
    }
    expect(parse(keepPending, previous)).toMatchObject({
      changedRecipient: true,
      keepPending: true,
    })
    expect(() =>
      parse(
        {
          ...keepPending,
          secrets: [
            { name: "auth", value: "" },
            { name: "route", value: "different-route" },
          ],
        },
        previous,
      ),
    ).toThrow("Pending events can be kept only")
  })
})
