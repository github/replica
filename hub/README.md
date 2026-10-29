# Replica Hub

Replica Hub is a self-hosted project that gives teams a shared place to review and collaborate on interactive prototypes. Teams can view and interact with each prototype in the browser, comment on specific elements or highlighted regions, reply, react, and see new activity from other reviewers. Prototype authors can also create public share links for people who do not use Hub.

Teams create and maintain the GitHub repositories that hold their prototypes. Teams use non-default branches for prototypes. To connect those repositories, a team uses the setup flow in its self-hosted Replica Hub instance to create a private GitHub App, then installs that App on the prototype repositories it wants Hub to use.

Repository writers can ask Hub to open a pull request that adds the required GitHub Actions workflow. That workflow calls the shared build action from the Replica repository, which builds each prototype branch and captures screenshots. It uploads a GitHub Actions artifact containing the built `dist` files and screenshots for Hub to store.

```text
prototype branch
  -> repository workflow
  -> shared action from Replica
  -> GitHub Actions artifact (`dist` + screenshots)
  -> self-hosted Replica Hub
       |
       +-- isolated preview
             |
             +-- team conversations
             +-- public share links
```

GitHub stores the source code and decides repository access. The private App lets Hub discover prototype branches, follow their GitHub Actions runs, and check each reviewer's access. Hub keeps successful Build output and review conversations so the team can return to the same review later.

## Deployment

Replica Hub publishes a public container image at `ghcr.io/github/replica-hub`. The recommended deployment uses the release bundle to run that image with Docker Compose.

Select an explicit `hub-v*` release from [Hub releases](https://github.com/github/replica/releases) and replace `hub-vREPLACE_WITH_VERSION` below. Public release assets do not require GitHub authentication. See [Deploy Replica Hub](docs/deployment.md#download-the-deployment-bundle) for the requirements, or use the walkthroughs for [a Linux VM](docs/manual-vm-installation.md) and [Azure DNS/HTTPS](docs/azure-vm-deployment.md).

On a Linux server with `curl`, `tar`, and `sha256sum`, download and verify the bundle before extracting it:

```sh
HUB_RELEASE=hub-vREPLACE_WITH_VERSION
HUB_RELEASE_URL="https://github.com/github/replica/releases/download/${HUB_RELEASE}"
mkdir replica-hub &&
  cd replica-hub &&
  curl -fsSL --output replica-deploy.tar.gz \
    "${HUB_RELEASE_URL}/replica-deploy.tar.gz" &&
  curl -fsSL --output replica-deploy.tar.gz.sha256 \
    "${HUB_RELEASE_URL}/replica-deploy.tar.gz.sha256" &&
  sha256sum -c replica-deploy.tar.gz.sha256 &&
  tar -xzf replica-deploy.tar.gz
```

The `&&` chain stops on a failed download or checksum mismatch, before extraction. Do not continue to setup after an error. Hub releases use `hub-v*` tags; a canvas release can become the repository's latest release, so do not use `releases/latest` for this bundle.

## Development

```sh
cd hub
bin/devcontainer up
bin/devcontainer dev
```

Open <http://replica.localhost:19500>. Run commands through the container:

```sh
bin/devcontainer exec bin/ci
```

Run Storybook as the interface workbench:

```sh
bin/devcontainer storybook
```

Open <http://localhost:6006>.

See the [documentation index](docs/README.md) for setup, architecture, and contributor guidance. First-time deployments also need a bootstrap secret; see [GitHub App setup](docs/github-app-setup.md).
