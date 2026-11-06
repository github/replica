import { useId } from "react"
import type { ComponentPropsWithRef, ElementType } from "react"

import { Button, Tooltip } from "@primer/react-brand"

import { HubSpinner } from "../hub-spinner"
import { HubVisuallyHidden } from "../hub-visually-hidden"

import "./styles.css"

type CommonProps = {
  icon: ElementType
  "aria-label": string
  description?: string
  loading?: boolean
  size?: "small" | "medium"
  variant?: "default" | "invisible" | "danger"
}

type ButtonProps = CommonProps &
  Omit<ComponentPropsWithRef<"button">, keyof CommonProps | "children"> & {
    as?: "button"
    href?: never
  }

type LinkProps = CommonProps &
  Omit<ComponentPropsWithRef<"a">, keyof CommonProps | "children"> & {
    as: "a"
    href: string
  }

export function HubIconButton(props: ButtonProps | LinkProps) {
  const descriptionId = useId()
  const {
    as,
    href,
    ref,
    icon: Icon,
    description,
    loading = false,
    size = "medium",
    variant = "default",
    className,
    ...elementProps
  } = props
  const classes = `hub-icon-button${size === "small" ? " hub-icon-button--small" : ""}${variant === "invisible" ? " hub-icon-button--invisible" : ""}${variant === "danger" ? " hub-icon-button--danger" : ""}${className ? ` ${className}` : ""}`
  const brandVariant = variant === "invisible" ? "subtle" : "secondary"
  const showDescription = Boolean(
    description &&
    !elementProps.title &&
    !elementProps["aria-describedby"] &&
    !("disabled" in elementProps && elementProps.disabled),
  )
  const describedBy =
    [elementProps["aria-describedby"], description && !showDescription ? descriptionId : undefined]
      .filter(Boolean)
      .join(" ") || undefined
  const title =
    elementProps.title ??
    (showDescription ? undefined : (description ?? elementProps["aria-label"]))
  const label =
    description && !showDescription ? (
      <HubVisuallyHidden id={descriptionId}>{description}</HubVisuallyHidden>
    ) : null
  const visual = loading ? <HubSpinner decorative size="small" /> : <Icon size={16} />
  const busy = loading ? true : elementProps["aria-busy"]

  if (as === "a") {
    // Brand types its ref as a button even when it renders an anchor.
    const linkRef = ref as ComponentPropsWithRef<"button">["ref"]
    const link = (
      <Button
        {...(elementProps as ComponentPropsWithRef<"a">)}
        ref={linkRef}
        as="a"
        href={href}
        leadingVisual={visual}
        variant={brandVariant}
        size={size}
        className={classes}
        aria-busy={busy}
        aria-describedby={describedBy}
        title={title}
      >
        {label}
      </Button>
    )

    return showDescription && description ? (
      <Tooltip ref={ref} text={description} type="description">
        {link}
      </Tooltip>
    ) : (
      link
    )
  }

  const button = (
    <Button
      {...(elementProps as ComponentPropsWithRef<"button">)}
      ref={ref}
      type={(elementProps as ComponentPropsWithRef<"button">).type ?? "button"}
      leadingVisual={visual}
      variant={brandVariant}
      size={size}
      className={classes}
      aria-busy={busy}
      aria-describedby={describedBy}
      title={title}
    >
      {label}
    </Button>
  )

  return showDescription && description ? (
    <Tooltip ref={ref} text={description} type="description">
      {button}
    </Tooltip>
  ) : (
    button
  )
}
