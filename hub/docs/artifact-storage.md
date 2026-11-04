# Artifact storage

Hub keeps each successful Build's `dist` files and screenshots after the temporary GitHub Actions artifact expires.

```text
Workflow in the prototype repository
        |
        | calls
        v
Build action in the Replica repository
        |
        v
GitHub Actions artifact
        |
        +-- built `dist` files
        +-- screenshots
        |
        v
Hub checks and stores every file
        |
        +-- builds/{build-id}/dist/**
        +-- builds/{build-id}/screenshots/**
        |
        v
Hub marks the Build successful
        |
        v
Reviewers can open its preview
```

## Storage options

Both storage options use these paths:

```text
builds/{build-id}/dist/**
builds/{build-id}/screenshots/desktop.png
builds/{build-id}/screenshots/narrow.png
builds/{build-id}/screenshots/desktop-dark.png
builds/{build-id}/screenshots/narrow-dark.png
builds/{build-id}/templates.json                         (optional)
builds/{build-id}/screenshots/templates/{id}/desktop.png (declared templates only)
builds/{build-id}/screenshots/templates/{id}/narrow.png
builds/{build-id}/screenshots/templates/{id}/desktop-dark.png
builds/{build-id}/screenshots/templates/{id}/narrow-dark.png
```

Hub can store Build files on the local filesystem or in Azure Blob Storage. Both options keep the same paths and never replace an existing file.

| Provider           | Authentication        |
| ------------------ | --------------------- |
| Local filesystem   | Host file permissions |
| Azure Blob Storage | Managed identity      |

## Local storage

```sh
REPLICA_ARTIFACT_STORE=local
REPLICA_ARTIFACT_ROOT=/persistent/private/path
```

The default root is `storage/artifacts`. Keep it outside the public web root, mount it on persistent storage, and back it up with the databases. Hub finishes writing each file before making its final name visible and never replaces an existing object.

## Azure Blob Storage

Use a private container without hierarchical namespace:

```sh
REPLICA_ARTIFACT_STORE=azure
REPLICA_AZURE_STORAGE_ACCOUNT=storageaccount
REPLICA_AZURE_STORAGE_CONTAINER=replica-artifacts
```

Assign `Storage Blob Data Contributor` on the container to the deployment's managed identity. Set `REPLICA_AZURE_MANAGED_IDENTITY_CLIENT_ID` only for a user-assigned identity. Hub does not accept account keys, connection strings, or storage credentials.

On Azure Container Apps or an Azure virtual machine, Hub requests storage tokens from the host's managed identity endpoint.

Use different containers for development and production.

## Import and recovery

Hub checks the downloaded ZIP, required files, file paths, and size limits before storing a Build. Reviewers cannot open a preview until the complete import succeeds. A package may contain one version-1 `templates.json` manifest of at most 16 KiB with at most 12 template definitions. Each definition needs both desktop and narrow screenshots under its exact ID. Dark captures are optional for compatibility with older build actions; when any declared dark capture is present, both widths must be present for the root and every declared template. Hub rejects partial dark sets, undeclared screenshot files, unsupported metadata, missing captures, and invalid local routes before storing files. Legacy packages without the manifest remain valid. Both storage adapters use the same contract.

The [Hub package limit](github-actions-builds.md#hub-package-limit) defaults to 150 MiB unpacked and includes app files, screenshots, and metadata. Operators configure `REPLICA_MAXIMUM_PACKAGE_MIB` in Hub's environment and restart every Hub process after changing it. The download allowance derives from the same value. Changes do not alter previously successful Builds.

Hub automatically retries an import after a temporary network, throttling, or storage failure. Before each retry, Hub deletes the incomplete Build files and imports the same artifact again. Invalid configuration or denied access ends the import and marks the Build as failed.

Successful Builds are immutable. See [GitHub Actions builds](github-actions-builds.md) for artifact rules and [Preview serving](preview-serving.md) for file delivery.

Prototype controls need no new artifact file. The prototype app bundles its controls runtime in `dist`; Hub injects its controls-only transport while serving authorized HTML. Declarations are validated at build time and again across the bridge. Viewer-local overrides never enter artifact storage.
