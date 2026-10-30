import { ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react"
import { Button, Text } from "@primer/react-brand"
import { Fragment, useId, useLayoutEffect, useRef, useState, type MouseEvent } from "react"

import type { Control } from "@utils/prototype-controls/controls.mjs"
import type { ScopeSnapshot } from "@utils/prototype-controls-protocol"
import { EditableField } from "./editable-field"
import { ChoiceField } from "./choice-field"
import type { ControlFieldResult } from "@utils/prototype-controls-connection/types"
import { copy } from "@utils/prototype-canvas/en"
import { controlStatus } from "@utils/prototype-control-status"

import "./styles.css"
import "./ghost-button.css"

type Props = {
  scopes: ScopeSnapshot[]
  disabled?: boolean
  collapsedGroups?: Readonly<Record<string, boolean>>
  onGroupCollapse?: (scope: string, group: string, collapsed: boolean) => void
  onCommand: (
    operation: "update" | "action",
    scope: string,
    id: string,
    value?: unknown,
  ) => ControlFieldResult | Promise<ControlFieldResult>
}

export function ControlsFields({
  scopes,
  disabled = false,
  onCommand,
  collapsedGroups,
  onGroupCollapse,
}: Props) {
  const prefix = useId()
  const root = useRef<HTMLDivElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  const [foldedGroups, setFoldedGroups] = useState<Record<string, boolean>>({})
  useLayoutEffect(() => {
    if (lastFocus.current && !lastFocus.current.isConnected) {
      if (document.activeElement === document.body) root.current?.focus()
      lastFocus.current = null
    }
  }, [scopes])
  function input(scope: ScopeSnapshot, control: Control) {
    if (!scope.snapshot.visible[control.id]) return null
    const id = `${prefix}-${scope.declaration.scope}-${control.id}`
    const value = scope.snapshot.values[control.id]
    function update(next: unknown) {
      return onCommand("update", scope.declaration.scope, control.id, next)
    }
    const binding = scope.snapshot.bindings?.[control.id]
    const status = controlStatus(scope, control)
    const common = {
      id,
      message: status.error
        ? status.available
          ? copy.controlsNotApplied(control.label)
          : copy.controlsUnavailable(control.label)
        : undefined,
      disabled:
        disabled ||
        (Boolean(binding?.error) && binding?.available !== true) ||
        binding?.busy === true,
    }
    switch (control.type) {
      case "button": {
        const action = scope.snapshot.actions[control.id]
        return (
          <div key={control.id} className="controls-field controls-action-field">
            <Button
              type="button"
              size="small"
              variant="secondary"
              className="controls-action-button"
              disabled={common.disabled || !action?.available || action.busy}
              aria-describedby={common.message ? `${id}-unavailable` : undefined}
              aria-busy={action?.busy}
              onClick={() => {
                void onCommand("action", scope.declaration.scope, control.id)
              }}
            >
              {control.label}
              {action?.busy ? copy.controlsActionBusy : ""}
            </Button>
          </div>
        )
      }
      case "boolean":
      case "select":
      case "radio":
      case "segmented":
      case "checkboxGroup":
        return (
          <ChoiceField
            key={control.id}
            {...common}
            control={control}
            value={value}
            onCommit={update}
          />
        )
      case "number":
      case "slider":
      case "text":
      case "textarea":
      case "color":
        return (
          <EditableField
            key={control.id}
            {...common}
            control={control}
            value={value}
            onCommit={update}
          />
        )
    }
  }
  function field(scope: ScopeSnapshot, control: Control) {
    if (!scope.snapshot.visible[control.id]) return null
    const status = controlStatus(scope, control)
    return (
      <Fragment key={control.id}>
        {input(scope, control)}
        {control.type === "button" && status.error ? (
          <Text
            as="p"
            id={`${prefix}-${scope.declaration.scope}-${control.id}-unavailable`}
            size="100"
            variant="muted"
            role="status"
          >
            {status.available
              ? copy.controlsNotApplied(control.label)
              : copy.controlsUnavailable(control.label)}
          </Text>
        ) : null}
      </Fragment>
    )
  }
  const visibleScopes = [
    ...scopes.filter((scope) => scope.declaration.role === "shared"),
    ...scopes.filter((scope) => scope.declaration.role !== "shared"),
  ].filter((scope) =>
    scope.declaration.controls.some((control) =>
      control.group ? scope.snapshot.groups[control.group] : scope.snapshot.visible[control.id],
    ),
  )

  return (
    <div
      ref={root}
      tabIndex={-1}
      role="region"
      aria-label={copy.controlsRegion}
      className="controls-fields"
      onFocusCapture={(event) => {
        lastFocus.current = event.target
      }}
    >
      {visibleScopes.map((scope, index) => {
        const renderedGroups = new Set<string>()
        return (
          <section
            key={scope.declaration.scope}
            className="controls-scope"
            aria-label={scope.declaration.label ?? scope.declaration.scope}
          >
            {index > 0 ? <hr className="controls-scope-divider" /> : null}
            {scope.declaration.controls.map((control) => {
              if (!control.group) return field(scope, control)
              if (renderedGroups.has(control.group)) return null
              renderedGroups.add(control.group)
              const group = scope.declaration.groups?.find((group) => group.id === control.group)
              if (!group || !scope.snapshot.groups[group.id]) return null
              const key = `${scope.declaration.scope}/${group.id}`
              const collapsed = (collapsedGroups ?? foldedGroups)[key] === true
              const bodyId = `${prefix}-${scope.declaration.scope}-${group.id}-group`
              return (
                <fieldset key={group.id} className="controls-group" aria-label={group.label}>
                  <legend>
                    <Button
                      size="small"
                      variant="subtle"
                      type="button"
                      block
                      className="controls-group-toggle controls-ghost-button"
                      aria-label={
                        collapsed
                          ? copy.controlsExpandGroup(group.label)
                          : copy.controlsCollapseGroup(group.label)
                      }
                      aria-controls={bodyId}
                      aria-expanded={!collapsed}
                      trailingVisual={
                        collapsed ? <ChevronRightIcon size={16} /> : <ChevronDownIcon size={16} />
                      }
                      onClick={(event: MouseEvent<HTMLButtonElement>) => {
                        event.currentTarget.focus()
                        if (onGroupCollapse)
                          onGroupCollapse(scope.declaration.scope, group.id, !collapsed)
                        else setFoldedGroups((previous) => ({ ...previous, [key]: !collapsed }))
                      }}
                    >
                      <Text
                        as="span"
                        size="100"
                        weight="bold"
                        variant="muted"
                        className="controls-group-label"
                      >
                        {group.label}
                      </Text>
                    </Button>
                  </legend>
                  <div id={bodyId} className="controls-group-body" hidden={collapsed}>
                    {scope.declaration.controls
                      .filter((control) => control.group === group.id)
                      .map((control) => field(scope, control))}
                  </div>
                </fieldset>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
