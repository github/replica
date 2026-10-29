# Installation membership and administration

Hub owns installation admission after an authentication provider proves an identity. Repository access and installation membership are separate decisions.

## Membership contract

Each Hub user has at most one installation membership.

| State | Result |
| --- | --- |
| Active member | May create and restore a Hub session. Product access remains a separate future decision. |
| Active administrator | Has member access and may use installation administration after fresh identity verification. |
| Suspended | Cannot create or use a Hub session. An administrator may restore the membership. |
| Removed | Cannot create or use a Hub session. The retained record preserves audit linkage, and return requires a new invitation. |

Changing a membership to suspended or removed deletes that user's sessions in the same transaction. Every protected request also reloads membership, so a stale cookie cannot preserve access. Hub prevents overlapping administrator changes from removing the final active administrator.

## Invitations

An invitation targets an external identity assignment:

```text
provider + issuer + immutable subject -> ExternalIdentity -> User -> InstallationMembership
```

An administrator may invite a member or administrator. Hub never matches mutable login, display-name, or email fields. The invitation expires after seven days, can be revoked before activation, and can be consumed once. A matching authentication callback activates the membership and creates the session in one serialized operation.

Hub rejects invitations for active or suspended assignments. A removed assignment may receive a new invitation.

## Bootstrap and recovery

Set two independent host-held secrets:

- `HUB_BOOTSTRAP_SECRET` authorizes the first administrator enrollment once.
- `HUB_ADMIN_RECOVERY_SECRET` authorizes recovery only when no active administrator remains.

Both routes verify the secret before starting a browser-bound, one-use provider authorization. The callback must complete in that browser. Hub stores neither secret in the database. Bootstrap has a durable completion marker and cannot reopen after attempt cleanup. Recovery does not change that marker.

Keep both values outside Git and transfer them through the deployment owner's approved secret-management process.

## Administration API

The minimal administration surface uses:

- `GET /api/administration`
- `POST /api/administration/invitations`
- `DELETE /api/administration/invitations/:id`
- `PATCH /api/administration/memberships/:id`
- `POST /api/auth/bootstrap`
- `POST /api/auth/recovery`

The administration response returns membership and invitation pages with separate `nextCursor` values. Pass `membershipsCursor` or `invitationsCursor` to continue the corresponding collection without hiding older active records behind retained history.

State-changing requests require the configured origin and matching CSRF cookie/header. Membership and invitation changes also require an active administrator session verified less than five minutes ago. Administration errors return stable codes such as `administrator_required`, `last_administrator`, and `invitation_changed`.

## Security records

Membership operations write a structured security record with a bounded action, outcome, actor, session, target membership or invitation, and fixed reason context. Success records commit with their state changes. Denied administrator mutations roll back partial changes before Hub saves the denial reason in a separate transaction. Records never include host secrets, provider tokens, request payloads, mutable identity labels, or exception text.

## Non-goals

This boundary does not define prototype, repository, workspace, or artifact roles. It does not synchronize GitHub organization or repository permissions, implement production OIDC, link accounts across providers, provision users through SCIM, or ingest artifacts.
