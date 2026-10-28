# Setup and troubleshooting

## Canvas commenting

Session setup installs or enables the Replica plugin. See
[Connect the Replica canvas](REPLICA.md#connect-the-replica-canvas) for setup and
missing-canvas recovery, including the separate plugin and extension switches.
Start the prototype with its actual command and open the printed URL in the
installed Replica canvas.

For CLI plugins or manually copied extensions, follow the plugin's [update instructions](https://github.com/github/replica/blob/main/.github/extensions/replica-prototype/README.md#update-or-switch-source). Keep one active provider and preserve credential/artifact directories and existing value files.

Each preview gets a separate loopback proxy that injects the bundled bridge. Reopening a panel reuses its proxy; closing it stops only that proxy, not the prototype server. The address bar and external-browser action retain the original URL, including path, query and hash.

### Check the connection

1. Verify the actual server URL responds with the intended prototype. Do not guess a port or start a duplicate server.
2. Reconnect that URL in the Replica canvas. Reopen the panel after updating the plugin.
3. Check proxy requests and console errors. `/__replica/canvas/loader.js` and `/__replica/canvas/runtime.js` belong to the proxy origin, not a privileged canvas endpoint.
4. Confirm the current version-1 handshake from the expected iframe origin. HTTP success alone does not prove readiness.

Only unauthenticated loopback previews are supported. Cookies and authorization are not forwarded; authentication responses fail explicitly. CSP and framing policies remain authoritative. HTTPS certificate checks stay enabled. Do not remove protections to establish a connection.

The proxy has a different origin and does not copy original-server localStorage. Hardcoded upstream assets, custom HMR ports or origin-dependent CORS may need app-specific support. Report the specific policy or origin limitation.

**Fix with Copilot** requests scoped diagnosis. Repairs and repository commands need separate approval. **Dismiss** leaves the preview usable. Neither action commits, pushes or publishes. Hub authorization and a matching imported Build remain required for review actions.

### Controls

Put versioned definitions in `public/controls.replica.json` or the build tool's equivalent static-assets directory. Each control binds an existing native field/button, CSS property, app-owned query/hash setting or optional exposed app API. See [Prototype controls](REPLICA.md#prototype-controls) and the [authoring reference](.agents/skills/prototype-controls/references/authoring.md).

Reload the preview page after editing definitions. Missing definitions mean no Controls; invalid definitions show a local error without breaking the app and reject publication when present in the retained Build. Missing or stale targets disable only the affected control. The ordinary app remains usable without Replica.

Canvas and Hub save ordinary overrides in the prototype URL as `rc.<scope>.<controlId>`, never in private capability URLs or value files. Reset restores defaults and removes overrides, including inactive sets. Existing private files stay untouched and are not restored.
