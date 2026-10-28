# Artifact ingestion and prototype versions

Hub accepts one provider-neutral artifact contract from workload producers. GitHub Actions, Azure DevOps, Jenkins, local scripts, Copilot workflows, and other systems use the same API. Producers build outside Hub; Hub authenticates the workload, validates and stores the bytes, creates an immutable prototype version, records provenance, and may move a channel pointer.

## Identity and access

A prototype administrator creates a workload publisher with `publish` and may also grant `read-status`:

| Action        | Authority                                                                    |
| ------------- | ---------------------------------------------------------------------------- |
| `publish`     | Publish an artifact and move the prototype's `current` or `preview` channel. |
| `read-status` | Read the result associated with that publisher's idempotency key. This action supplements `publish`; a status-only publisher would have no publication to read. |

Hub returns a bearer credential once and stores only its SHA-256 digest. The credential is scoped to one prototype through its workload publisher. It cannot create a browser session, view a prototype through user APIs, administer access, or publish to another prototype. A producer's source URL, revision, ref, pipeline, and run ID describe where a build came from; they never grant access.

Browser users provision credentials through `POST /api/prototypes/:prototypeId/publishers`. This requires a fresh prototype-administrator session and returns the raw token only in that response. `GET /api/prototypes/:prototypeId/publishers` returns administrator-only publisher and credential metadata without token digests or raw tokens, so another administrator can discover and revoke existing access. An administrator may temporarily disable or re-enable a publisher with `PATCH /api/prototypes/:prototypeId/publishers/:publisherId`, or permanently revoke one credential with `DELETE /api/prototypes/:prototypeId/publishers/:publisherId/credentials/:credentialId`. Hub audits each state change. Re-enabling a publisher does not restore a revoked credential.

Publication, promotion, publisher state changes, and credential revocation use the same prototype lock. Publication and promotion re-read credential expiry, revocation, scope, action, token digest, and publisher state after acquiring that lock. A revocation or disable that locks first prevents an already-started workload request from committing; a workload operation that locks first completes before the administrator mutation.

Archiving a prototype blocks new publishers, publication, publisher re-enablement, and `current` or `preview` promotion. Administrators may still disable publishers and revoke credentials after archival. Existing versions and publication status remain readable through their authorized interfaces.

## Manifest contract

`POST /api/publishing/prototypes/:prototypeId/versions` requires `Authorization: Bearer ...`, an `Idempotency-Key` header, and this JSON shape:

```json
{
  "manifest": {
    "schemaVersion": 1,
    "prototypeId": "00000000-0000-0000-0000-000000000000",
    "artifact": {
      "format": "replica.prototype.bundle",
      "version": "1",
      "digest": "sha256:<64 lowercase hexadecimal characters>",
      "sizeBytes": 1234,
      "builtAt": "2026-10-27T20:00:00.000Z"
    },
    "provenance": {
      "provider": "jenkins",
      "sourceUrl": "https://ci.example/jobs/prototype",
      "revision": "abc123",
      "ref": "refs/heads/main",
      "pipeline": "prototype-build",
      "runId": "451"
    }
  },
  "artifactBase64": "<base64 bytes>",
  "promoteChannel": "preview"
}
```

The manifest and its nested objects are closed to unknown fields. Hub bounds every string, accepts only HTTP or HTTPS source URLs without embedded usernames, passwords, query strings, or fragments, limits decoded artifacts to 8 MiB in this reference layer, verifies canonical base64, checks the decoded size, and recalculates the SHA-256 digest before storing bytes. The manifest prototype ID must match the route.

Publishing requests are rate-limited before JSON parsing. The version-upload route alone accepts the bounded upload-sized JSON body; status and promotion retain the API's default JSON limit.

## Storage boundary

`ArtifactStorage` separates ingestion from byte storage. The reference adapter writes content-addressed files under `HUB_ARTIFACT_STORAGE_PATH`, defaulting to `~/.replica/artifacts` outside the source checkout and Vite development root. Database rows store only the storage key and validated metadata, never the artifact bytes.

The local adapter is suitable for one Hub process with a durable mounted filesystem. It rejects relative configured paths and symbolic-link roots, shards, and artifact paths, resolves directories under the configured root, opens artifact files without following a final symbolic link, and syncs file and directory entries before reporting a successful write. Operators must keep the storage directory writable only by the Hub workload; the local adapter does not provide replication, remote durability, encryption-key management, hostile concurrent filesystem isolation, or multi-region consistency. A production object-store adapter must preserve the same content-addressed, immutable `put`, `read`, and `remove` boundary.

Storage happens before the database transaction. A failed transaction can therefore leave an unreferenced content-addressed file. Hub never deletes referenced bytes automatically. Operators may remove only files that have no matching `PrototypeVersion.storageKey`; retain unreferenced files long enough to exclude in-flight transactions and backups. Version metadata has no deletion API and must not be rewritten silently.

## Idempotency and immutability

Hub hashes the idempotency key and stores it with a digest of the validated publication request. Retrying the same request with the same publisher and key returns the existing version. Reusing the key for different manifest or promotion input returns `idempotency_conflict`. Publishing the same content digest again to the prototype returns `artifact_already_published`.

Publishing locks the prototype while it assigns the next sequence. Concurrent requests therefore create one ordered history. PostgreSQL rejects every update or deletion of a prototype-version row, including accidental writes outside the application.

## Promotion and rollback

`current` and `preview` are mutable pointers to immutable versions. A publish request may move one pointer in the same transaction that creates the version. `PUT /api/publishing/prototypes/:prototypeId/channels/:channel` moves a pointer to any version owned by that prototype. Rollback uses that endpoint to point the channel at an earlier version; it never mutates the version.

## Status, audits, and failures

`GET /api/publishing/prototypes/:prototypeId/status` reads the publication associated with the caller's `Idempotency-Key`. It requires `read-status`. Publishing responses are private and non-cacheable because the idempotency key is carried in a request header rather than the URL.

Version creation, idempotency ownership, optional promotion, and the `prototype.version.publish` security audit commit in one transaction. Promotion writes `prototype.channel.promote` in its transaction. Audit failure rolls back database state. Responses expose validated version metadata and stable error codes, not credentials, storage paths, or artifact contents. Publishing routes omit headers and request payloads from structured request logs.

## Local producer

The local CLI proves that publishing does not depend on GitHub:

```sh
cd hub
REPLICA_PUBLISH_TOKEN=... npm run publish:artifact -- \
  http://127.0.0.1:3001 PROTOTYPE_ID ./prototype.tar preview
```

Optional `REPLICA_PROVENANCE_PROVIDER`, `REPLICA_SOURCE_URL`, `REPLICA_REVISION`, `REPLICA_REF`, `REPLICA_PIPELINE`, and `REPLICA_RUN_ID` values populate provenance without changing authorization.
