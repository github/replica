import type { PrototypeWorkspaceHeaderProps } from "@features/prototype-workspace-header/types"
import type { Ref } from "react"

export interface MinimizedReviewToolbarProps {
  reviewControls?: NonNullable<PrototypeWorkspaceHeaderProps["reviewControls"]>
  maximizeLabel: string
  dragLabel: string
  onMaximize: () => void
  controlsSlotRef?: Ref<HTMLSpanElement>
}
