# Install Hub on a Linux VM

Use this walkthrough to install one Hub container with Docker Compose on a persistent Linux VM. It covers a new installation, not an upgrade or recovery. For an existing Hub, use [manual updates](manual-updates.md) or [backups and restore](backups-and-restore.md).

You need administrator access to the VM, control of DNS and HTTPS, and someone authorized to register or administer a GitHub App and approve its repository installation. The VM administrator and GitHub administrator may be different people.

The [deployment guide](deployment.md) defines supported storage, origins, proxy trust, and optional settings. This walkthrough does not add high availability, autoscaling, enterprise sign-in, or external database support. Run exactly one Hub against persistent local storage.

## Choose the addresses and release

Replace the example hostname and every `REPLACE_WITH_...` value before running a block. Keep nonsecret selections in a private installation record; keep credentials in your approved secret manager.

| Selection | Example or requirement |
| --- | --- |
| Hub hostname | `hub.example.com`, under a registered domain dedicated entirely to Hub and previews |
| Preview wildcard | `*.preview.hub.example.com` |
| VM address and SSH user | Your VM's static public IP and administrator account |
| Deployment directory | `$HOME/replica-hub`; use the same path for later operations |
| Hub release | An explicit `hub-v*` release with a deployment bundle and image |
| Backups | Encrypted off-VM data storage and separately controlled secret storage |

A dedicated subdomain on a shared registered domain is **not** browser isolation from sibling applications. Follow [Choose an isolated domain](deployment.md#choose-an-isolated-domain). DNS delegation limits DNS permissions, not browser trust.

Select a release from [Hub releases](https://github.com/github/replica/releases), read its notes, and use documentation from that release when installing it. A feature described on a branch may not exist in an older image. Do not use `releases/latest`, which can select a canvas release, or assume a source commit has a published image.

## Prepare the VM

Use a persistent disk, not an ephemeral OS or temporary data disk. Reserve capacity for Hub data, image layers, source builds if needed, and backups. Size the VM for your workload; a successful installation is not a capacity measurement.

Allow inbound TCP 443 for Hub, previews, OAuth callbacks, and GitHub webhooks. Allow TCP 80 if your proxy uses it for redirects or certificate validation. Limit SSH to approved administrator addresses or a controlled access service. Do not expose port 3000, the proxy administration port, or Docker's API.

On your computer, connect with your approved SSH client. For example:

```sh
ssh -i /path/to/REPLACE_WITH_SSH_KEY REPLACE_WITH_USER@REPLACE_WITH_VM_IP
```

Verify the server's host-key fingerprint through your cloud console or another trusted channel before accepting a first connection. Stop on a changed or unexpected fingerprint; do not disable host-key checking.

All following shell blocks run **on the VM**, one at a time. Stop on an error before continuing. Use a fresh supported Linux installation and follow [Docker's installation instructions](https://docs.docker.com/engine/install/) for that distribution to install Engine, the Compose plugin, and Buildx if you will build images. Do not remove an existing runtime or its data to make this guide fit.

If you grant the deployment user Docker group membership, reconnect to activate it. Docker group membership effectively grants root access. Check:

```sh
docker version
docker compose version
df -h "$HOME"
docker system df
```

The Docker server must be reachable, and its data directory must be on persistent storage. Docker-published ports can bypass host firewall rules; retain the cloud firewall and Hub's loopback binding.

For Azure resources, delegation, managed identity, and a complete HTTPS proxy example, follow [Azure VM deployment](azure-vm-deployment.md). On another host, arrange an HTTPS proxy that meets the same [DNS and proxy requirements](deployment.md#configure-dns-and-https).

## Download and verify the bundle

Set these nonsecret variables in the same VM shell. Restore them if you reconnect:

```sh
HUB_HOST=hub.example.com
HUB_RELEASE=hub-vREPLACE_WITH_VERSION
DEPLOY_DIR="$HOME/replica-hub"
```

This block refuses an existing deployment directory:

```sh
(
  set -eu
  umask 077
  printf '%s\n' "$HUB_RELEASE" | grep -Eq '^hub-v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
  URL="https://github.com/github/replica/releases/download/$HUB_RELEASE"
  mkdir "$DEPLOY_DIR"
  cd "$DEPLOY_DIR"
  curl --fail --location --show-error --output replica-deploy.tar.gz \
    "$URL/replica-deploy.tar.gz"
  curl --fail --location --show-error --output replica-deploy.tar.gz.sha256 \
    "$URL/replica-deploy.tar.gz.sha256"
  sha256sum -c replica-deploy.tar.gz.sha256
  tar -xzf replica-deploy.tar.gz
)
```

Require `replica-deploy.tar.gz: OK`. A failed download or checksum means stop, not extract anyway. Inspect an existing directory before retrying; do not overwrite deployment files. The bundle contains `compose.yml` and `replica`; Git, Ruby, and Node are not required on the VM.

## Pin the image and initialize once

Pull the selected release and record its digest, an immutable reference to the image contents:

```sh
(
  set -eu
  cd "$DEPLOY_DIR"
  IMAGE="ghcr.io/github/replica-hub:${HUB_RELEASE#hub-v}"
  docker pull "$IMAGE"
  test "$(docker image inspect --format \
    '{{index .Config.Labels "org.opencontainers.image.version"}}' "$IMAGE")" = "${HUB_RELEASE#hub-v}"
  PIN=$(docker image inspect --format '{{index .RepoDigests 0}}' "$IMAGE")
  printf '%s\n' "$PIN" | grep -Eq '^ghcr\.io/github/replica-hub@sha256:[a-f0-9]{64}$'
  test ! -e .env
  REPLICA_IMAGE="$PIN" ./replica init "$HUB_HOST"
  printf '\nREPLICA_IMAGE=%s\n' "$PIN" >> .env
  chmod 600 .env
)
```

The public image needs no registry token. If access fails, check the exact package/tag and network policy before adding credentials. For an intentionally restricted registry, use its approved interactive login; never put tokens in this guide or command arguments.

Save the printed **setup code** in your secret manager. It is `REPLICA_BOOTSTRAP_SECRET`, not the GitHub App client secret or webhook secret. Keep `.env` for the deployment's lifetime and back it up separately. Never rerun initialization or generate new encryption keys to fix an existing installation.

Do not print `.env` or share full container environment/configuration output. Use `docker compose config --quiet` to check configuration without printing its resolved secrets.

Start Hub and check loopback health:

```sh
(
  set -eu
  cd "$DEPLOY_DIR"
  env -u REPLICA_IMAGE ./replica up
  env -u REPLICA_IMAGE ./replica status
  CODE=$(curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --retry 60 --retry-all-errors --retry-delay 2 --retry-max-time 120 \
    --connect-timeout 5 --max-time 5 http://127.0.0.1:3000/up)
  test "$CODE" = 200
  printf 'PASS: Hub responds on loopback.\n'
)
```

The wrapper waits for container health. Bounded curl retries also cover transient startup connection resets. Health does not prove DNS, TLS, sign-in, or a Build works.

## Complete HTTPS and GitHub setup

Point both DNS names to the VM and configure your proxy to forward them to `127.0.0.1:3000`. Preserve the requested hostname and WebSockets. Complete [proxy trust verification](deployment.md#verify-your-deployment) before relying on audit addresses or per-address limits.

From your computer, check the public address with normal TLS verification:

```sh
curl --fail --show-error https://hub.example.com/up
curl --silent --show-error --output /dev/null --write-out 'Preview HTTP %{http_code}\n' \
  https://b123.preview.hub.example.com/
```

Replace both hostnames. Require HTTP 200 from Hub. A nonexistent preview may return 404, but DNS and trusted TLS must succeed. Do not use `-k`.

Follow [GitHub App setup](github-app-setup.md) to create the App through Hub or manually register/connect one. Then enroll a Hub operator separately. Do not use a database bootstrap script or reset an already configured App.

Before inviting users, verify an intended user's sign-in, repository access and denial, a real Build and embedded preview, and persistence after a planned restart. Keep public sharing disabled unless deliberately approved. Finish a [consistent off-VM backup and restore drill](backups-and-restore.md).

## Keep the deployment

Use [deployment operations](deployment.md#operate-the-deployment) for health, logs, and start/stop commands. Use [manual updates](manual-updates.md) to select a new image; `./replica update` cannot advance an immutable digest. Keep the existing `.env`, storage, previous image, and recovery records.

Never use `docker compose down -v`, delete/prune volumes, or remove persistent disks as routine troubleshooting.
