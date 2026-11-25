import type { ElementType, MouseEventHandler } from "react"

import "./styles.css"

type RepositoryNavigationItemProps = {
  icon: ElementType
  label: string
  ariaLabel?: string
} & (
  | {
      href: string
      selected?: boolean
      external?: boolean
      onClick?: MouseEventHandler<HTMLAnchorElement>
      expanded?: never
    }
  | {
      href?: never
      selected?: never
      external?: never
      onClick: () => void
      expanded: boolean
    }
)

/** Renders a sidebar destination or a control with the same row treatment. */
export function RepositoryNavigationItem({
  ariaLabel,
  expanded,
  external = false,
  href,
  icon: Icon,
  label,
  onClick,
  selected = false,
}: RepositoryNavigationItemProps) {
  const content = (
    <>
      <span className="repository-navigation-item__icon">
        <Icon size={16} />
      </span>
      <span className="repository-navigation-item__label">{label}</span>
    </>
  )

  return href !== undefined ? (
    <a
      href={href}
      className="repository-navigation-item"
      data-active={selected ? "true" : undefined}
      aria-current={selected ? "page" : undefined}
      aria-label={ariaLabel}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      onClick={onClick}
    >
      {content}
    </a>
  ) : (
    <button
      type="button"
      className="repository-navigation-item"
      aria-expanded={expanded}
      onClick={onClick}
    >
      {content}
    </button>
  )
}
