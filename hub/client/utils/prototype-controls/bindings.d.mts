import type { Controls, Declaration, getControlsRuntime } from "./controls.mjs"
export const CONTROLS_DOCUMENT_BYTES: 256000
export type Bindings = {
  runtime: ReturnType<typeof getControlsRuntime>
  pending(): boolean
  subscribe(listener: () => void): () => void
  settled(): Promise<void>
  restore(
    controller: Controls<Declaration>,
    values: Record<string, unknown>,
    guard?: () => void,
  ): Promise<void>
  update(
    controller: Controls<Declaration>,
    id: string,
    value: unknown,
    guard?: () => void,
  ): Promise<void>
  reset(controller?: Controls<Declaration>, guard?: () => void): Promise<void>
  navigate(): void
  takeNavigation(): string | undefined
  dispose(): void
}
export function installBindings(input: unknown): Bindings
export function loadBindings(): Promise<Bindings | undefined>
