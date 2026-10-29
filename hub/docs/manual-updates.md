# Update Hub manually

Use this guide to replace the image in an existing Compose deployment while retaining its App connection, data, and secrets. It covers a selected release or a locally built image, not a new installation. Run commands on the VM as the deployment operator.

Read the selected version's notes and migration/recovery requirements first. Startup runs database preparation. A healthy new container does not establish that an older image can read its database.

## Prepare one candidate

Use a new private change directory for each update. Replace placeholders, retain the chosen values in the same shell, and restore them after reconnecting:

```sh
DEPLOY_DIR="$HOME/replica-hub"
HUB_HOST=hub.example.com
CHANGE_DIR="$HOME/replica-images/REPLACE_WITH_CHANGE_NAME"
```

Check `df -h` and `docker system df` before downloading or building. Do not prune volumes or previous recovery images to make room.

For a release image, select an explicit `hub-v*` release and pull it before downtime:

```sh
HUB_RELEASE=hub-vREPLACE_WITH_VERSION
```

```sh
(
  set -eu
  umask 077
  printf '%s\n' "$HUB_RELEASE" | grep -Eq '^hub-v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
  mkdir -p "$(dirname "$CHANGE_DIR")"
  mkdir "$CHANGE_DIR"
  IMAGE="ghcr.io/github/replica-hub:${HUB_RELEASE#hub-v}"
  docker pull "$IMAGE"
  test "$(docker image inspect --format \
    '{{index .Config.Labels "org.opencontainers.image.version"}}' "$IMAGE")" = "${HUB_RELEASE#hub-v}"
  PIN=$(docker image inspect --format '{{index .RepoDigests 0}}' "$IMAGE")
  printf '%s\n' "$PIN" | grep -Eq '^ghcr\.io/github/replica-hub@sha256:[a-f0-9]{64}$'
  printf '%s\n' "$PIN" > "$CHANGE_DIR/candidate-image.txt"
  docker image inspect --format '{{.Id}}' "$PIN" > "$CHANGE_DIR/candidate-image-id.txt"
  docker image inspect --format '{{.Os}}/{{.Architecture}}' "$PIN" > "$CHANGE_DIR/candidate-platform.txt"
  docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
    "$PIN" > "$CHANGE_DIR/candidate-revision.txt"
  grep -Eq '^[a-f0-9]{40}$' "$CHANGE_DIR/candidate-revision.txt"
)
```

Require a valid version and revision. If the directory exists or a command fails, inspect the partial attempt rather than overwriting it.

For an unreleased commit or patch, use [Build or patch an image](source-image-builds.md) **instead** of that release block. Set `CHANGE_DIR` to the build's work directory, which contains the same four candidate records. Never assume a branch push publishes an image.

Run the [isolated smoke check](source-image-builds.md#smoke-check-the-candidate) for either candidate before touching live data.

## Record the running deployment and back it up

Confirm the expected Hub is healthy and record its actual volume before replacement:

```sh
(
  set -eu
  cd "$DEPLOY_DIR"
  env -u REPLICA_IMAGE ./replica status
  CONTAINER=$(env -u REPLICA_IMAGE docker compose ps --quiet hub)
  test -n "$CONTAINER"
  test "$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER")" = healthy
  test ! -e "$CHANGE_DIR/previous-image-id.txt"
  test ! -e "$CHANGE_DIR/previous-volume.txt"
  docker inspect --format '{{.Image}}' "$CONTAINER" > "$CHANGE_DIR/previous-image-id.txt"
  VOLUME=$(docker inspect --format \
    '{{range .Mounts}}{{if eq .Destination "/rails/storage"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}' \
    "$CONTAINER")
  test -n "$VOLUME"
  printf '%s\n' "$VOLUME" > "$CHANGE_DIR/previous-volume.txt"
  printf 'Current storage volume: %s\n' "$VOLUME"
)
```

Compare the volume with your deployment record; the default is `replica-hub_replica-data`. A different or missing mount requires investigation, not a substitute empty volume.

Take a fresh [consistent backup](backups-and-restore.md#take-a-consistent-compose-backup), including the original `.env`, and verify it at the off-VM destinations before continuing. Keep the previous image locally and make it recoverable off-VM. A Docker image ID identifies local content but cannot itself be pulled on a replacement VM.

If release notes require new deployment files, download and verify that version's bundle into a separate directory. Compare it with the installed files and apply required changes deliberately after backing up. Do not extract a bundle over the live directory or rerun initialization. The image-only steps below assume the existing Compose file remains compatible.

## Switch the image

Show the nonsecret candidate reference, then edit the existing configuration:

```sh
cat "$CHANGE_DIR/candidate-image.txt" &&
cd "$DEPLOY_DIR" &&
nano .env
```

Change only the existing `REPLICA_IMAGE=` line to that exact value. Add one line if absent; never leave duplicates. Preserve every origin, key, bootstrap secret, and other setting.

The direct Compose command below is intentional: it selects the already checked local image without pulling or building another one. Clearing a stale shell export prevents it from overriding `.env`.

```sh
(
  set -eu
  cd "$DEPLOY_DIR"
  IMAGE=$(cat "$CHANGE_DIR/candidate-image.txt")
  EXPECTED=$(cat "$CHANGE_DIR/candidate-image-id.txt")
  test "$(sed -n 's/^REPLICA_IMAGE=//p' .env)" = "$IMAGE"
  test "$(docker image inspect --format '{{.Id}}' "$IMAGE")" = "$EXPECTED"
  env -u REPLICA_IMAGE docker compose config --quiet
  env -u REPLICA_IMAGE docker compose up --detach --no-deps --pull never --no-build hub
)
```

Do not run `./replica update` for a local image: it pulls from a registry. For a digest pin it pulls the same content, not a new release. For a moving major/minor tag, the wrapper installs whatever that tag selects; it does not replace backup or release review.

## Verify the running image and data

This block is read-only and can be rerun after an interrupted verification without repeating the switch:

```sh
(
  set -eu
  cd "$DEPLOY_DIR"
  CONTAINER=$(env -u REPLICA_IMAGE docker compose ps --quiet hub)
  test -n "$CONTAINER"
  test "$(docker inspect --format '{{.Image}}' "$CONTAINER")" = \
    "$(cat "$CHANGE_DIR/candidate-image-id.txt")"
  test "$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$CONTAINER")" = \
    "$(cat "$CHANGE_DIR/candidate-revision.txt")"
  test "$(docker inspect --format '{{.Os}}/{{.Architecture}}' \
    "$(cat "$CHANGE_DIR/candidate-image-id.txt")")" = "$(cat "$CHANGE_DIR/candidate-platform.txt")"
  test "$(docker inspect --format \
    '{{range .Mounts}}{{if eq .Destination "/rails/storage"}}{{.Name}}{{end}}{{end}}' "$CONTAINER")" = \
    "$(cat "$CHANGE_DIR/previous-volume.txt")"
  for URL in http://127.0.0.1:3000/up "https://$HUB_HOST/up"; do
    CODE=$(curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --connect-timeout 5 --max-time 5 --retry 60 --retry-all-errors --retry-delay 2 \
      --retry-max-time 120 "$URL")
    test "$CODE" = 200
    printf 'PASS: HTTP 200 from %s\n' "$URL"
  done
  printf 'PASS: expected image, revision, platform, and retained storage.\n'
)
```

If you changed `REPLICA_PORT`, adjust the loopback URL. Do not use `-k` for public HTTPS. A transient startup connection reset is retried; a final failure means stop and inspect logs locally.

Confirm sign-in, retained App configuration, existing reviews, a stored Build, and an embedded preview. Check any changed behavior, access denials, and background/webhook work before ending maintenance. Do not reconnect or reset a working App just because its image changed.

## Recover without discarding newer writes

On failure, preserve logs and the newest data, and stop write traffic before recovery. Never repair startup by generating new encryption keys, rerunning initialization, deleting storage, or using `down -v`.

An image-only downgrade is safe only when that version's documented schema and data changes permit it. Otherwise recover the matching old image, data, and secrets on a clean target using [Backups and restore](backups-and-restore.md#restore-to-a-clean-target). Account for writes since the backup; restoring old data loses those writes unless separately recovered.
