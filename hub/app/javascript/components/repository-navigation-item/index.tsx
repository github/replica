import type { ElementType, MouseEventHandler } from "react"

import "./styles.css"

type RepositoryNavigationItemProps = {
  icon: ElementType
  label: string
  ariaLabel?: string
  count?: number
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
  count,
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
      {count !== undefined && count > 0 ? (
        <span className="repository-navigation-item__count" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </>
  )

  return href !== undefined ? (
    <a
      href={href}
      className="repository-navigation-item"
      data-has-count={count !== undefined && count > 0 ? "true" : undefined}
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
      data-has-count={count !== undefined && count > 0 ? "true" : undefined}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {content}
    </button>
  )
}
