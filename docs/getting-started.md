# Get started with Replica

Create an interactive local prototype with GitHub Copilot and your team's design guidance. This guide helps you join a shared prototype repository, open its local canvas, and add controls.

Hub is being rebuilt. Hosted publishing, sharing, comments, and deployment are not available yet. The starter and local canvas do not require Hub. To create a repository rather than join an existing one, follow [prototype repository setup](prototype-repository-setup.md).

## 1. Download the GitHub Copilot app

Download the [GitHub Copilot app](https://github.com/features/ai/github-app), install it, and follow its sign-in instructions.

You also need [Git](https://git-scm.com/), [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm), and [Node.js](https://nodejs.org/). Install the Node.js version required by your team's prototyping repository; npm comes with Node.js.

The canvas preview workflow supports macOS and Linux. Server discovery requires `lsof` on the machine running the canvas extension; install it with your system's package manager if it is missing. **Start dev server** is supported only on macOS and Linux.

Install [GitHub CLI](https://cli.github.com/) for the canvas's branch checks. Check your GitHub sign-in:

```sh
gh auth status --hostname github.com
```

If you are not signed in, run `gh auth login --hostname github.com` and follow the prompts. Use an account with access to the prototype repository. Copilot sign-in does not replace this GitHub CLI sign-in.

## 2. Set up your prototyping repository

Ask your team for the prototype repository's GitHub URL and access. A designer, design-system maintainer, or engineer may already have prepared the shared components and guidance.

Add the repository to the Copilot app:

1. In the sidebar, click **+** beside **Projects**.
2. Choose **Add GitHub repository**.
3. Find and select the repository your team gave you.
4. Once it appears under **Projects**, click **+** beside that repository to start a new session.

If the repository is missing or access is denied, ask its maintainer to check your GitHub access. See [connecting a repository in Copilot](https://docs.github.com/en/copilot/get-started/quickstart-copilot-app#connecting-a-repository-or-folder) for app setup help.

**Setting up the environment for your organization?** Follow [environment setup](prototype-environment.md) instead. It covers creating the repository, adding guidance and starting pages, and inviting teammates.

## 3. Install and enable the canvas

The Replica prototype canvas shows your local preview beside the Copilot conversation and provides prototype controls.

Ask your agent to install the plugin and provide these commands:

```sh
copilot plugin marketplace add github/replica
copilot plugin install replica-prototype@replica
```

You can also run them manually in a terminal with Copilot CLI available.

Repositories using the current starter setup script automatically run `npm install -g @github/copilot` if `copilot` is missing, then install the plugin. This needs npm and a writable global installation directory. Setup does not use sudo or change your shell configuration. Dependency installation with `npm ci` still runs if CLI or plugin setup fails; this does not mean the canvas is ready. Check the app's setup output for the failure reason and recovery steps. If automatic installation fails, follow the [Copilot CLI installation instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli), then rerun `node scripts/setup-replica-plugin.mjs` in repositories that have it.

In the Copilot app sidebar, open **Customize**, then **Installed**. Find the `replica-prototype` plugin and enable it. Also enable its `replica-prototype` canvas; both must be enabled.

Start a fresh session in the Copilot app, then select **+ → Canvas → Replica prototype**. If the canvas is missing, check installation and start a new session.

## 4. Create a prototype

Start a separate session for each prototype. Describe the change you want:

```text
Help a teammate find a project in a list. Use our approved design-system
guidance and sample data. Add search, an empty result message, and a way
to clear the search. Keep this separate from our live product.
```

Open the canvas and choose **Connect** beside your prototype's server. If none is running, choose **Start dev server**. If startup fails, ask Copilot to explain the error before changing anything.

Verify that the local prototype renders and responds to the intended interactions. The canvas may display Hub publishing controls, but the new Hub does not support them yet. See [Hub status](../hub/README.md).

## 5. Add controls

Controls let you change prototype scenarios without asking Copilot to edit code each time. They live in Replica's panel, separate from controls someone would use in your product.

Run `/prototype-controls` in your prototype session, or describe the variations you need:

```text
Add a control to switch this project list between
empty and populated states, and a slider to change the item count.
Wire them to the rendered sample data. Keep these controls in Replica's
panel rather than adding settings to the product UI.
```

After Copilot adds the definitions, reload the preview and open **Controls**, the sliders icon in the canvas toolbar. Change each setting and check that the prototype responds. **Reset all controls** restores the defaults.

Controls work locally without Hub. The [starter Controls guide](../starter/README.md#prototype-controls) covers authoring and recovery. If a control is disabled or reports an error, ask Copilot to investigate the displayed reason rather than assuming the change took effect.
