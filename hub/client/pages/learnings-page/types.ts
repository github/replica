import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"
import type { DecisionModelPanelData } from "@features/decision-model-panel/types"
import type { LearningsLibraryData } from "@features/learnings-library/types"

export interface LearningRun {
  id: number
  startedAt: string
  startedBy: string
  state: "queued" | "running" | "succeeded" | "failed"
  stateLabel: string
  result: string | null
  usage: string
}

type SharedLearningsPageData = RepositoryWorkspaceData & {
  pageTitle: string
  alert: string | null
  notice: string | null
  accessDeniedLabel: string
}

export type LearningsPageData =
  | (SharedLearningsPageData & { accessDenied: true })
  | (SharedLearningsPageData & {
      accessDenied: false
      copy: Record<
        | "heading"
        | "description"
        | "runLabel"
        | "recallHeading"
        | "recallDescription"
        | "recallEmpty"
        | "runsHeading"
        | "runsEmpty",
        string
      > & { runColumns: Record<"started" | "startedBy" | "result" | "usage", string> }
      status: {
        message: string
        refused: boolean
        activity: string | null
        usage: string | null
      }
      run: { path: string; available: boolean }
      agentsPath: string
      loadError: string | null
      identityNotice: string | null
      library: LearningsLibraryData
      recall: { text: string; count: number }
      /** Null when the viewer cannot see run history, so it is hidden, not empty. */
      runs: LearningRun[] | null
      decisionModel: DecisionModelPanelData
    })
