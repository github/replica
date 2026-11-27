# Artifact storage

The artifact storage foundation saves immutable bytes behind a provider-neutral domain API. Development-only local Builds and [GitHub Actions Build imports](github-actions-builds.md) use it to save checked package files and record their `BuildArtifact` keys, paths, kinds, and byte lengths. Storage itself does not import Builds or extract archives; the separate [preview layer](build-previews.md) owns authorization and serving.

## Composition

Call `createArtifactStorage(settings)` from `server/domains/artifacts/create-artifact-storage/index.ts` during startup. The asynchronous factory validates settings and returns `isReady()`, `read(key)`, `write(key, bytes)`, and `delete(key)`. `parseArtifactStorageSettings(input)` validates unknown configuration separately when startup needs a typed selection before composition.

Choose exactly one settings shape:

```ts
{ provider: "filesystem", directory: "/srv/replica/artifacts" }
```

```ts
{
  provider: "azure-blob",
  accountUrl: "https://example.blob.core.windows.net",
  container: "artifacts",
  managedIdentityClientId: "<your-user-assigned-managed-identity-client-id>",
}
```

Replace the placeholder with your user-assigned identity's actual client ID UUID, not its object ID or Azure resource ID. Omit `managedIdentityClientId` when using a system-assigned identity.

Alternatively, startup can call `createConfiguredArtifactStorage(environment)` from `server/domains/artifacts/create-configured-artifact-storage/index.ts`, supplying a read-only environment record explicitly. Neither domain factory reads `process.env`.

| Environment variable         | Selection                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `ARTIFACT_STORAGE_PROVIDER`  | Required: exactly `azure` or `filesystem`.                                                     |
| `ARTIFACT_STORAGE_DIRECTORY` | Required absolute directory for `filesystem`; forbidden for `azure`.                           |
| `AZURE_STORAGE_ACCOUNT`      | Required public-cloud account name for `azure`; forbidden for `filesystem`.                    |
| `AZURE_STORAGE_CONTAINER`    | Required container name for `azure`; forbidden for `filesystem`.                               |
| `AZURE_CLIENT_ID`            | Optional explicit user-assigned managed identity UUID for `azure`; forbidden for `filesystem`. |

The wrapper constructs the public-cloud HTTPS account URL and calls the typed factory. Missing or invalid providers, incomplete configuration, and mixed-provider settings fail with a safe error. An empty value still counts as a supplied setting when checking mixed providers. Unrelated environment variables are ignored. Startup may leave storage uncomposed when artifact storage is not configured; calling the wrapper without a provider always rejects.

API, combined, and independent worker entry points validate and construct configured storage before startup. Any supplied provider, directory, account, or container setting opts in, so incomplete settings fail rather than being ignored. Setup does not need storage. Without storage settings, development keeps working unchanged. Construction alone does not prove Azure access or connect an unimplemented product flow.

Unknown typed settings, relative directories, account credentials, URL query strings, and unsupported endpoints fail validation with a safe error. Azure selection never falls back to local storage.

The Azure endpoint accepts public-cloud HTTPS account URLs only. The adapter uses `ManagedIdentityCredential`, with either the system-assigned identity or the explicitly selected user-assigned identity. It never uses account keys, connection strings, developer credentials, or `DefaultAzureCredential`. Operators provision the account and container and grant the runtime identity `Storage Blob Data Contributor` at the intended container scope.

The API's `/api/ready` includes configured storage. `isReady()` has a two-second deadline and makes a non-writing container-properties request through the selected managed identity, or verifies the filesystem directory. Provider failure or timeout fails readiness with a safe diagnostic. The Azure check verifies container read access, not write/delete permission, available capacity, or product operations. It never creates or deletes a probe artifact. Standalone workers have no readiness endpoint.

### Private preview output

The GitHub import worker can publish newly imported, compatible `proto/*` Builds from enabled GitHub repositories to the dedicated private `private-preview-artifacts` container. Publication is off by default and does not enable [the reader](build-previews.md#runtime-settings). To opt in on the import worker, set `HUB_PRIVATE_PREVIEW_WRITE_ENABLED=true`, `HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID` to one or more comma-separated numeric repository IDs, and `HUB_PRIVATE_PREVIEW_WRITE_CONTAINER` to `private-preview-artifacts`. The writer uses the ordinary Azure storage account and worker managed identity; the destination must differ from the ordinary container. The worker needs blob create and read access on the dedicated container for writes and retry verification. It does not need overwrite, list, or delete access. This setting does not grant access. Keep the reader's own identity read-only, without blob listing, and scoped to the dedicated container.

The on-demand worker validates writer settings before accepting jobs; invalid settings stop it at startup. Setup and the scheduled worker do not need writer settings.

After the ordinary import commits, the worker checks the exact owning run and mount marker, then verifies the saved package against its immutable digest before copying any file. It reads and copies in small batches to limit parallel storage requests. It writes only served `dist/` files using their original keys, leaving the mount marker, screenshots, and template metadata in ordinary storage. Each write is a conditional create. If it reports a conflict, or Azure returns HTTP 403 `UnauthorizedBlobOverwrite` to a create-only identity, the writer accepts the existing object only when a bounded read returns exactly the expected bytes. Other authorization failures do not trigger the read. Failed publication logs a warning and fails the job for retry without changing the ordinary Build or its screenshots. Hub withholds standalone links and reader authorization until every served file is copied. Existing successful Builds are not queued for publication.

### Replay a pending private preview

After import job retries stop, use the `buildId` and owning `runId` from the publication failure log and confirm the numeric GitHub repository ID. Fix the underlying issue first. Run one replay from `hub/` in the approved runtime environment with the same writer settings, storage account, database, and managed identity as the importer. The writer must already be enabled for that repository; the reader may remain off.

From source, run:

```sh
npm run --silent private-preview:replay -- \
  --repository-id GITHUB_NUMERIC_REPOSITORY_ID --run-id OWNING_RUN_ID --build-id BUILD_UUID
```

In a built image with runtime secrets already supplied, use `npm run --silent start:private-preview:replay --` with the same three IDs. In an Azure workload that loads runtime secrets from Key Vault, use `node dist/server/scripts/azure-entrypoint/index.js replay-private-preview` followed by those arguments. Do not pass credentials. Replay reads the saved package without contacting GitHub or rerunning the import. It writes one `ready` JSON result to stdout on success and sends diagnostics to stderr. Replaying a ready target makes no storage calls. To prepare an older Build with no publication state, add `--prepare-dist-digest` as described in [Make Builds playable](build-previews.md#make-builds-playable).

A nonzero exit means replay could not confirm readiness. A publication warning identifies the Build, owning run, and stage (`read-target`, `verify-source`, `prepare`, `copy-files`, or `mark-ready`). Use its reason to decide what to do:

| Reason | What to check |
| ------ | ------------- |
| `database-error` | Restore database access before retrying. |
| `source-unavailable`, `destination-unavailable` | Confirm the worker identity can read the source and create and read objects in the dedicated destination. Retry after restoring access. |
| `invalid-package`, `source-missing`, `source-mismatch` | Investigate the retained package and its recorded metadata. Do not rebuild over an existing Build or edit its import records. |
| `destination-conflict` | The destination has different bytes at the expected key. Leave the preview unavailable and investigate without overwriting the object. |

To stop the pilot, disable the writer through the normal release procedure, leave the reader off, and retain the additive migration and all artifact bytes.

## Bytes and results

Keys are case-sensitive opaque strings of 1–128 ASCII letters, digits, underscores, or hyphens, beginning with a letter or digit. They are not paths or URLs. The domain rejects traversal, separators, percent encoding, and other characters before calling a provider.

Writes accept a `Uint8Array` of at most 100 MiB (104,857,600 bytes), including empty bytes, and never overwrite an existing key. Reads return a `Uint8Array` bounded by the same limit. A successful operation returns `{ status: "ok" }`; a successful read also includes `bytes`. Each operation has its own result type: reads may fail with `invalid-key`, `too-large`, `not-found`, or `unavailable`; writes with `invalid-key`, `too-large`, `already-exists`, or `unavailable`; deletes with `invalid-key`, `not-found`, or `unavailable`. Missing reads and deletes are explicit `not-found` results, not empty bytes or silent success. Provider messages and credentials are not included in results.

Immutability prevents overwriting bytes while a key exists. Deleting a key permits later reuse. Callers own authorization, key allocation, retention, and coordination between deletion and other work. Build integrations use opaque deterministic keys and persist `BuildArtifact.kind`, package-relative `path`, `storageKey`, and `byteLength`; preview serving derives the response content type from the checked package path.

## Local filesystem

Operators must provision an absolute directory before startup. The adapter supports Linux with `/proc/self/fd`, including the Hub container runtime. Other platforms fail safely rather than weaken path protection. No directory component or artifact file may be a symbolic link. Directory descriptors pin each component during an operation so replacing an ancestor cannot redirect that operation through a symlink.

Writes create a private staging file, flush the bytes, and publish it with an exclusive hard link. Readers see either the complete artifact or a missing key; concurrent writers cannot overwrite each other. Publication commits the write: later staging cleanup failure produces a warning, not a failed write result. Cleanup also preserves an earlier publication failure. Cleanup failure or an abrupt process exit can leave a hidden staging file; operators may remove those files while the service is stopped. The adapter does not promise recovery across filesystem or host failure.

Use a private service-owned directory and restrict local write access. Symlink protection does not make an attacker-writable storage directory safe: another local process could replace regular files or create hard links. Missing storage directories and other filesystem failures return `unavailable`, not a successful fallback.

## Verification

Colocated Vitest cases cover local byte round trips, concurrent immutable publication, explicit missing results, limits, traversal, symlink rejection, settings selection, managed-identity construction, and safe Azure error mapping. Azure cases replace the SDK boundary; they do not prove a deployed identity, role assignment, or real Blob access. Real Azure verification remains an operator check.
