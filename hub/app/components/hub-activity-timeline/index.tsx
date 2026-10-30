import type { HTMLAttributes, ReactNode } from "react"

import { Timeline } from "@primer/react-brand"

export type HubActivityTimelineItem = {
  id: string
  dateTime: string
  label: ReactNode
}

type Props = Omit<HTMLAttributes<HTMLUListElement>, "children"> & {
  items: readonly HubActivityTimelineItem[]
}

export function HubActivityTimeline({ items, ...props }: Props) {
  return (
    <Timeline {...props}>
      {items.map((item) => (
        <Timeline.Item key={item.id}>
          <time dateTime={item.dateTime}>{item.label}</time>
        </Timeline.Item>
      ))}
    </Timeline>
  )
}
