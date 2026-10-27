# Shadcn browser validation

Follow the [shared browser workflow](../skills/browser-canvas-validation/WORKFLOW.md) and [Replica canvas preflight](../../REPLICA.md#canvas-preflight). Open only the authorized local or hosted preview and keep its path, query and hash.

Verify Dashboard renders its official cards, chart and table. Follow Records, filter by a fixture title, open its detail dialog and close it. Follow Settings, change the display name and save; verify successful browser-local feedback. Saving this sample preference is local only and must be within the requested check.

Check `#/records` and `#/settings` from a direct link as well as navigation. Test a narrow viewport and a production preview when changing routing, layout or asset paths. Do not claim a rendered pass from an HTTP response or production build alone.
