# Copilot connection

A Hub administrator can connect one operator-provided Copilot token for the deployment. Hub checks the token through the Copilot SDK, stores only its SHA-256 digest and connection provenance, and never returns or logs the credential.

The connection is an administration foundation. No rebuilt Hub product job consumes it yet.

## Configure the token

The operator creates a fine-grained personal access token whose only account permission is Copilot requests, stores it as `REPLICA_COPILOT_TOKEN`, and restarts every Hub API and worker process with the same configuration.

Hub reads the token only from the process environment. The database keeps its digest so future Copilot results can be associated with the configured credential without storing the credential itself.

## Administrator flow

1. A current Hub administrator opens `/settings/copilot`.
2. Hub returns the connection state, connector membership, last successful check, and whether a token is configured.
3. The administrator explicitly confirms connect or disconnect.
4. Hub starts fresh authorization through the provider recorded on the current Hub session.
5. The callback verifies the same session and external identity, then returns to `/settings/copilot/confirm`.
6. Continuing a connection checks the configured token with the Copilot SDK before one serializable transaction saves the connection and audits the change. Continuing a disconnection clears the database state without changing the operator's secret.

The authorization is short-lived, one-use, and bound to the Hub session, operation, actor membership, and connection generation. Continuing atomically claims it before starting the SDK, so duplicate submissions do not start duplicate checks. Hub permits at most four deployment token checks at once and releases that capacity only after the SDK call ends; an abandoned claim expires after 30 seconds. A connection change after authorization starts or while Copilot checks the token returns a conflict instead of overwriting newer state.

## Stored state

Hub stores one global connection record:

- the membership that connected Copilot;
- the token digest;
- the last successful verification time;
- a generation that orders connection changes;
- an optional refusal time reserved for a Copilot consumer to record a rejected current token.

Connect, disconnect, page access, and authorization phases write bounded security audits. Audit context contains membership IDs, operations, outcomes, and safe reason codes. It never contains the token or Copilot response payloads.

## Failure behavior

- Without `REPLICA_COPILOT_TOKEN`, Hub shows the configuration requirement and does not offer connection.
- A token Copilot refuses produces a denied change and no connection.
- An unavailable Copilot service produces a failed change and no connection.
- A stale, cancelled, expired, reused, or mismatched authorization changes nothing.
- When the connector loses their final effective administrator assignment, the same authority transaction disconnects Copilot and audits the result.
- Disconnecting leaves the token in the operator's secret store. The token owner must revoke it separately when required.

Token replacement requires a coordinated restart so every process uses the same environment. Do not overlap old-token and new-token Hub processes. The Copilot page detects that the configured digest changed and requires an administrator to check the replacement before Hub records it as verified.
