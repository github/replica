# Copilot connection

A Hub administrator can connect one deployment-wide Copilot credential for learning work. Hub obtains the credential from the configured provider, verifies it through the separate `replica-learning copilot status` command, and stores only the provider key, stable provider-configuration digest, connector membership, verification time, and connection generation. It never stores, returns, or logs the credential.

## Configure a provider

No Copilot credential provider is enabled by default. Simple and local deployments can explicitly select one:

- `REPLICA_COPILOT_AUTHENTICATION=ambient-cli` uses the Copilot account signed in where Hub runs.
- `REPLICA_COPILOT_AUTHENTICATION=environment-token` reads `REPLICA_COPILOT_TOKEN` from the deployment secret store.

These providers attribute usage to the represented individual identity. Production deployments should supply a governed provider through the same provider boundary. Restart every Hub API and worker process together after changing provider configuration.

See [Learning foundation](learning-foundation.md) for the command boundary, storage configuration, and current learning lifecycle.

## Administrator flow

1. A current Hub administrator opens `/settings/copilot`.
2. Hub returns the saved connection, connector membership, last successful check, refusal state, and whether a provider is configured.
3. The administrator explicitly confirms connect or disconnect.
4. Hub starts fresh authorization through the provider recorded on the current Hub session.
5. The callback verifies the same session and external identity, then returns to `/settings/copilot/confirm`.
6. Continuing a connection verifies the credential through `replica-learning` before one serializable transaction saves the connection and audits the change. Continuing a disconnection removes the saved connection without changing the provider's credential.

The authorization is short-lived, one-use, and bound to the Hub session, operation, actor membership, and connection generation. Continuing atomically claims it before starting verification, so duplicate submissions do not start duplicate checks. Hub permits at most four deployment checks at once and releases that capacity after the command ends. An abandoned claim stops consuming deployment capacity after 30 seconds, but remains used; the administrator starts a new fresh authorization to retry. A connection change after authorization starts or while Copilot answers returns a conflict instead of overwriting newer state.

Connect, disconnect, page access, and authorization phases write bounded security audits. Audit context contains membership IDs, operations, outcomes, provider keys, and safe reason codes. It never contains credentials or Copilot response payloads.

## Failure and authority behavior

- Without a configured provider, Hub shows the configuration requirement and does not offer connection.
- A refused credential produces a denied change and records refusal state without saving a connection.
- An unavailable command or Copilot service produces a failed change and no connection.
- A stale, cancelled, expired, reused, or mismatched authorization changes nothing.
- When the connector loses their final effective administrator assignment, the same authority transaction disconnects Copilot, advances the connection generation, and audits the automatic change.
- Ending all Hub sessions cancels open sensitive authorizations but intentionally leaves the Copilot connection unchanged.
- Disconnecting leaves the credential in its provider. The operator must revoke or remove it separately when required.

Changing provider configuration changes its stable digest. Hub requires a new successful administrator connection before learning work can use the replacement credential.
