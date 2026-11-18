import { describe, expect, it } from "vitest"

import { LocalBuildPreconditionError } from "../../../domains/local-builds/errors"
import { LocalDevelopmentPreparationError } from "../../../domains/local-development/errors"
import { presentLocalBuildFailure } from "."

describe("presentLocalBuildFailure()", () => {
  it("preserves safe local precondition and preparation guidance", () => {
    expect(
      presentLocalBuildFailure(
        new LocalBuildPreconditionError(
          "Sign in as the local developer before running local Builds.",
        ),
      ),
    ).toBe("Sign in as the local developer before running local Builds.")
    expect(
      presentLocalBuildFailure(
        new LocalDevelopmentPreparationError("Install Docker before running local Builds."),
      ),
    ).toBe("Install Docker before running local Builds.")
  })

  it("uses generic guidance for unclassified failures", () => {
    expect(presentLocalBuildFailure(new Error("private provider details"))).toBe(
      "Local Build synchronization failed; check local mode, storage, Git, Docker, and build action dependencies.",
    )
  })
})
