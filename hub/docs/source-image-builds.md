# Build or patch a Hub image

Build a source image when you need an unreleased fix or an explicitly reviewed local patch. Prefer a published release when it provides the required behavior. A source build does not publish an image or update the running Hub.

Use a separate source directory outside the deployment directory. Never include the live `.env`, keys, or storage in a build context. You need Docker with Buildx, access to the pinned base images and dependency registries, and space for build layers. Git is needed only for the optional patch step.

## Select immutable source

Ask the change owner for the reviewed full Git commit and expected archive checksum, and inspect its changes and check results. Resolve branch names to commits before building; do not use a branch name as the build's permanent identity. Obtain the expected checksum through a trusted handoff, not by accepting whatever a failed download produces.

Replace these nonsecret values in the same VM shell:

```sh
SOURCE_COMMIT=REPLACE_WITH_FULL_40_CHARACTER_COMMIT
SOURCE_SHA256=REPLACE_WITH_ARCHIVE_SHA256
CHANGE_DIR="$HOME/replica-images/REPLACE_WITH_CHANGE_NAME"
```

Download and verify the archive into a new directory:

```sh
(
  set -eu
  umask 077
  printf '%s\n' "$SOURCE_COMMIT" | grep -Eq '^[a-f0-9]{40}$'
  printf '%s\n' "$SOURCE_SHA256" | grep -Eq '^[a-f0-9]{64}$'
  mkdir -p "$(dirname "$CHANGE_DIR")"
  mkdir "$CHANGE_DIR"
  mkdir "$CHANGE_DIR/source"
  cd "$CHANGE_DIR"
  curl --fail --location --show-error --retry 3 --retry-all-errors \
    --retry-delay 2 --connect-timeout 10 --max-time 120 \
    --output source.tar.gz \
    "https://codeload.github.com/github/replica/tar.gz/$SOURCE_COMMIT"
  printf '%s  source.tar.gz\n' "$SOURCE_SHA256" > source.sha256
  sha256sum -c source.sha256
  tar -xzf source.tar.gz --strip-components=1 -C source
  printf '%s\n' "$SOURCE_COMMIT" > source-commit.txt
)
```

Require `source.tar.gz: OK`. Stop on an existing directory, mismatched checksum, or missing expected source. Inspect a partial attempt before retrying; do not delete old work or extract over modified source.

## Apply a local patch only when needed

Skip this section when the fix already exists in the selected remote commit. Rebuilding the updated commit is preferable to carrying a second copy of the fix.

Use a reviewed patch against this exact base, including its regression coverage. Keep the original archive unchanged. Do not edit the running container, alter database identity fields, or layer a single runtime file onto an unrelated image. Dependency, frontend, migration, and generated-file changes need the complete production build.

Set the path to a patch delivered through your approved channel and its independently supplied checksum:

```sh
PATCH_FILE=/absolute/path/to/REPLACE_WITH_REVIEWED_PATCH
PATCH_SHA256=REPLACE_WITH_PATCH_SHA256
```

```sh
(
  set -eu
  command -v git >/dev/null
  printf '%s\n' "$PATCH_SHA256" | grep -Eq '^[a-f0-9]{64}$'
  test "$(sha256sum "$PATCH_FILE" | cut -d ' ' -f 1)" = "$PATCH_SHA256"
  test ! -e "$CHANGE_DIR/applied.patch"
  test ! -e "$CHANGE_DIR/patch.sha256"
  git -C "$CHANGE_DIR/source" apply --stat "$PATCH_FILE"
  git -C "$CHANGE_DIR/source" apply --check "$PATCH_FILE"
  cp "$PATCH_FILE" "$CHANGE_DIR/applied.patch"
  git -C "$CHANGE_DIR/source" apply "$CHANGE_DIR/applied.patch"
  (
    cd "$CHANGE_DIR"
    printf '%s  applied.patch\n' "$PATCH_SHA256" > patch.sha256
    sha256sum -c patch.sha256
  )
)
```

Inspect the patch's paths and contents before running it. Do not use `--reject`, `--unsafe-paths`, or force options to bypass a mismatch. A failed or partial application needs inspection, not blind reapplication. Validate the changed behavior with the relevant [contributor checks](testing-and-operations.md) before deployment; startup alone is not regression coverage.

## Build the complete image

Choose the platform matching the deployment VM. Native builds avoid emulation problems:

| `uname -m` on the VM | `IMAGE_PLATFORM` |
| --- | --- |
| `x86_64` | `linux/amd64` |
| `aarch64` or `arm64` | `linux/arm64` |

Choose a unique local tag and version. Include a local-patch suffix when applicable; do not give a patched image the same tag as the unmodified commit. The revision label identifies the base commit, not proof that local source is unchanged. Retain the archive, applied patch/checksum, and image ID together.

```sh
IMAGE_PLATFORM=linux/amd64
LOCAL_IMAGE=replica-hub:REPLACE_WITH_UNIQUE_LOCAL_TAG
IMAGE_VERSION=0.0.0-REPLACE_WITH_LOCAL_VERSION
```

```sh
(
  set -eu
  test "$(cat "$CHANGE_DIR/source-commit.txt")" = "$SOURCE_COMMIT"
  test -f "$CHANGE_DIR/source/hub/Dockerfile"
  test -f "$CHANGE_DIR/source/packages/learning/package-lock.json"
  test ! -e "$CHANGE_DIR/candidate-image-id.txt"
  if docker image inspect "$LOCAL_IMAGE" >/dev/null 2>&1; then
    printf 'Image tag already exists; choose a new tag instead of overwriting it.\n' >&2
    exit 1
  fi
  docker buildx build \
    --platform "$IMAGE_PLATFORM" \
    --build-context learning="$CHANGE_DIR/source/packages/learning" \
    --build-arg REPLICA_IMAGE_REVISION="$SOURCE_COMMIT" \
    --build-arg REPLICA_IMAGE_VERSION="$IMAGE_VERSION" \
    --tag "$LOCAL_IMAGE" --load "$CHANGE_DIR/source/hub"
  test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$LOCAL_IMAGE")" = "$IMAGE_PLATFORM"
  test "$(docker image inspect --format \
    '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$LOCAL_IMAGE")" = "$SOURCE_COMMIT"
  printf '%s\n' "$LOCAL_IMAGE" > "$CHANGE_DIR/candidate-image.txt"
  docker image inspect --format '{{.Id}}' "$LOCAL_IMAGE" > "$CHANGE_DIR/candidate-image-id.txt"
  printf '%s\n' "$IMAGE_PLATFORM" > "$CHANGE_DIR/candidate-platform.txt"
  printf '%s\n' "$SOURCE_COMMIT" > "$CHANGE_DIR/candidate-revision.txt"
)
```

The named `learning` build context is required. The production Dockerfile owns runtime and dependency versions; do not override its pins or modify lockfiles to work around connectivity. The image builds frontend assets and installs locked dependencies, so source and release builds both need registry access.

`bin/devcontainer up --use-npm-proxy URL` configures the development environment only. It is not a production Docker build flag and does not automatically configure the production image. Resolve failed registry access through your approved network/proxy configuration; do not disable TLS or substitute an unapproved registry.

## Smoke-check the candidate

For a release candidate, set `CHANGE_DIR` to the records from [manual updates](manual-updates.md#prepare-one-candidate). For a source build, keep the same directory as above.

This block creates only disposable settings and one owned container, without network, published ports, or live storage mounts. It checks a fresh database, not an upgrade of your retained data or real GitHub credentials:

```sh
(
  set -eu
  umask 077
  IMAGE=$(cat "$CHANGE_DIR/candidate-image.txt")
  test "$(docker image inspect --format '{{.Id}}' "$IMAGE")" = \
    "$(cat "$CHANGE_DIR/candidate-image-id.txt")"
  CHECK_DIR=$(mktemp -d "$CHANGE_DIR/smoke.XXXXXX")
  CHECK_ID=
  cleanup() {
    RESULT=$?
    if [ -n "$CHECK_ID" ]; then
      docker rm --force "$CHECK_ID" || RESULT=1
    fi
    rm -f "$CHECK_DIR/smoke.env" || RESULT=1
    rmdir "$CHECK_DIR" || RESULT=1
    exit "$RESULT"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  docker run --rm --pull never --network none --entrypoint /bin/sh "$IMAGE" \
    -c 'test ! -e /rails/tmp/local_secret.txt'
  docker run --rm --pull never --network none "$IMAGE" \
    bin/replica-deployment-config generate \
    --host smoke.example.com --format dotenv > "$CHECK_DIR/smoke.env"
  CHECK_ID=$(docker create --network none --env-file "$CHECK_DIR/smoke.env" "$IMAGE")
  docker start "$CHECK_ID" >/dev/null
  if ! docker exec "$CHECK_ID" curl --fail --silent --show-error --output /dev/null \
    --retry 60 --retry-all-errors --retry-delay 2 --retry-max-time 120 --max-time 5 \
    http://localhost/up; then
    docker logs --tail 100 "$CHECK_ID"
    exit 1
  fi
  printf 'PASS: isolated production startup.\n'
)
```

Require the `PASS` line and successful cleanup. If evaluating manual App setup, also check that the selected version exposes GET and POST `/setup/manual`, for example with `bin/rails routes -g manual` in the disposable container before cleanup. Feature-specific checks supplement startup; they do not prove OAuth or webhook operation.

After the candidate passes, continue with [recording and backing up the live deployment](manual-updates.md#record-the-running-deployment-and-back-it-up). The image has not yet been deployed. Retain an off-VM copy of a locally built image for recovery; a tag or base commit alone does not preserve its built dependencies and assets.
