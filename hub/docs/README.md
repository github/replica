# Hub documentation

Hub is being rebuilt. The [Hub overview](../README.md) describes what the baseline provides and which product capabilities are not implemented.

- [Architecture](architecture.md): accepted stack, boundaries, and non-goals.
- [Routed frontend](frontend.md): connected routes, provisional API contracts, local modes, and retained-page inventory.
- [Rails conversion route map](frontend.md#rails-conversion-route-map): Rails page URLs, current React Router destinations, and compatibility redirects.
- [Code architecture conventions](backend-architecture.md): repositories, integrations, utilities, and domains.
- [Coding conventions](coding-conventions.md): frontend layers and interface rules.
- [Development](development.md): local API and frontend setup.
- [Deployment](deployment.md): production image, runtime roles, setup, and health.
- [Artifact storage](artifact-storage.md): provider selection and immutable byte storage.
- [Database](database.md): Prisma schema conventions, migrations, and the shared client.
- [Authentication and Hub sessions](authentication.md): provider-neutral proof, reusable administrator enrollment, admission, browser sessions, and existing-user administrator management.
- [Microsoft Entra OIDC](entra-oidc.md): single-tenant application, app-role, client-authentication, and manual setup contract.
- [Logging](logging.md): application events, automatic request records, and payload safety.
- [Telemetry](telemetry.md): explicit OpenTelemetry spans, safe attributes, and process lifetime.
- [Background jobs](background-jobs.md): PostgreSQL queues, workers, schedules, setup, and test isolation.
- [Learning foundation](learning-foundation.md): Copilot connection, private storage, secure command execution, and deferred repository seams.
- [WebSocket updates](websockets.md): local broadcasts, subscriptions, access hooks, and connection limits.
- [Testing and operations](testing-and-operations.md): baseline checks and their limits.
- [Storybook](storybook.md): retained presentation, fixtures, and screenshot evidence.
- [Prototype canvas](prototype-canvas.md): the separately retained extension.
- [Prototype Controls](prototype-controls.md): shared Controls source and generated assets.

The [shared contributor guides](../../docs/README.md) apply across Replica.
