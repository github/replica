import type { ReactNode } from "react"

import { SidebarCollapseIcon, SidebarExpandIcon } from "@primer/octicons-react"
import { Tooltip } from "@primer/react-brand"

import { FeedbackIcon } from "@components/feedback-icon"
import { RepositoryNavigationItem } from "@components/repository-navigation-item"
import { RepositoryUserMenu } from "@components/repository-user-menu"

import type { WorkspaceAccountData } from "./types"
import "./styles.css"

/** Keeps sidebar collapse and real account controls identical across navigation scopes. */
export function WorkspaceNavigation({
  collapsed,
  className,
  data,
  onCollapsedChange,
  children,
  navigationHeader,
  secondaryNavigation,
}: {
  collapsed: boolean
  className?: string
  data: WorkspaceAccountData
  onCollapsedChange: (collapsed: boolean) => void
  children: ReactNode
  navigationHeader?: ReactNode
  secondaryNavigation?: ReactNode
}) {
  const toggleLabel = collapsed ? data.expandNavigationLabel : data.collapseNavigationLabel
  const collapseButton = (
    <RepositoryNavigationItem
      icon={collapsed ? SidebarCollapseIcon : SidebarExpandIcon}
      label={toggleLabel}
      expanded={!collapsed}
      onClick={() => onCollapsedChange(!collapsed)}
    />
  )
  const feedbackLink = (
    <RepositoryNavigationItem
      href="https://gh.io/replica-feedback"
      icon={FeedbackIcon}
      label={data.feedbackLabel}
      external
    />
  )

  return (
    <aside className={`repository-navigation ${className ?? ""}`} data-collapsed={collapsed}>
      {navigationHeader}
      <div className="repository-navigation__sections">
        <div className="repository-navigation__primary">{children}</div>
        {secondaryNavigation ? (
          <div className="repository-navigation__secondary">{secondaryNavigation}</div>
        ) : null}
      </div>
      <div className="repository-navigation__account">
        {collapsed ? (
          <Tooltip text={data.feedbackLabel} type="label" direction="e">
            {feedbackLink}
          </Tooltip>
        ) : (
          feedbackLink
        )}
        {collapsed ? (
          <Tooltip text={toggleLabel} type="label" direction="e">
            {collapseButton}
          </Tooltip>
        ) : (
          collapseButton
        )}
        <RepositoryUserMenu
          accountMenuLabel={data.accountMenuLabel}
          authenticityToken={data.authenticityToken}
          collapsed={collapsed}
          currentUser={data.currentUser}
          darkThemeLabel={data.darkThemeLabel}
          lightThemeLabel={data.lightThemeLabel}
          signOutLabel={data.signOutLabel}
          signOutPath={data.signOutPath}
          systemThemeLabel={data.systemThemeLabel}
        />
      </div>
    </aside>
  )
}
