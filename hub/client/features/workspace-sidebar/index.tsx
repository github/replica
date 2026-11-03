import { Fragment } from "react"
import type { MouseEventHandler, ReactNode } from "react"

import {
  BeakerIcon,
  CopilotIcon,
  GraphIcon,
  HomeIcon,
  LightBulbIcon,
  LinkIcon,
  MarkGithubIcon,
  PeopleIcon,
  PlusIcon,
  RepoIcon,
  ShieldCheckIcon,
  SignOutIcon,
} from "@primer/octicons-react"
import { Tooltip } from "@primer/react-brand"

import { RepositoryNavigationItem } from "@components/repository-navigation-item"
import { RepositorySelector } from "@components/repository-selector"
import type { RepositorySelectorStatus } from "@components/repository-selector/types"
import { WorkspaceNavigation } from "@components/workspace-navigation"

import type { WorkspaceSidebarData } from "./types"
import { WorkspaceInbox } from "./inbox"

const administrationIcons = {
  github: MarkGithubIcon,
  copilot: CopilotIcon,
  admins: PeopleIcon,
  sharing: LinkIcon,
  sessions: SignOutIcon,
}

/** Uses one sidebar while keeping repository and Hub permissions independent. */
export function WorkspaceSidebar({
  collapsed,
  data,
  inboxPreview,
  onInboxClick,
  onCollapsedChange,
  repositoryChoices,
}: {
  collapsed: boolean
  data: WorkspaceSidebarData
  inboxPreview?: (close: () => void) => ReactNode
  onInboxClick?: MouseEventHandler<HTMLAnchorElement>
  onCollapsedChange: (collapsed: boolean) => void
  repositoryChoices?: RepositorySelectorStatus
}) {
  const repository = data.repository
  const repositoryLinks = repository
    ? [
        {
          label: repository.newPrototypeLabel,
          path: repository.newPrototypePath,
          section: "new",
          icon: PlusIcon,
        },
        {
          label: repository.prototypesLabel,
          path: repository.prototypesPath,
          section: "prototypes",
          icon: BeakerIcon,
        },
        {
          label: repository.analyticsLabel,
          path: repository.analyticsPath,
          section: "analytics",
          icon: GraphIcon,
        },
        {
          label: repository.learningsLabel,
          path: repository.learningsPath,
          section: "learnings",
          icon: LightBulbIcon,
        },
      ]
    : [{ label: data.repositoriesLabel, path: data.repositoriesPath, icon: RepoIcon }]
  const primaryLinks = [
    { label: data.welcomeLabel, path: data.welcomePath, section: "welcome", icon: HomeIcon },
    ...repositoryLinks,
  ]
  const settingsLinks = [
    ...(data.administrationLinks ?? []).map((link) => ({
      ...link,
      icon: administrationIcons[link.section],
    })),
    {
      label: data.securityAuditLabel,
      path: data.securityAuditPath,
      section: "security",
      icon: ShieldCheckIcon,
    },
  ].flatMap((link) =>
    link.path && link.label ? [{ ...link, path: link.path, label: link.label }] : [],
  )

  return (
    <WorkspaceNavigation
      data={data}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      navigationHeader={
        repository ? (
          <RepositorySelector
            ariaLabel={repository.repositorySelectorLabel}
            collapsed={collapsed}
            menuLabel={repository.repositoryMenuLabel}
            repositories={repository.repositories}
            selectedRepositoryId={repository.selectedRepositoryId}
            status={repositoryChoices}
          />
        ) : null
      }
      secondaryNavigation={
        settingsLinks.length ? (
          <nav aria-label={data.settingsNavigationLabel ?? data.navigationLabel}>
            <ul className="repository-navigation__list">
              {settingsLinks.map((link) => {
                const item = (
                  <RepositoryNavigationItem
                    href={link.path}
                    icon={link.icon}
                    label={link.label}
                    selected={
                      data.selectedSection === link.section ||
                      (link.section === "security" && data.selectedSection === "audit")
                    }
                  />
                )
                return (
                  <li key={link.section}>
                    {collapsed ? (
                      <Tooltip text={link.label} type="label" direction="e">
                        {item}
                      </Tooltip>
                    ) : (
                      item
                    )}
                  </li>
                )
              })}
            </ul>
          </nav>
        ) : null
      }
    >
      <nav className="repository-navigation__links" aria-label={data.navigationLabel}>
        <ul className="repository-navigation__list">
          {primaryLinks.map((link) => {
            if (!link.path || !link.label) return null
            const selectedSection = data.selectedSection ?? "prototypes"
            const item = (
              <RepositoryNavigationItem
                href={link.path}
                icon={link.icon}
                label={link.label}
                selected={"section" in link && selectedSection === link.section}
              />
            )
            return (
              <Fragment key={"section" in link ? link.section : link.path}>
                <li>
                  {collapsed ? (
                    <Tooltip text={link.label} type="label" direction="e">
                      {item}
                    </Tooltip>
                  ) : (
                    item
                  )}
                </li>
                {"section" in link && link.section === "prototypes" ? (
                  <WorkspaceInbox
                    collapsed={collapsed}
                    data={data}
                    inboxPreview={inboxPreview}
                    onInboxClick={onInboxClick}
                  />
                ) : null}
              </Fragment>
            )
          })}
          {!repository ? (
            <WorkspaceInbox
              collapsed={collapsed}
              data={data}
              inboxPreview={inboxPreview}
              onInboxClick={onInboxClick}
            />
          ) : null}
        </ul>
      </nav>
    </WorkspaceNavigation>
  )
}
