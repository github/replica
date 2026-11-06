import { loadBindings } from "./bindings.mjs"

// Screenshot capture waits for the same adapter used by the interactive hosts.
globalThis.ReplicaControls = {
  ready: loadBindings().then(async (bindings) => {
    await bindings?.settled()
    const errors = (bindings?.runtime.list() ?? []).flatMap((controller) => {
      const states = controller.getSnapshot().bindings ?? {}
      return controller.declaration.controls
        .filter((control) => control.type !== "button" && states[control.id]?.error)
        .map(
          (control) => `${controller.declaration.scope}.${control.id}: ${states[control.id].error}`,
        )
    })
    if (errors.length)
      throw new Error(`Controls defaults could not be applied: ${errors.join("; ")}`)
    return bindings
  }),
}
