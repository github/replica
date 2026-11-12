import type { PropsWithChildren } from "react"

import { PrototypeWorkspaceHeader } from "@features/prototype-workspace-header"
import { PrototypeWorkspaceBody } from "@features/prototype-workspace-body"
import type {
  PrototypeWorkspaceHeaderData,
  PrototypeWorkspaceHeaderProps,
  ReplicaWorkspaceHeaderData,
} from "@features/prototype-workspace-header/types"
import { RepositoryWorkspace } from "@features/repository-workspace"
import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"

import "./styles.css"

export type PrototypeWorkspaceData = RepositoryWorkspaceData & PrototypeWorkspaceHeaderData
export type ReplicaWorkspaceData = RepositoryWorkspaceData & ReplicaWorkspaceHeaderData

export function PrototypeWorkspace({
  children,
  data,
  onShowInfo,
  editDetails,
  fork,
  preview = false,
  reviewControls,
  onControlsToolbarMount,
}: PropsWithChildren<{
  data: PrototypeWorkspaceData | ReplicaWorkspaceData
  onShowInfo?: () => void
  editDetails?: PrototypeWorkspaceHeaderProps["editDetails"]
  fork?: PrototypeWorkspaceHeaderProps["fork"]
  preview?: boolean
  reviewControls?: PrototypeWorkspaceHeaderProps["reviewControls"]
  onControlsToolbarMount?: PrototypeWorkspaceHeaderProps["onControlsToolbarMount"]
}>) {
  return (
    <RepositoryWorkspace data={data} defaultNavigationCollapsed>
      <div className="review-layout">
        <PrototypeWorkspaceHeader
          data={data}
          onShowInfo={onShowInfo}
          editDetails={editDetails}
          fork={fork}
          reviewControls={reviewControls}
          onControlsToolbarMount={onControlsToolbarMount}
        />

        {preview ? children : <PrototypeWorkspaceBody>{children}</PrototypeWorkspaceBody>}
      </div>
    </RepositoryWorkspace>
  )
}
