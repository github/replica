import {
  AlertIcon,
  HistoryIcon,
  InfoIcon,
  KebabHorizontalIcon,
  LinkIcon,
  MoonIcon,
  PencilIcon,
  RepoForkedIcon,
  SunIcon,
  XIcon,
} from "@primer/octicons-react"
import { ActionMenu, Tooltip } from "@primer/react-brand"
import { NavigationContext } from "@thoughtbot/superglue"
import { useContext, useState } from "react"
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react"

import { BuildStateLabel } from "@components/build-state-label"
import { HubIconButton } from "@components/hub-icon-button"
import { HubUserAvatar } from "@components/hub-user-avatar"
import { PrototypeReviewControls } from "@features/prototype-review-controls"
import { PrototypeWorkspaceHeaderLayout } from "@features/prototype-workspace-header-layout"
import { useHubTheme } from "@hooks/use-hub-theme"
import { useControlQuery } from "@hooks/use-prototype-control-query"
import { withControlQuery } from "@utils/prototype-controls-url/with-control-query"

import type { PrototypeWorkspaceHeaderProps } from "./types"

export function PrototypeWorkspaceHeader({
  data,
  onShowInfo,
  editDetails,
  fork,
  reviewControls,
  onControlsToolbarMount,
}: PrototypeWorkspaceHeaderProps) {
  const { resolvedColorMode, setColorMode } = useHubTheme()
  const { visit } = useContext(NavigationContext)
  const controls = useControlQuery()
  function controlPath(path: string) {
    const url = new URL(withControlQuery(path, controls.query))
    return `${url.pathname}${url.search}${url.hash}`
  }
  const [buildMenu, setBuildMenu] = useState({
    align: "end" as "start" | "end",
    maxWidth: null as number | null,
    height: 460,
  })
  const dark = resolvedColorMode === "dark"
  const themeLabel = dark ? data.useLightThemeLabel : data.useDarkThemeLabel
  const selectedVersion = data.selectedBuild?.number ?? data.latestBuild?.number
  const menuLinks = data.browseReplica
    ? []
    : [
        ...(data.shareLinksPath && data.shareLinksLabel
          ? [
              {
                label: data.shareLinksLabel,
                path: controlPath(data.shareLinksPath),
                icon: LinkIcon,
              },
            ]
          : []),
        { label: data.historyLabel, path: data.historyPath, icon: HistoryIcon },
        ...(data.selectedBuild?.detailsPath && data.selectedBuild.detailsLabel
          ? [
              {
                label: data.selectedBuild.detailsLabel,
                path: data.selectedBuild.detailsPath,
                icon: InfoIcon,
              },
            ]
          : []),
      ]

  function visitMenuLink(
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    path: string,
  ) {
    if (
      "button" in event &&
      (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    )
      return

    event.preventDefault()
    void visit(path, { method: "GET", dataset: { sgVisit: "true" } })
  }

  const authorAvatar = data.browseReplica ? null : (
    <HubUserAvatar src={data.author.avatarUrl} size={28} />
  )

  return (
    <PrototypeWorkspaceHeaderLayout
      author={
        data.browseReplica ? null : data.author.url ? (
          <a
            href={data.author.url}
            aria-label={data.author.label}
            title={data.author.label}
            className="review-shell__author"
          >
            {authorAvatar}
          </a>
        ) : (
          <span aria-label={data.author.label} title={data.author.label}>
            {authorAvatar}
          </span>
        )
      }
      title={
        <a href={data.branchPath} data-sg-visit="true" className="review-shell__branch-link">
          {data.prototypeName ?? data.branchName}
        </a>
      }
      identityTrailing={
        <>
          {!data.browseReplica && editDetails ? (
            <HubIconButton
              icon={PencilIcon}
              variant="invisible"
              size="small"
              aria-label={editDetails.label}
              description={editDetails.label}
              onClick={editDetails.onClick}
            />
          ) : !data.browseReplica && onShowInfo && data.prototypeInfoLabel ? (
            <HubIconButton
              icon={InfoIcon}
              variant="invisible"
              size="small"
              aria-label={data.prototypeInfoLabel}
              description={data.prototypeInfoLabel}
              onClick={onShowInfo}
            />
          ) : null}

          {!data.selectedBuild && data.latestBuild ? (
            <BuildStateLabel state={data.latestBuild.state} label={data.latestBuild.stateLabel} />
          ) : null}
        </>
      }
    >
      {fork ? (
        <HubIconButton
          icon={RepoForkedIcon}
          aria-label={fork.label}
          description={fork.label}
          onClick={fork.onClick}
        />
      ) : null}

      <HubIconButton
        icon={dark ? SunIcon : MoonIcon}
        aria-label={themeLabel}
        description={themeLabel}
        onClick={() => setColorMode(dark ? "light" : "dark")}
      />

      {data.selectedBuild && onControlsToolbarMount ? (
        <span className="review-shell__controls-toolbar" ref={onControlsToolbarMount} />
      ) : null}

      {!data.browseReplica && data.buildOptions.length > 0 ? (
        <div
          className="review-shell__build-menu"
          style={
            {
              "--review-shell-build-menu-max-width": buildMenu.maxWidth
                ? `${buildMenu.maxWidth}px`
                : undefined,
              "--review-shell-build-menu-height": `${buildMenu.height}px`,
            } as CSSProperties
          }
        >
          <ActionMenu selectionVariant="none" size="small" menuAlignment={buildMenu.align}>
            <ActionMenu.Button
              className="review-shell__build-selector"
              variant="secondary"
              aria-label={[
                data.buildSelectionLabel,
                selectedVersion && `v${selectedVersion}`,
                data.newerBuildLabel,
              ]
                .filter(Boolean)
                .join(", ")}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect()
                const scrollport = event.currentTarget
                  .closest(".repository-workspace__content")
                  ?.getBoundingClientRect()
                const left = Math.max(0, scrollport?.left ?? 0) + 8
                const right =
                  Math.min(window.innerWidth, scrollport?.right ?? window.innerWidth) - 8
                const spaceBefore = bounds.right - left
                const spaceAfter = right - bounds.left
                const align = spaceBefore >= spaceAfter ? "end" : "start"
                setBuildMenu({
                  align,
                  maxWidth: Math.max(0, align === "end" ? spaceBefore : spaceAfter),
                  height: Math.max(
                    0,
                    Math.min(window.innerHeight, scrollport?.bottom ?? window.innerHeight) -
                      bounds.bottom -
                      8,
                  ),
                })
              }}
            >
              {selectedVersion ? `v${selectedVersion}` : data.buildSelectionLabel}
              {data.newerBuildLabel ? (
                <span className="review-shell__build-warning" title={data.newerBuildLabel}>
                  <AlertIcon aria-hidden="true" size={16} />
                </span>
              ) : null}
            </ActionMenu.Button>
            <ActionMenu.Overlay aria-label={data.buildSelectionLabel}>
              {data.buildOptions.map((build) => {
                const path = controlPath(build.path)
                return (
                  <ActionMenu.Item
                    key={build.number}
                    as="a"
                    href={path}
                    value={String(build.number)}
                    className="review-shell__build-option"
                    aria-current={build.number === data.selectedBuild?.number ? "page" : undefined}
                    onClick={(event) => {
                      if (
                        !visit ||
                        event.button !== 0 ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                      )
                        return
                      event.preventDefault()
                      void visit(path, { method: "GET", dataset: { sgVisit: "true" } })
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return
                      event.preventDefault()
                      if (visit) {
                        void visit(path, { method: "GET", dataset: { sgVisit: "true" } })
                      } else {
                        event.currentTarget.querySelector("a")?.click()
                      }
                    }}
                  >
                    <span className="review-shell__build-option-content">
                      <span className="review-shell__build-option-label">{build.label}</span>
                      {build.stateLabel ? (
                        <span className="review-shell__build-status">{build.stateLabel}</span>
                      ) : null}
                    </span>
                  </ActionMenu.Item>
                )
              })}
            </ActionMenu.Overlay>
          </ActionMenu>
        </div>
      ) : null}

      {!data.browseReplica && reviewControls ? (
        <PrototypeReviewControls {...reviewControls} noBuild={!data.selectedBuild} />
      ) : null}

      {!data.browseReplica ? (
        <Tooltip text={data.moreActionsLabel} type="description">
          <div className="review-shell__more-menu">
            <ActionMenu selectionVariant="none" size="small" menuAlignment="end">
              <ActionMenu.Button
                className="review-shell__more-trigger"
                variant="secondary"
                aria-label={data.moreActionsLabel}
                leadingVisual={<KebabHorizontalIcon size={16} />}
              >
                {""}
              </ActionMenu.Button>
              <ActionMenu.Overlay aria-label={data.moreActionsLabel}>
                {menuLinks.map(({ label, path, icon: Icon }) => (
                  <ActionMenu.Item
                    key={path}
                    as="a"
                    href={path}
                    value={path}
                    leadingVisual={<Icon size={16} />}
                    onClick={(event) => visitMenuLink(event, path)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return
                      visitMenuLink(event, path)
                    }}
                  >
                    {label}
                  </ActionMenu.Item>
                ))}
              </ActionMenu.Overlay>
            </ActionMenu>
          </div>
        </Tooltip>
      ) : null}

      <div className="review-shell__actions-scroller">
        <HubIconButton
          as="a"
          href={data.closePath ? controlPath(data.closePath) : data.repositoryPath}
          icon={XIcon}
          size="small"
          className="review-shell__close-action"
          data-sg-visit="true"
          aria-label={
            data.closePath ? data.closeLabel : "Close and return to the prototype gallery"
          }
          description={data.closeLabel}
        />
      </div>
    </PrototypeWorkspaceHeaderLayout>
  )
}
