import type { PrototypeWorkspaceHeaderProps } from "@features/prototype-workspace-header/types"

export type PrototypeReviewControlsProps = NonNullable<
  PrototypeWorkspaceHeaderProps["reviewControls"]
> & {
  noBuild?: boolean
}
