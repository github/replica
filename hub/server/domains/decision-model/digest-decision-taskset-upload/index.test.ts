import { describe, expect, it } from "vitest"

import { digestDecisionTasksetUpload } from "."

describe("digestDecisionTasksetUpload()", () => {
  it("matches the Python runtime semantic digest vector", () => {
    expect(
      digestDecisionTasksetUpload({
        schemaVersion: "replica.decision-taskset-upload/v1",
        manifest: { schemaVersion: "replica.decision-taskset/v1", title: "Café" },
        tasks: [
          {
            id: "task_111111111111111111111111",
            split: "train",
            state: { rules: [] },
            images: [
              {
                role: "candidate",
                path: "images/screen.png",
                mediaType: "image/png",
                digest: `sha256:${"a".repeat(64)}`,
                size: "desktop",
                theme: "light",
              },
            ],
            questions: { rule: { type: "noul" } },
            labels: { rule: { answer: true } },
            provenance: { route: "/" },
          },
        ],
        images: [],
      }),
    ).toBe("sha256:c0510e5cc39a3da4498e1eb645afa3290d85719676a14a3a43bdc3194adf8ba4")
  })
})
