import type { HTMLAttributes, ReactNode } from "react"

import { Button, Heading, Text } from "@primer/react-brand/esm"

import "./styles.css"

type Props = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  visual?: ReactNode
  heading?: ReactNode
  description: ReactNode
} & (
    | { actionLabel: string; onAction: () => void; actionHref?: never }
    | { actionLabel: string; actionHref: string; onAction?: never }
    | { actionLabel?: never; onAction?: never; actionHref?: never }
  )

export function HubEmptyState({
  visual,
  heading,
  description,
  actionLabel,
  actionHref,
  onAction,
  className,
  ...props
}: Props) {
  return (
    <section {...props} className={`hub-empty-state${className ? ` ${className}` : ""}`}>
      {visual ? (
        <div className="hub-empty-state__visual" aria-hidden="true">
          {visual}
        </div>
      ) : null}
      <div role="status" aria-live="polite">
        {heading ? (
          <Heading as="h2" size="5" className="hub-empty-state__heading">
            {heading}
          </Heading>
        ) : null}
        <Text as="p" size="200" variant="muted" className="hub-empty-state__description">
          {description}
        </Text>
      </div>
      {actionHref ? (
        <Button
          as="a"
          href={actionHref}
          data-sg-visit="true"
          variant="primary"
          className="hub-empty-state__action"
        >
          {actionLabel}
        </Button>
      ) : actionLabel ? (
        <Button
          type="button"
          variant="secondary"
          className="hub-empty-state__action"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      ) : null}
    </section>
  )
}
