export type Scalar = string | number | boolean
export type Condition =
  | { readonly control: string; readonly equals: Scalar }
  | { readonly control: string; readonly in: readonly Scalar[] }
  | { readonly control: string; readonly includes: string }
  | { readonly all: readonly Condition[] }
  | { readonly any: readonly Condition[] }
type Base = {
  readonly id: string
  readonly label: string
  readonly group?: string
  readonly when?: Condition
  readonly binding?: Binding
}
export type Binding =
  | { readonly type: "field" | "button"; readonly selector: string }
  | { readonly type: "style"; readonly selector: string; readonly property: string }
  | { readonly type: "query"; readonly key: string; readonly mode: "in-place" | "navigate" }
  | { readonly type: "hash"; readonly mode: "in-place" | "navigate" }
  | {
      readonly type: "api"
      readonly object: string
      readonly read?: string
      readonly write?: string
      readonly action?: string
      readonly subscribe?: string
      readonly pollMs?: number
    }
export type Control = Base &
  (
    | { readonly type: "boolean"; readonly default: boolean }
    | {
        readonly type: "number"
        readonly default: number
        readonly min: number
        readonly max: number
        readonly step?: number
      }
    | {
        readonly type: "slider"
        readonly default: number
        readonly min: number
        readonly max: number
        readonly step?: number
      }
    | {
        readonly type: "select" | "radio" | "segmented"
        readonly default: string
        readonly options: readonly string[]
      }
    | {
        readonly type: "checkboxGroup"
        readonly default: readonly string[]
        readonly options: readonly string[]
      }
    | {
        readonly type: "text" | "textarea"
        readonly default: string
        readonly minLength?: number
        readonly maxLength?: number
      }
    | { readonly type: "color"; readonly default: string }
    | { readonly type: "button" }
  )
export type Declaration = {
  readonly version: 1
  readonly scope: string
  readonly label?: string
  readonly role?: "shared" | "page"
  readonly container?: string
  readonly panel?: { readonly width: number }
  readonly groups?: readonly {
    readonly id: string
    readonly label: string
    readonly when?: Condition
  }[]
  readonly controls: readonly Control[]
}
type Value<C extends Control> = C extends { type: "button" }
  ? never
  : C extends { type: "boolean" }
    ? boolean
    : C extends { type: "number" | "slider" }
      ? number
      : C extends {
            type: "checkboxGroup"
            options: readonly (infer O extends string)[]
          }
        ? readonly O[]
        : C extends {
              type: "select" | "radio" | "segmented"
              options: readonly (infer O extends string)[]
            }
          ? O
          : string
export type Values<D extends Declaration> = {
  readonly [C in D["controls"][number] as C extends { type: "button" } ? never : C["id"]]: Value<C>
}
export type ActionId<D extends Declaration> = Extract<
  D["controls"][number],
  { type: "button" }
>["id"]
export type Actions<D extends Declaration> = Partial<
  Record<ActionId<D>, () => unknown | Promise<unknown>>
>
export type Snapshot<D extends Declaration> = {
  readonly revision: number
  readonly actions: Readonly<
    Record<string, { readonly available: boolean; readonly busy: boolean }>
  >
  readonly values: Values<D>
  readonly visible: Readonly<Record<D["controls"][number]["id"], boolean>>
  readonly groups: Readonly<Record<string, boolean>>
  readonly bindings?: Readonly<
    Record<string, { readonly error: string; readonly busy: boolean; readonly available?: boolean }>
  >
}
export interface Controls<D extends Declaration> {
  readonly declaration: D
  getSnapshot(this: void): Snapshot<D>
  subscribe(this: void, listener: () => void): () => void
  update<K extends keyof Values<D>>(id: K, value: Values<D>[K]): void
  reset(id?: keyof Values<D>): void
  restore(values: Partial<Values<D>>): void
  refreshActions(): void
  bindingStatus(id: string, error: string, busy?: boolean, available?: boolean): void
  action(id: ActionId<D>): Promise<unknown>
  mount(getHandlers?: () => Actions<D>): () => void
  readonly mountedCount: number
}
export function createControls<const D extends Declaration>(declaration: D): Controls<D>
export function validateControls(input: unknown): Declaration
export type ControlsDocument =
  | Declaration
  | {
      readonly version: 1
      readonly sets: readonly Declaration[]
    }
export function validateControlsDocument(input: unknown): ControlsDocument
export function valueIssue(control: Control, value: unknown): string | null
export const CONTROLS_RUNTIME_VERSION: 2
export function getControlsRuntime(): {
  readonly version: 2
  create<const D extends Declaration>(input: D): Controls<D>
  list(): readonly Controls<Declaration>[]
  subscribe(listener: () => void): () => void
}
export class ControlsValidationError extends Error {
  constructor(issues: ControlsValidationError["issues"])
  readonly issues: readonly {
    path: string
    message: string
    keyword?: string
    params?: unknown
  }[]
}
