# Artifact storage

The artifact storage foundation saves immutable bytes behind a provider-neutral domain API. It does not import Builds, extract archives, host previews, authorize access, or add product routes or database models.

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

## Bytes and results

Keys are case-sensitive opaque strings of 1–128 ASCII letters, digits, underscores, or hyphens, beginning with a letter or digit. They are not paths or URLs. The domain rejects traversal, separators, percent encoding, and other characters before calling a provider.

Writes accept a `Uint8Array` of at most 32 MiB, including empty bytes, and never overwrite an existing key. Reads return a bounded `Uint8Array`. A successful operation returns `{ status: "ok" }`; a successful read also includes `bytes`. Each operation has its own result type: reads may fail with `invalid-key`, `too-large`, `not-found`, or `unavailable`; writes with `invalid-key`, `too-large`, `already-exists`, or `unavailable`; deletes with `invalid-key`, `not-found`, or `unavailable`. Missing reads and deletes are explicit `not-found` results, not empty bytes or silent success. Provider messages and credentials are not included in results.

Immutability prevents overwriting bytes while a key exists. Deleting a key permits later reuse. Callers own authorization, key allocation, retention, and coordination between deletion and other work.

## Local filesystem

Operators must provision an absolute directory before startup. The adapter supports Linux with `/proc/self/fd`, including the Hub container runtime. Other platforms fail safely rather than weaken path protection. No directory component or artifact file may be a symbolic link. Directory descriptors pin each component during an operation so replacing an ancestor cannot redirect that operation through a symlink.

Writes create a private staging file, flush the bytes, and publish it with an exclusive hard link. Readers see either the complete artifact or a missing key; concurrent writers cannot overwrite each other. Publication commits the write: later staging cleanup failure produces a warning, not a failed write result. Cleanup also preserves an earlier publication failure. Cleanup failure or an abrupt process exit can leave a hidden staging file; operators may remove those files while the service is stopped. The adapter does not promise recovery across filesystem or host failure.

Use a private service-owned directory and restrict local write access. Symlink protection does not make an attacker-writable storage directory safe: another local process could replace regular files or create hard links. Missing storage directories and other filesystem failures return `unavailable`, not a successful fallback.

## Verification

Colocated Vitest cases cover local byte round trips, concurrent immutable publication, explicit missing results, limits, traversal, symlink rejection, settings selection, managed-identity construction, and safe Azure error mapping. Azure cases replace the SDK boundary; they do not prove a deployed identity, role assignment, or real Blob access. Real Azure verification remains an operator check.
