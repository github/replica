import { Text } from "@primer/react-brand"
import { useEffect, useSyncExternalStore } from "react"

import type { Controls, Declaration } from "@utils/prototype-controls/controls.mjs"

export function MountedPreview({ controller }: { controller: Controls<Declaration> }) {
  const { values } = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => controller.mount(), [controller])
  return (
    <section aria-label={`${controller.declaration.label} preview`}>
      <Text as="strong" size="200">
        {controller.declaration.label}
      </Text>
      <dl className="controls-example__values-list">
        {controller.declaration.controls
          .filter((control) => control.type !== "button")
          .map((control) => (
            <div key={control.id}>
              <dt>{control.label}</dt>
              <dd>{JSON.stringify(values[control.id])}</dd>
            </div>
          ))}
      </dl>
    </section>
  )
}
