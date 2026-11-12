export type ControlsPanelPosition = { x: number; y: number }

export type ControlsPanelLayout = {
  position: ControlsPanelPosition | null
  collapsed: boolean
  collapsedGroups: Record<string, boolean>
}
