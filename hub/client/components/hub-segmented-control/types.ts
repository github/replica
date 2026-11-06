import type { ElementType } from "react"

export interface HubSegmentedControlOption<Value extends string> {
  disabled?: boolean
  icon?: ElementType
  label: string
  value: Value
}
