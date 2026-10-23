# Create your first local prototype

This guide walks you through running a prototype locally, adding your team's design-system guidance, and building a useful first prototype. You can start from the Replica starter or use a prototype repository your team already maintains.

You'll use the **Replica canvas**, a panel in the GitHub Copilot app that shows your running prototype beside your conversation. It is included in the Replica plugin. Step 3 below covers installing the plugin if needed and enabling the canvas.

**You can prototype locally without Hub, Docker, a domain, or a GitHub repository.** You can also use a team repository already configured for local development while hosting is being arranged. Publishing and shared review comments need Hub, but local work does not.

For a quick trial, stop after the app works in the canvas in step 4. Continue through steps 5 and 6 to build with your team's guidance.

If your team already has a connected repository and Hub, follow [Join your team's Replica environment](getting-started.md). For the full team setup, including hosting, use [Set up shared hosting and team feedback](prototype-environment.md).

## 1. Prepare your local development environment

If you don't already have the [GitHub Copilot app](https://github.com/features/ai/github-app), install it and sign in. You also need [Git](https://git-scm.com/), [Node.js](https://nodejs.org/), and npm. Use a Node.js version matching `engines.node` in your repository's `package.json`, or [the starter's package.json](../starter/package.json) for a new repository. Reuse a compatible installation.

The Replica canvas supports local previews on macOS and Linux. It uses `lsof` to find running local servers. Install missing tools through your organization's approved process. The starter installer does not install Node.js or change your shell configuration.

Copilot requires GitHub sign-in, but creating the local starter does not require GitHub repository access. You can use a Copilot plan or [connect your own model provider](https://docs.github.com/en/copilot/how-tos/github-copilot-app/use-byok-models).

## 2. Create or open your prototype repository

With your local development environment ready, the next step is to open a prototype repository in Copilot. You can create one from the Replica starter or use a repository your team has already set up for local prototyping.

If you already have a Replica repository, use **Open an existing repository** below. You do not need to copy the starter files or start again.

### Create a repository from the starter

The installer creates a new folder for your prototype, named `my-prototype` in the example below. Choose a name that is not already in use.

In a terminal, go to the directory where you want the new folder created, then download the installer:

```sh
curl -fLSs https://raw.githubusercontent.com/github/replica/main/scripts/install-starter.sh -o install-starter.sh
```

Review the installer, then run it with a name for your new project folder:

```sh
bash install-starter.sh my-prototype
```

This creates `my-prototype` as an independent local Git repository. It does not create a GitHub repository, commit files, or publish anything.

In the Copilot app, choose **Projects → + → Local folder or repository** and add the new folder. Before accepting its repository configuration, review `.github/github-app.yml` and the copied README. Session startup can install Copilot CLI globally if missing, install or enable the Replica plugin, and install app dependencies with `npm ci`.

Start a fresh session in the new repository so Copilot can discover its included skills. If another session created the folder, give the new session a summary of completed setup and what you want to build.

Continue at step 3.

### Open an existing repository

Choose the repository from **Projects** in Copilot. If it is not listed, choose **Projects → + → Local folder or repository** for a local copy, or **Projects → + → Add GitHub repository** to select your team's repository on GitHub. Start a session in that repository and review any setup configuration before accepting it.

If the repository does not already use Replica, ask Copilot to inspect its instructions, app, and Git state before changing it. Agree whether to adapt the existing app or create a separate starter repository. Preserve the existing files, remote, and history.

**Ready to continue:** the repository is open in Copilot. Opening it does not push changes or publish a prototype.

Continue at step 3.

## 3. Enable the Replica canvas

With your repository open in Copilot, the next step is to enable the Replica canvas so you can preview the app beside your conversation.

Check the session setup output for dependency or plugin failures. Successful dependency installation does not mean the canvas is enabled.

### Install the plugin if needed

If the Replica plugin appears under **Customize → Installed**, continue at [Activate the plugin and canvas](#activate-the-plugin-and-canvas) below.

The Replica starter installs the plugin during session setup. It checks for Copilot CLI and installs it if missing. If setup failed, resolve the reported error, then run `node scripts/setup-replica-plugin.mjs` from the repository folder to retry plugin setup.

For repositories without that setup script, use the manual plugin commands below. These require the `copilot` command in your terminal. Check with `copilot --version`; if the command is not found, follow the [Copilot CLI installation instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli) before continuing.

These commands install Replica from its default branch. If your organization requires a specific version or source, use its installation instructions instead.

First, add Replica's plugin marketplace if you haven't already:

```sh
copilot plugin marketplace add github/replica
```

Then install the Replica plugin:

```sh
copilot plugin install replica-prototype@replica
```

### Activate the plugin and canvas

In the sidebar, open **Customize → Installed** and enable both the `replica-prototype` plugin and its canvas extension. They are separate switches.

Start a fresh session after installation or enablement. Open **+ → Canvas → Replica prototype**. Keep only one copy of the Replica canvas enabled.

If installation fails, use the error and recovery instructions in the terminal or session setup output. Resolve policy or permission errors through your organization's approval process rather than bypassing them. If the canvas is still missing, confirm both switches are enabled and start a fresh session after changing them.

**Ready to continue:** the Replica canvas opens in your current session. You do not need to connect it to Hub.

## 4. Run the app in the canvas

With the canvas enabled, try the starter app or your team's existing prototype before making changes. The goal is to see it running and confirm that you can use it.

Ask Copilot:

```text
Run this repository's app locally and show it in the Replica canvas.
Use the run commands in its README and the URL printed by the server.
Do not change the app, connect to Hub, or publish anything yet.
```

If the canvas lists running servers, choose **Connect** beside your app's server. If none is running, choose **Start dev server**.

Once the page appears, try its navigation and any included interactions. Check the preview itself rather than relying on a setup success message.

If the page does not appear or reports an error, ask Copilot to investigate using the repository's README and, where present, `SETUP.md` before continuing.

**Ready to continue:** the app works in the canvas. This is enough for a quick trial. Continue below to add team guidance and build a prototype.

## 5. Add your team's guidance

Now that you can try the app, give Copilot the information it needs to build prototypes that follow your team's product and design system.

If the repository already uses your team's approved guidance, review what is in place and continue to step 6. You do not need to create it again.

Otherwise, run `/setup-skills` in your Copilot conversation. Provide your product documentation, design-system documentation, and any component or token packages your team uses. Share only sources your organization permits you to use.

Copilot checks those sources and drafts instructions for building prototypes. It asks for permission before installing any packages.

Review the drafts using your team's usual approval process and request any corrections. Once the drafts are reviewed, give Copilot separate approval to apply them. Ask it to confirm which guidance is now in use.

If a package cannot be installed or the app no longer runs, resolve the reported error before continuing. Without approved guidance, you can still explore the starter, but you have not yet checked whether Replica follows your team's design system.

**Ready to continue:** the reviewed guidance is in use and the app still runs. The next step is to try that guidance in a prototype.

## 6. Build one useful prototype

With the app running and your team's guidance in place, choose one small task you want to explore. Describe what someone should be able to do, then ask Copilot to build it. For example:

```text
Build a searchable project list using our approved design-system guidance
and sample data. Include an empty result state and a way to clear the search.
Keep it separate from our live product. Show it in the Replica canvas.
Before editing, check that the reviewed app and guidance are committed.
If this is a new repository with no commits, ask for my approval to save
that starting version in a local commit on its initial branch.
Use a separate branch for this prototype. Leave the default branch unchanged.
Ask for approval before making any commits. Do not push or publish anything.
```

The prompt asks Copilot to preserve a reusable starting version before experimenting. A new starter needs its first local commit before a separate prototype branch can keep those versions apart. Copilot must ask for your approval to make that commit; it does not upload or publish anything. For an existing team repository, use its usual review process for changes to the shared starting point.

Try the result in the canvas. For the example above, search for a project, try a search with no results, and clear the search. Check that the prototype uses your team's intended components and patterns, then ask Copilot to revise anything that does not match.

Use sample data throughout. Keep production credentials and real customer data out of the prototype.

**Ready to continue:** you have a useful local prototype using your team's approved guidance, kept separate from the saved starting version. It has not been published to Hub.

## Continue when you are ready to share

Keep this repository and the work completed above. You can share a team starting point through GitHub without Hub, or add hosted publishing and comments later.

### Share a team starting point without Hub

Review the app, active guidance, and any starting pages your team will reuse. Confirm the GitHub owner, repository visibility, and access before creating a repository or pushing files.

For a new GitHub repository, authorize Copilot to create it or connect an agreed empty repository as `origin`, then push the saved starting version on the intended default branch. Approve any further local commits separately. Keep prototype-specific work on its separate branch. For an existing shared repository, use its contribution process to merge the reviewed changes. Preserve its files, remote, and history.

**Ready to share:** the repository's actual default branch on GitHub contains the reviewed app and active guidance. Teammates with repository access can use it locally, even while hosting or Actions approval is pending. This does not publish a Hub preview or enable shared review comments.

### Add hosted publishing and comments

If your team's Hub already shows a successful Build for the repository's reviewed default branch, continue at [step 7: Connect your canvas to Hub](prototype-environment.md#7-connect-your-canvas-to-hub).

If Hub exists but the repository connection or build workflow still needs setup, use [step 6: Connect GitHub and enable builds](prototype-environment.md#6-connect-github-and-enable-builds). Reuse the existing Hub and GitHub App rather than setting them up again.

If hosting has not been set up, check the [hosting requirements](prototype-environment.md#1-check-readiness-before-you-start). Once those are in place, continue at [step 5: Deploy the hub](prototype-environment.md#5-deploy-the-hub). The repository setup, guidance, and local prototype are already complete; continue from there without repeating them.

If you already shared the starting version on GitHub, skip that part of hosted step 6 and continue at [Connect the repository to the GitHub App](prototype-environment.md#connect-the-repository-to-the-github-app). If the App already includes the repository, continue at [Enable the build workflow](prototype-environment.md#enable-the-build-workflow).
