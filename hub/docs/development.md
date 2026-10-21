# Development

Docker-compatible tooling is the only host requirement. Run these commands from `hub/`. The provided devcontainer provides Ruby, Node, SQLite, Git, GitHub CLI, and Chromium.

Hub uses npm. The Node devcontainer feature's optional pnpm installation is disabled.

## Start and stop

```text
bin/devcontainer up    create or start the container
bin/devcontainer dev   run Rails, Vite, and Solid Queue in local mode
Ctrl+C                 stop those processes but keep the container
```

Open <http://replica.localhost:19500>.

Run Storybook separately when working on the Hub interface:

```text
bin/devcontainer storybook
```

Open <http://localhost:6006>. Storybook renders display-ready Components, Features, and Pages without Rails or GitHub. See [Storybook](storybook.md) for fixture and story rules.

Run Ruby and Node commands inside the container:

```sh
bin/devcontainer exec COMMAND
```

The container mounts the repository root but opens in `hub/`, so extension checks can read the root `.github/extensions/replica-prototype` plugin.

For Copilot plugin development, follow the [contributor workflow](prototype-canvas.md#contributor-workflow) to build assets and load a local checkout with `copilot --plugin-dir`. Prototype authors use the [CLI installation and update path](../../.github/extensions/replica-prototype/README.md#install) instead.

Use `rebuild` after changing the container definition, `stop` to stop the container, and `down` to remove it.

### Use an npm registry proxy

If your network requires an npm registry proxy, pass its URL when starting the container:

```sh
bin/devcontainer up --use-npm-proxy https://npm-proxy.example.com/npm/
bin/devcontainer dev
```

The option also works with `dev`, `rebuild`, `storybook`, `exec`, and `shell`; place it before any `exec` command. It selects the registry for the CLI image's npm installation and the container's initial dependency setup. After startup succeeds, it saves the registry in the container user's npm configuration, so later npm commands, including CI's `npm ci`, use it without repeating the option. It also updates an existing container without rebuilding or removing it.

The registry must serve the locked dependencies for Hub and `packages/learning/`, plus `starters/minimal/` and `actions/build/` for local mode. `up` installs the first two; the first local-mode `dev` also prepares the example and shared build dependencies.

Use an HTTP(S) registry URL without credentials, whitespace, a query, or a fragment. This option does not configure an HTTP network proxy or disable TLS verification. It does not change the host's npm settings, repository `.npmrc` files, lockfiles, or the production image. Without the option, the wrapper leaves the registry configuration unchanged.

Tools that fetch registry URLs directly do not use npm's settings. In particular, `bin/check-dependency-age` still requests publication metadata from the public registries.

To remove the saved override, run `bin/devcontainer exec npm config delete registry --location=user`. Removing the container also removes its saved registry setting.

Restart `bin/devcontainer dev` after changing Rails routes or browser scripts served directly by Rails. Restart Vite when browser assets do not match the saved source.

The production image includes shared Controls source from `app/javascript/utils/prototype-controls/`. It also installs `replica-learning` from `packages/learning/`, with Node.js, under `/opt/replica/learning`, because Hub runs that command to reach Copilot. From `hub/`, build it with `docker build --build-context learning=../packages/learning --tag replica-hub:local .`. CI and release builds supply that same narrow named context. The final image keeps `/rails` as its application directory and `/rails/storage` as its persistent path.

Custom source deployments should remove the old `controls` build-context argument and supply the learning context from the same Replica revision. For a workflow checking out Replica into `replica/` and building `replica/hub`, use `--build-context learning=replica/packages/learning`. An omitted named context makes Docker resolve `learning` as an image instead of local source. Image consumers do not need this source-build argument.

The image includes Node and the self-contained validator to check retained Controls assets before storage. AJV is a Hub development dependency used to generate that validator; retained-asset validation does not require installed Node packages.

The container runs `bin/setup --skip-server` when it is first created. That command installs locked dependencies and prepares the development database. For `packages/learning/`, whose `replica-learning` command Hub runs to reach Copilot, it installs only the runtime dependencies, with the production image's flags. If `replica-learning` reports that a package it needs is not installed, run `bin/devcontainer exec bin/setup --skip-server`. To work on `packages/learning/` itself, run its full `npm ci` afterward, as [CONTRIBUTING.md](../../CONTRIBUTING.md) describes, inside the container: `bin/devcontainer exec sh -c 'cd ../packages/learning && npm ci'`. The Copilot SDK installs a binary for the platform that runs `npm ci`, and the container shares your checkout, so an install on a Mac host leaves Hub in the container without its Linux binary.

By default, `bin/devcontainer dev` starts [local development](local-development.md) without a GitHub App. It builds committed branches from repositories inside the devcontainer. Set `REPLICA_LOCAL_MODE=0` (or `false`) when starting `dev` to use GitHub-backed development instead. One-off `exec` and `shell` commands do not pick a mode automatically.

GitHub-backed development uses a private GitHub App and test prototype repositories. GitHub Actions runs the same repository workflow used in production, while Hub polls GitHub without a public tunnel. Never install the development App on production repositories.
