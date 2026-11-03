import type { HTMLAttributes, ReactNode } from "react"

import { AlertIcon, CheckCircleIcon, InfoIcon, StopIcon, XIcon } from "@primer/octicons-react"
import { Text } from "@primer/react-brand"

import { HubIconButton } from "../hub-icon-button"

import "./styles.css"

type Props = Omit<HTMLAttributes<HTMLElement>, "title" | "children" | "role"> & {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  action?: ReactNode
  variant: "critical" | "warning" | "info" | "success"
  layout?: "compact"
} & ({ onDismiss: () => void; dismissLabel: string } | { onDismiss?: never; dismissLabel?: never })

export function HubAlert({
  title,
  description,
  children,
  action,
  variant,
  layout,
  onDismiss,
  dismissLabel,
  className,
  ...props
}: Props) {
  const Icon =
    variant === "critical"
      ? StopIcon
      : variant === "success"
        ? CheckCircleIcon
        : variant === "info"
          ? InfoIcon
          : AlertIcon

  return (
    <div
      {...props}
      role={variant === "critical" || variant === "warning" ? "alert" : "status"}
      className={`hub-alert hub-alert--${variant}${layout === "compact" ? " hub-alert--compact" : ""}${className ? ` ${className}` : ""}`}
    >
      <Icon className="hub-alert__icon" size={20} aria-hidden="true" />

      <div className="hub-alert__content">
        <Text as="p" size="100" className="hub-alert__message">
          <strong className="hub-alert__title">{title}</strong>
          {description ? <span className="hub-alert__description">{description}</span> : null}
        </Text>

        {children}
      </div>

      {action || onDismiss ? (
        <div className="hub-alert__action">
          {action}
          {onDismiss && dismissLabel ? (
            <HubIconButton
              icon={XIcon}
              aria-label={dismissLabel}
              title={dismissLabel}
              variant="invisible"
              size="small"
              onClick={onDismiss}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
