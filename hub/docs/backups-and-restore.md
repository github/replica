# Backups and restore

A complete Hub backup contains:

```text
Hub data
  +-- SQLite databases
  +-- Build files and screenshots
  +-- learning stores
  +-- encrypted GitHub App configuration

Separate secret backup
  +-- database encryption keys
  +-- deployment secrets
```

Back up the Hub data at one consistent point so database records do not refer to missing Build files. Encrypt off-VM copies and store the secret backup separately with appropriate retention and access controls. Treat both backups as sensitive: the data archive includes reviews and encrypted credentials.

Local Build files live under `REPLICA_ARTIFACT_ROOT`, which defaults to `storage/artifacts`. [Learning stores](learnings.md#operations) live under `REPLICA_LEARNING_ROOT`, which defaults to `storage/learning`.

For the default Compose deployment, the whole `/rails/storage` volume contains the SQLite databases and sidecar files, local Builds/screenshots, and learning stores. If you changed the storage roots or use external artifact storage, include those locations in the same consistent backup plan. The commands below cover the default local-storage layout only.

## Take a consistent Compose backup

Schedule downtime and prevent other operators from changing configuration during the backup. Stop every writer to the data, including any separately configured workers or learning commands. The standard bundle runs these within the single Hub container.

On the VM, set `DEPLOY_DIR` to the existing deployment directory. This block records the running image and volume, saves the image for recovery, copies deployment files, and separately preserves the unchanged `.env`. It then stops Hub, archives the full volume, checks the archives, and restarts the unchanged container:

```sh
DEPLOY_DIR="$HOME/replica-hub"
```

```sh
(
  set -eu
  umask 077
  cd "$DEPLOY_DIR"
  CONTAINER=$(env -u REPLICA_IMAGE docker compose ps --quiet hub)
  test -n "$CONTAINER"
  OLD_IMAGE=$(docker inspect --format '{{.Image}}' "$CONTAINER")
  VOLUME=$(docker inspect --format \
    '{{range .Mounts}}{{if eq .Destination "/rails/storage"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}' \
    "$CONTAINER")
  test "$VOLUME" = replica-hub_replica-data
  docker volume inspect "$VOLUME" >/dev/null
  mkdir -p "$HOME/replica-backups" "$HOME/replica-secret-backups"
  BACKUP=$(mktemp -d "$HOME/replica-backups/hub.XXXXXX")
  SECRETS=$(mktemp -d "$HOME/replica-secret-backups/hub.XXXXXX")
  printf '%s\n' "$OLD_IMAGE" > "$BACKUP/image-id.txt"
  printf '%s\n' "$VOLUME" > "$BACKUP/volume.txt"
  cp compose.yml replica "$BACKUP/"
  cp .env "$SECRETS/hub.env"
  chmod 600 "$SECRETS/hub.env"
  docker image save --output "$BACKUP/hub-image.tar" "$OLD_IMAGE"
  tar -tf "$BACKUP/hub-image.tar" >/dev/null
  env -u REPLICA_IMAGE docker compose stop hub
  test "$(docker inspect --format '{{.State.Running}}' "$CONTAINER")" = false
  docker run --rm --pull never --network none --user 0:0 --entrypoint tar \
    --mount "type=volume,src=$VOLUME,dst=/data,readonly" \
    "$OLD_IMAGE" -czf - -C /data . > "$BACKUP/hub-data.tar.gz"
  tar -tzf "$BACKUP/hub-data.tar.gz" >/dev/null
  (
    cd "$BACKUP"
    sha256sum hub-data.tar.gz hub-image.tar compose.yml replica image-id.txt volume.txt > SHA256SUMS
    sha256sum -c SHA256SUMS
  )
  (
    cd "$SECRETS"
    sha256sum hub.env > SHA256SUMS
    sha256sum -c SHA256SUMS
  )
  env -u REPLICA_IMAGE docker compose start hub
  CODE=$(curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --retry 60 --retry-all-errors --retry-delay 2 --retry-max-time 120 \
    --connect-timeout 5 --max-time 5 http://127.0.0.1:3000/up)
  test "$CODE" = 200
  printf 'Data and image backup: %s\nSeparate secret backup: %s\n' "$BACKUP" "$SECRETS"
)
```

The mount assertion deliberately stops for a customized deployment. Confirm its actual storage plan before adapting that assertion. Adjust the loopback URL if you changed `REPLICA_PORT`. Never substitute a new empty volume for the existing one.

If any step fails, do not upgrade. Hub may remain stopped. Inspect the error, then use `env -u REPLICA_IMAGE docker compose start hub` from the unchanged deployment to restore service when safe. Do not initialize again.

Transfer the completed data/image backup to approved encrypted off-VM storage and the secret backup to separately controlled storage. Verify `SHA256SUMS` at both destinations. Checksums detect damaged copies; they do not encrypt or prove a restore works. Retain the old image, source/patch records for custom builds, and version-specific recovery notes.

Back up reverse-proxy configuration separately. If using the [Azure proxy](azure-vm-deployment.md), preserve its Dockerfile, Compose file, and Caddyfile, and back up certificate/account volumes as sensitive state or plan certificate reissuance. An Azure VM snapshot taken during writes is not automatically a consistent SQLite/artifact backup.

## Restore to a clean target

Rehearse restoration before relying on Hub. Use an isolated replacement VM with the same CPU architecture and no production traffic. Do not let a restored copy send jobs or receive webhooks alongside the live Hub; coordinate outbound access and any cutover.

1. Verify both backup checksums. Recover the matching original `.env`, image, deployment files, full data archive, and any external storage. Do not mix secrets or data from different deployments.
2. Load the saved image with `docker image load --input /path/to/backup/hub-image.tar`. Compare its ID with `image-id.txt`. If using a registry copy instead, pull the recorded immutable digest and verify it. A moving tag is not a recovery reference.
3. Restore `compose.yml` and `replica` into a new deployment directory and the secret backup as `.env`, mode `0600`. Make `REPLICA_IMAGE` select the recovered image ID or immutable digest, with no duplicate setting. Do not run `./replica init`.
4. Confirm Hub is stopped and the intended volume does not already exist. Create a new empty volume using the name expected by the restored Compose file. Extract only into that empty volume, preserving numeric ownership, as shown below.
5. Restore proxy configuration, DNS routing, identity permissions, and certificate state, or arrange certificate reissuance. Keep the original origins unless deliberately coordinating a hostname change with GitHub.
6. Start the recovered Hub only after isolating it from the live deployment. Check local health, decryptable App credentials, sign-in, existing reviews, a stored Build, preview files, and background work before cutover.

Example extraction on the clean target, after loading and checking the image:

```sh
BACKUP=/absolute/path/to/REPLACE_WITH_DATA_BACKUP
RESTORE_IMAGE=sha256:REPLACE_WITH_SAVED_IMAGE_ID
RESTORE_VOLUME=replica-hub_replica-data
```

```sh
(
  set -eu
  (cd "$BACKUP" && sha256sum -c SHA256SUMS)
  test "$(cat "$BACKUP/image-id.txt")" = "$RESTORE_IMAGE"
  docker image inspect "$RESTORE_IMAGE" >/dev/null
  if docker volume inspect "$RESTORE_VOLUME" >/dev/null 2>&1; then
    printf 'Refusing to restore over an existing volume.\n' >&2
    exit 1
  fi
  docker volume create "$RESTORE_VOLUME"
  docker run --rm --pull never --network none --user 0:0 --entrypoint tar \
    --mount "type=volume,src=$RESTORE_VOLUME,dst=/data" \
    --mount "type=bind,src=$BACKUP,dst=/backup,readonly" \
    "$RESTORE_IMAGE" -xzpf /backup/hub-data.tar.gz --numeric-owner -C /data
)
```

Run App diagnosis in the recovered Compose deployment:

```sh
env -u REPLICA_IMAGE docker compose exec -T hub bin/rails replica:github:diagnose
```

Diagnosis contacts GitHub and checks App/installation reachability; it does not prove end-user OAuth or signed webhook delivery. Authorize network access for those checks deliberately. Contributor devcontainers are not required on the production VM.

Never extract over live or nonempty storage. If recovery follows an update, preserve the newest data first and account for writes since the selected backup. Restoring an older backup discards those writes unless separately recovered. An image-only downgrade is not generally safe after database migrations or App connection.
